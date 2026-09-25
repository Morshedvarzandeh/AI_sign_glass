"""Prepare a local research dataset; never use the mirror's overlapping splits."""
import argparse
import csv
import hashlib
import io
import json
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

REPO = "SharoonArshad/asl-citizen-processed-200"
REVISION = "0dbf1ca7e7f9a1c3f626b5738683f06145fde699"
HF = f"https://huggingface.co/datasets/{REPO}/resolve/{REVISION}/"
ARCHIVE = "https://download.microsoft.com/download/b/8/8/b88c0bae-e6c1-43e1-8726-98cf5af36ca4/ASL_Citizen.zip"
LICENSE = "https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/"


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    temp.write_text(json.dumps(value, indent=2) + "\n")
    temp.replace(path)


def request(url, limit=32_000_000, headers=None):
    req = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(req, timeout=45) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError("Remote metadata exceeds size limit")
    return data


class RemoteArchive(io.RawIOBase):
    """Read ZIP metadata and small members with standard HTTP byte ranges."""
    def __init__(self):
        with urllib.request.urlopen(urllib.request.Request(ARCHIVE, method="HEAD"), timeout=30) as r:
            self.size = int(r.headers["Content-Length"])
            self.etag = r.headers.get("ETag")
        self.pos = 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        if not 0 <= self.pos <= self.size:
            raise ValueError("Invalid archive offset")
        return self.pos

    def read(self, n=-1):
        end = self.size if n < 0 else min(self.size, self.pos + n)
        if end <= self.pos:
            return b""
        if end - self.pos > 32_000_000:
            raise ValueError("Refusing large archive read")
        headers = {"Range": f"bytes={self.pos}-{end-1}"}
        if self.etag:
            headers["If-Match"] = self.etag
        with urllib.request.urlopen(urllib.request.Request(ARCHIVE, headers=headers), timeout=45) as r:
            if r.status != 206 or not r.headers.get("Content-Range", "").startswith(f"bytes {self.pos}-{end-1}/"):
                raise ValueError("Server did not honor archive byte range")
            data = r.read(end - self.pos + 1)
        if len(data) != end - self.pos:
            raise ValueError("Incomplete archive read")
        self.pos = end
        return data


def file_matches(path, entry):
    if not path.exists() or path.stat().st_size != entry["size"]:
        return False
    if "lfs" in entry:
        h = hashlib.sha256()
        with path.open("rb") as f:
            for block in iter(lambda: f.read(1024 * 1024), b""):
                h.update(block)
        return h.hexdigest() == entry["lfs"]["oid"]
    data = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest() == entry["oid"]


def download(path, entry):
    if file_matches(path, entry):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    part = path.with_suffix(path.suffix + ".part")
    for attempt in range(3):
        try:
            with urllib.request.urlopen(HF + entry["path"], timeout=45) as r, part.open("wb") as f:
                count = 0
                while block := r.read(1024 * 1024):
                    count += len(block)
                    if count > entry["size"]:
                        raise ValueError("Download exceeded published size")
                    f.write(block)
            if not file_matches(part, entry):
                raise ValueError("Dataset checksum mismatch")
            part.replace(path)
            return
        except Exception:
            part.unlink(missing_ok=True)
            if attempt == 2:
                raise
            time.sleep(attempt + 1)


def temporal_features(sample):
    """16 ordered position bins, global std, and range; no padded frame copying."""
    if sample.shape != (200, 450):
        raise ValueError(f"Unexpected input shape: {sample.shape}")
    positions = np.asarray(sample[:, :225], dtype=np.float32)
    if not np.isfinite(positions).all() or np.max(np.abs(positions)) > 10000:
        raise ValueError("Nonfinite or extreme landmark values")
    if np.std(positions) < 1e-6:
        raise ValueError("Empty landmark sequence")
    bins = np.stack([chunk.mean(axis=0) for chunk in np.array_split(positions, 16)])
    return np.concatenate([bins.ravel(), positions.std(axis=0), np.ptp(positions, axis=0)]).astype(np.float32)


