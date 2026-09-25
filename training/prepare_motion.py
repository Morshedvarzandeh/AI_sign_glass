"""Build motion-v2 features offline from the already audited and cached source."""
import argparse
import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path

import numpy as np

from motion_features import FEATURE_DIM, VERSION, motion_features
from prepare import write_json


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    source, out = args.source.resolve(), args.output.resolve()
    if out.exists() and any(out.iterdir()):
        parser.error("Choose a new output directory; preserve existing prepared datasets")
    audit = json.loads((source / "audit.json").read_text())
    if audit["status"] != "prepared" or any(audit[k] for k in ["signer_overlap", "clip_overlap", "identical_feature_overlap"]):
        raise ValueError("Original dataset audit failed")
    out.mkdir(parents=True, exist_ok=True)
    write_json(out / "status.json", {"status": "preparing", "feature_version": VERSION})
    try:
        groups = defaultdict(list)
        metadata, arrays, labels = {}, {}, {}
        for split in ["train", "val", "test"]:
            metadata[split] = json.loads((source / f"{split}_clips.json").read_text())
            labels[split] = np.load(source / f"{split}_y.npy", allow_pickle=False)
            if digest(source / f"{split}_y.npy") != audit["prepared_sha256"][f"{split}_y.npy"]:
                raise ValueError("Source labels changed")
            if labels[split].tolist() != [r["label_id"] for r in metadata[split]]:
                raise ValueError("Source labels and clip metadata disagree")
            arrays[split] = np.empty((len(metadata[split]), FEATURE_DIM), dtype=np.float32)
            for i, row in enumerate(metadata[split]):
                groups[row["source_shard"]].append((split, i, row))
        seen_ids, seen_hashes = set(), set()
        for n, (name, rows) in enumerate(sorted(groups.items()), 1):
            path = (source / "source" / name).resolve()
            if not path.is_relative_to(source / "source"):
                raise ValueError("Invalid shard location")
            if digest(path) != audit["shard_sha256"][name]:
                raise ValueError("Source shard checksum mismatch")
            shard = np.load(path, mmap_mode="r", allow_pickle=False)
            for split, i, row in rows:
                sample = shard[row["source_row"]]
                h = hashlib.sha256(sample.tobytes()).hexdigest()
                if h != row["feature_sha256"] or h in seen_hashes or row["clip_id"] in seen_ids:
                    raise ValueError("Duplicate or changed source sample")
                seen_hashes.add(h)
                seen_ids.add(row["clip_id"])
                arrays[split][i] = motion_features(sample)
            del shard
            print(f"Prepared motion shard {n}/{len(groups)}", flush=True)
            write_json(out / "status.json", {"status": "preparing", "completed_shards": n, "total_shards": len(groups)})
        for split in ["train", "val", "test"]:
            np.save(out / f"{split}_x.npy", arrays[split], allow_pickle=False)
            np.save(out / f"{split}_y.npy", labels[split], allow_pickle=False)
            write_json(out / f"{split}_clips.json", metadata[split])
        shutil.copyfile(source / "labels.json", out / "labels.json")
        result = {**audit, "feature_version": VERSION, "input_features": FEATURE_DIM,
                  "source_audit_sha256": digest(source / "audit.json"),
                  "source_metadata_sha256": {f"{s}_clips.json": digest(source/f"{s}_clips.json") for s in metadata},
                  "feature_code_sha256": digest(Path(__file__).with_name("motion_features.py")),
                  "feature_spec": {"local": "155 frame channels: head/shoulders/elbows/wrists, each hand's palm-scaled local shape and body-relative wrist, presence; causal 5-frame smoothing reset on missing tracking, 16 position/velocity bins, std and mean speed", "dimension": FEATURE_DIM, "no_raw_video_pipeline_validation": True},
                  "prepared_sha256": {p.name: digest(p) for p in out.glob("*.npy")},
                  "metadata_sha256": {p.name: digest(p) for p in out.glob("*_clips.json")},
                  "labels_sha256": digest(out / "labels.json")}
        write_json(out / "audit.json", result)
        write_json(out / "status.json", {"status": "prepared", "feature_version": VERSION, "clips": len(seen_ids), "input_features": FEATURE_DIM})
        print(f"Prepared {len(seen_ids)} clips with {FEATURE_DIM} motion features; original splits and row order preserved.", flush=True)
    except BaseException as exc:
        write_json(out / "status.json", {"status": "failed", "reason": str(exc)})
        raise


if __name__ == "__main__":
    main()
