"""Inspect predictions from a research checkpoint on prepared feature vectors."""
import argparse
import json
from pathlib import Path

from train import load_checkpoint, normalize, probabilities
import numpy as np


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--features", type=Path, required=True)
    parser.add_argument("--index", type=int, default=0)
    args = parser.parse_args()
    params, mean, scale, labels, info = load_checkpoint(args.checkpoint)
    x = np.load(args.features, mmap_mode="r", allow_pickle=False)
    if x.ndim != 2 or x.shape[1] != len(mean) or not 0 <= args.index < len(x):
        parser.error("Expected a prepared feature matrix and an index within it")
    sample = x[args.index:args.index+1]
    if not np.isfinite(sample).all():
        parser.error("Features must be finite")
    probs = probabilities(params, normalize(sample, mean, scale))[0]
    top = np.argsort(probs)[-5:][::-1]
    print(json.dumps({"mode": "Research: isolated signs only; scores are not calibrated confidence", "predictions": [{"label": labels[i], "score": float(probs[i])} for i in top]}, indent=2))


if __name__ == "__main__":
    main()
