"""Train a small temporal ASL classifier on audited motion features, using NumPy."""
import os

# Keep desktop CPU use bounded. Set before importing NumPy/BLAS.
for setting in ["OPENBLAS_NUM_THREADS", "OMP_NUM_THREADS", "MKL_NUM_THREADS"]:
    os.environ[setting] = "2"

import argparse
import hashlib
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from prepare import write_json


def loss_and_grad(params, x, y, l2=0.0001, dropout=0.0, rng=None):
    hidden = np.maximum(x @ params["w1"] + params["b1"], 0)
    mask = None
    if dropout:
        mask = (rng.random(hidden.shape) >= dropout).astype(hidden.dtype) / (1 - dropout)
    used = hidden if mask is None else hidden * mask
    logits = used @ params["w2"] + params["b2"]
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    probs = exp / exp.sum(axis=1, keepdims=True)
    loss = -np.log(np.maximum(probs[np.arange(len(y)), y], 1e-12)).mean()
    loss += 0.5 * l2 * (np.sum(params["w1"] ** 2) + np.sum(params["w2"] ** 2))
    delta = probs.copy()
    delta[np.arange(len(y)), y] -= 1
    delta /= len(y)
    grads = {"w2": used.T @ delta + l2 * params["w2"], "b2": delta.sum(axis=0)}
    dh = delta @ params["w2"].T
    if mask is not None:
        dh *= mask
    dh *= hidden > 0
    grads["w1"] = x.T @ dh + l2 * params["w1"]
    grads["b1"] = dh.sum(axis=0)
    return float(loss), grads


def probabilities(params, x):
    logits = np.maximum(x @ params["w1"] + params["b1"], 0) @ params["w2"] + params["b2"]
    logits -= logits.max(axis=1, keepdims=True)
    exp = np.exp(logits)
    return exp / exp.sum(axis=1, keepdims=True)


def metrics(probs, y, nclasses):
    pred = probs.argmax(axis=1)
    confusion = np.zeros((nclasses, nclasses), dtype=np.int64)
    np.add.at(confusion, (y, pred), 1)
    support = confusion.sum(axis=1)
    predicted = confusion.sum(axis=0)
    tp = confusion.diagonal().astype(float)
    precision = np.divide(tp, predicted, out=np.zeros_like(tp), where=predicted > 0)
    recall = np.divide(tp, support, out=np.zeros_like(tp), where=support > 0)
    f1 = np.divide(2 * precision * recall, precision + recall, out=np.zeros_like(tp), where=precision + recall > 0)
    top5 = np.argsort(probs, axis=1)[:, -min(5, nclasses):]
    return {
        "samples": len(y), "correct": int((pred == y).sum()),
        "top1_accuracy": float((pred == y).mean()),
        "top5_accuracy": float(np.any(top5 == y[:, None], axis=1).mean()),
        "macro_f1": float(f1.mean()), "balanced_accuracy": float(recall.mean()),
        "cross_entropy": float(-np.log(np.maximum(probs[np.arange(len(y)), y], 1e-12)).mean()),
    }, confusion, [{"support": int(support[i]), "precision": float(precision[i]), "recall": float(recall[i]), "f1": float(f1[i])} for i in range(nclasses)]


def normalize(x, mean, scale):
    return np.clip((np.asarray(x, dtype=np.float32) - mean) / scale, -6, 6).astype(np.float32)


def save_checkpoint(path, params, mean, scale, labels, info):
    temp = path.with_suffix(".tmp")
    with temp.open("wb") as f:
        np.savez_compressed(f, **params, mean=mean, scale=scale, labels=np.asarray(labels), info=np.asarray(json.dumps(info)))
    temp.replace(path)


def load_checkpoint(path):
    with np.load(path, allow_pickle=False) as saved:
        params = {k: saved[k].copy() for k in ["w1", "b1", "w2", "b2"]}
        return params, saved["mean"].copy(), saved["scale"].copy(), saved["labels"].tolist(), json.loads(str(saved["info"]))