def resolve_rows(manifests, original):
    """Deduplicate videos, restore original signer splits, verify every label."""
    seen = set()
    selected = []
    duplicates = 0
    for rows in manifests:
        for row in rows:
            key = Path(row["filename"]).stem
            if key in seen:
                duplicates += 1
                continue
            seen.add(key)
            if key not in original:
                raise ValueError(f"Video missing from official metadata: {key}")
            split, signer, gloss = original[key]
            if row["label"].replace("/", "-") != gloss.replace("/", "-"):
                raise ValueError(f"Conflicting label for {key}")
            selected.append({**row, "clip_id": key, "official_split": split, "signer": signer, "canonical_label": gloss})
    signers = {s: {r["signer"] for r in selected if r["official_split"] == s} for s in ["train", "val", "test"]}
    for a, b in [("train", "val"), ("train", "test"), ("val", "test")]:
        if signers[a] & signers[b]:
            raise ValueError(f"Signer overlap: {a}, {b}")
    return selected, duplicates


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    out = args.output.resolve()
    cache = out / "source"
    cache.mkdir(parents=True, exist_ok=True)
    status_path = out / "preparation-status.json"
    write_json(status_path, {"status": "preparing", "revision": REVISION})
    tree_bytes = request(f"https://huggingface.co/api/datasets/{REPO}/tree/{REVISION}?recursive=true")
    tree = {e["path"]: e for e in json.loads(tree_bytes) if e["type"] == "file"}
    (cache / "tree.json").write_bytes(tree_bytes)
    names = ["README.md", "metadata/preprocessing_config.json", "metadata/label_to_id.json"]
    names += [f"metadata/{s}_manifest.csv" for s in ["train", "val", "test"]]
    for name in names:
        download(cache / name, tree[name])
    original = {}
    official_dir = cache / "official"
    official_dir.mkdir(exist_ok=True)
    files = [f"splits/{s}.csv" for s in ["train", "val", "test"]] + ["use.txt"]
    if not all((official_dir / name).exists() for name in files):
        remote = RemoteArchive()
        with zipfile.ZipFile(remote) as archive:
            for name in files:
                member = "ASL_Citizen/" + name
                if archive.getinfo(member).file_size > 20_000_000:
                    raise ValueError("Unexpected official metadata size")
                dest = official_dir / name
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(archive.read(member))
        write_json(official_dir / "archive.json", {"url": ARCHIVE, "size": remote.size, "etag": remote.etag})
    for s in ["train", "val", "test"]:
        for row in csv.DictReader((official_dir / f"splits/{s}.csv").open()):
            key = Path(row["Video file"]).stem
            if key in original:
                raise ValueError("Duplicate in official metadata")
            original[key] = (s, row["Participant ID"], row["Gloss"])
    manifests = [list(csv.DictReader((cache / f"metadata/{s}_manifest.csv").open())) for s in ["train", "val", "test"]]
    rows, duplicate_count = resolve_rows(manifests, original)
    labels = sorted({row["canonical_label"] for row in rows})
    label_to_id = {label: i for i, label in enumerate(labels)}
    groups = defaultdict(list)
    for row in rows:
        groups[row["feature_shard"]].append(row)
    print(f"Restored official splits; {len(rows)} unique clips, {len(labels)} signs; removed {duplicate_count} duplicate records.", flush=True)
    print(f"Download {len(groups)} feature shards ({sum(tree[n]['size'] for n in groups)/1e9:.2f} GB); cached shards are verified and reused.", flush=True)
    features = defaultdict(list)
    metadata = defaultdict(list)
    hashes = {}
    rejected = []
    shard_hashes = {}
    for index, (name, shard_rows) in enumerate(sorted(groups.items()), 1):
        if not name.startswith("shards/") or "/.." in name:
            raise ValueError("Invalid shard path")
        download(cache / name, tree[name])
        shard_hashes[name] = tree[name]["lfs"]["oid"]
        arr = np.load(cache / name, mmap_mode="r", allow_pickle=False)
        if arr.ndim != 3 or arr.shape[1:] != (200, 450) or arr.dtype != np.float16:
            raise ValueError("Unexpected shard schema")
        for row in shard_rows:
            sample = arr[int(row["row_in_shard"])]
            digest = hashlib.sha256(sample.tobytes()).hexdigest()
            try:
                feature = temporal_features(sample)
            except ValueError as exc:
                rejected.append({"clip_id": row["clip_id"], "reason": str(exc)})
                continue
            if digest in hashes:
                raise ValueError("Identical features found under different video IDs; investigate before training")
            hashes[digest] = row["clip_id"]
            split = row["official_split"]
            features[split].append(feature)
            metadata[split].append({"clip_id": row["clip_id"], "signer": row["signer"], "label": row["canonical_label"], "label_id": label_to_id[row["canonical_label"]], "source_shard": name, "source_row": int(row["row_in_shard"]), "feature_sha256": digest})
        del arr
        print(f"Prepared shard {index}/{len(groups)}", flush=True)
        write_json(status_path, {"status": "preparing", "completed_shards": index, "total_shards": len(groups)})
    counts = {}
    for split in ["train", "val", "test"]:
        y = np.asarray([r["label_id"] for r in metadata[split]], dtype=np.int64)
        if set(y.tolist()) != set(range(len(labels))):
            raise ValueError(f"Missing classes in {split}")
        np.save(out / f"{split}_x.npy", np.stack(features[split]), allow_pickle=False)
        np.save(out / f"{split}_y.npy", y, allow_pickle=False)
        write_json(out / f"{split}_clips.json", metadata[split])
        counts[split] = {"clips": len(y), "signers": len({r['signer'] for r in metadata[split]}), "per_class": dict(Counter(r["label"] for r in metadata[split]))}
    write_json(out / "labels.json", labels)
    npy_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(out.glob("*.npy"))}
    audit = {
        "status": "prepared", "classes": len(labels), "splits": counts,
        "duplicate_manifest_records_removed": duplicate_count,
        "split_policy": "Original Microsoft signer-disjoint train/val/test, reconstructed by exact source video ID",
        "signer_overlap": 0, "clip_overlap": 0, "identical_feature_overlap": 0,
        "rejected_clips": rejected, "data_revision": REVISION, "data_repo": REPO,
        "shard_sha256": shard_hashes, "prepared_sha256": npy_hashes,
        "official_metadata_sha256": {n: hashlib.sha256((official_dir/n).read_bytes()).hexdigest() for n in files},
        "license": {"original": LICENSE, "mirror_declaration": "CC BY-NC-SA 4.0", "use": "Local noncommercial research only; do not redistribute source data or deploy this checkpoint as a commercial product."},
        "feature_spec": {"upstream": "200 frames, 75 landmarks: 33 pose + 21 left hand + 21 right hand; shoulder centered/scaled positions and velocity", "local": "Use positions only: 16 ordered mean bins (3600 values), global std (225), global range (225); total 4050", "no_raw_video_pipeline_validation": True},
        "numpy": np.__version__,
    }
    write_json(out / "audit.json", audit)
    write_json(status_path, {"status": "prepared", "clips": sum(c['clips'] for c in counts.values()), "classes": len(labels)})
    print(json.dumps({"status": "prepared", "splits": {s: {k:v for k,v in c.items() if k!='per_class'} for s,c in counts.items()}}), flush=True)


if __name__ == "__main__":
    main()