def validate_data(data, audit, labels):
    if audit["status"] != "prepared" or audit["signer_overlap"] != 0 or audit["clip_overlap"] != 0:
        raise ValueError("Dataset audit failed")
    if len(labels) != audit["classes"]:
        raise ValueError("Label count mismatch")
    for filename, checksum in audit["prepared_sha256"].items():
        if hashlib.sha256((data / filename).read_bytes()).hexdigest() != checksum:
            raise ValueError(f"Prepared data changed: {filename}")
    split_signers, split_ids = {}, {}
    for split in ["train", "val", "test"]:
        rows = json.loads((data / f"{split}_clips.json").read_text())
        split_ids[split] = {r["clip_id"] for r in rows}
        split_signers[split] = {r["signer"] for r in rows}
        if len(rows) != len(split_ids[split]):
            raise ValueError("Duplicate clip IDs within split")
        x = np.load(data / f"{split}_x.npy", mmap_mode="r", allow_pickle=False)
        y = np.load(data / f"{split}_y.npy", allow_pickle=False)
        if x.shape != (len(rows), 4050) or len(y) != len(rows) or not np.isfinite(x).all():
            raise ValueError(f"Invalid {split} features")
        if y.tolist() != [r["label_id"] for r in rows]:
            raise ValueError("Feature row/label alignment changed")
    for a, b in [("train", "val"), ("train", "test"), ("val", "test")]:
        if split_ids[a] & split_ids[b] or split_signers[a] & split_signers[b]:
            raise ValueError("Split leakage")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, required=True)
    parser.add_argument("--run", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--patience", type=int, default=15)
    parser.add_argument("--hidden", type=int, default=128)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.epochs < 1 or args.patience < 1 or args.hidden < 1:
        parser.error("epochs, patience, and hidden must be positive")
    out, data = args.run.resolve(), args.data.resolve()
    if out.exists() and any(out.iterdir()):
        parser.error("Run directory is not empty; use a new run name to preserve prior results")
    out.mkdir(parents=True, exist_ok=True)
    audit = json.loads((data / "audit.json").read_text())
    labels = json.loads((data / "labels.json").read_text())
    validate_data(data, audit, labels)
    raw = np.load(data / "train_x.npy", allow_pickle=False)
    mean = raw.mean(axis=0)
    scale = np.maximum(raw.std(axis=0), 0.03)
    train_x = normalize(raw, mean, scale)
    del raw
    train_y = np.load(data / "train_y.npy", allow_pickle=False)
    val_x = normalize(np.load(data / "val_x.npy", allow_pickle=False), mean, scale)
    val_y = np.load(data / "val_y.npy", allow_pickle=False)
    rng = np.random.default_rng(args.seed)
    params = {
        "w1": (rng.normal(size=(train_x.shape[1], args.hidden)) * np.sqrt(2/train_x.shape[1])).astype(np.float32),
        "b1": np.zeros(args.hidden, dtype=np.float32),
        "w2": (rng.normal(size=(args.hidden, len(labels))) * np.sqrt(1/args.hidden)).astype(np.float32),
        "b2": np.zeros(len(labels), dtype=np.float32),
    }
    m, v = ({k: np.zeros_like(p) for k, p in params.items()} for _ in range(2))
    config = {"model": "Temporal feature MLP", "input_features": 4050, "hidden": args.hidden, "classes": len(labels), "seed": args.seed, "max_epochs": args.epochs, "patience": args.patience, "batch_size": 64, "learning_rate": 0.0005, "dropout": 0.15, "l2": 0.0001, "optimizer": "Adam", "normalization": "Training-only per-feature mean/std, scale floor 0.03, standardized values clipped to [-6,6]", "threads": 2, "numpy": np.__version__, "python": platform.python_version(), "data_revision": audit["data_revision"], "data_audit_sha256": hashlib.sha256((data / "audit.json").read_bytes()).hexdigest(), "code_sha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "started_at": datetime.now(timezone.utc).isoformat(), "use": "Local noncommercial research; isolated signs; no app integration"}
    write_json(out / "config.json", config)
    start = time.monotonic()
    initial, _, _ = metrics(probabilities(params, val_x), val_y, len(labels))
    history, best_score, best_epoch, best_loss, step = [], -1.0, 0, float("inf"), 0
    print(f"Training {len(labels)} signs, {len(train_y)} train / {len(val_y)} validation clips, {sum(p.size for p in params.values()):,} parameters on CPU.", flush=True)
    print(f"Initial validation accuracy: {initial['top1_accuracy']:.2%}", flush=True)
    try:
        for epoch in range(1, args.epochs + 1):
            weighted_loss = 0.0
            order = rng.permutation(len(train_y))
            for offset in range(0, len(order), 64):
                batch = order[offset:offset + 64]
                loss, grads = loss_and_grad(params, train_x[batch], train_y[batch], dropout=0.15, rng=rng)
                if not np.isfinite(loss) or any(not np.isfinite(g).all() for g in grads.values()):
                    raise ValueError("Nonfinite training loss or gradient")
                weighted_loss += loss * len(batch)
                step += 1
                norm = np.sqrt(sum(float(np.sum(g*g)) for g in grads.values()))
                for k in params:
                    g = grads[k] * min(1.0, 5.0 / max(norm, 1e-8))
                    m[k] *= 0.9
                    m[k] += 0.1 * g
                    v[k] *= 0.999
                    v[k] += 0.001 * g * g
                    params[k] -= 0.0005 * (m[k] / (1-0.9**step)) / (np.sqrt(v[k] / (1-0.999**step)) + 1e-8)
            val, _, _ = metrics(probabilities(params, val_x), val_y, len(labels))
            if val["top1_accuracy"] > best_score or (val["top1_accuracy"] == best_score and val["cross_entropy"] < best_loss):
                best_score, best_loss, best_epoch = val["top1_accuracy"], val["cross_entropy"], epoch
                save_checkpoint(out / "best.npz", params, mean, scale, labels, {**config, "epoch": epoch, "validation": val})
            row = {"epoch": epoch, "training_loss": weighted_loss/len(train_y), "validation": val, "elapsed_seconds": round(time.monotonic()-start, 2)}
            history.append(row)
            write_json(out / "history.json", history)
            write_json(out / "status.json", {"status": "training", "pid": os.getpid(), "epoch": epoch, "best_epoch": best_epoch, "best_validation_accuracy": best_score, "elapsed_seconds": row["elapsed_seconds"]})
            print(f"Epoch {epoch:03d}: loss {row['training_loss']:.4f}, validation {val['top1_accuracy']:.2%}, best {best_score:.2%}, elapsed {row['elapsed_seconds']:.0f}s", flush=True)
            if epoch-best_epoch >= args.patience:
                print(f"Stopped after {args.patience} epochs without validation improvement.", flush=True)
                break
        saved, saved_mean, saved_scale, saved_labels, info = load_checkpoint(out / "best.npz")
        if labels != saved_labels or not np.array_equal(mean, saved_mean) or not np.array_equal(scale, saved_scale):
            raise ValueError("Checkpoint round-trip mismatch")
        # The test set is scored only after checkpoint selection has finished.
        test_x = normalize(np.load(data / "test_x.npy", allow_pickle=False), saved_mean, saved_scale)
        test_y = np.load(data / "test_y.npy", allow_pickle=False)
        inference_start = time.monotonic()
        test, confusion, per_class = metrics(probabilities(saved, test_x), test_y, len(labels))
        inference_seconds = time.monotonic()-inference_start
        np.save(out / "test_confusion.npy", confusion, allow_pickle=False)
        write_json(out / "per-class.json", [{"label": label, **values} for label, values in zip(labels, per_class)])
        report = {
            "status": "completed", "best_epoch": best_epoch, "epochs_completed": len(history),
            "initial_validation": initial, "best_validation": info["validation"], "test": test,
            "chance_top1": 1/len(labels), "majority_class_baseline": float(np.mean(test_y == np.bincount(train_y).argmax())),
            "elapsed_seconds": round(time.monotonic()-start, 2), "test_batch_inference_seconds": inference_seconds,
            "checkpoint_sha256": hashlib.sha256((out / "best.npz").read_bytes()).hexdigest(),
            "splits": {s: {k:v for k,v in audit['splits'][s].items() if k!='per_class'} for s in ['train','val','test']},
            "data_audit": {"duplicate_records_removed": audit['duplicate_manifest_records_removed'], "clip_overlap": 0, "signer_overlap": 0},
            "limitations": ["Closed-set classification of 200 isolated ASL signs, not continuous translation", "Uses precomputed landmarks; raw-video preprocessing parity has not been validated", "No facial landmarks, unsupported-sign evaluation, or real Zoom/Meet testing", "Class scores are not calibrated confidence estimates", "Noncommercial local research checkpoint; not deployed in ClearSign"],
        }
        write_json(out / "report.json", report)
        write_json(out / "status.json", {"status": "completed", "best_epoch": best_epoch, "test_accuracy": test["top1_accuracy"], "elapsed_seconds": report["elapsed_seconds"]})
        print(json.dumps(report, indent=2), flush=True)
    except BaseException as exc:
        write_json(out / "status.json", {"status": "interrupted" if isinstance(exc, KeyboardInterrupt) else "failed", "reason": str(exc), "best_epoch": best_epoch, "elapsed_seconds": round(time.monotonic()-start, 2)})
        raise


if __name__ == "__main__":
    main()
