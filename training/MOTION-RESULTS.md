# Motion ideas experiment: results

**The second local 200-sign experiment completed. First-choice test accuracy increased by 22.06 percentage points, from 19.38% to 41.44%.** This remains experimental and is not connected to the browser app.

Run: `asl200-motion-v2`, started 2026-09-23T04:31:47.432275+00:00. It uses the same ASL Citizen clips, labels, row order, and signer splits as the [first run](RESULTS.md). The test cohort has already been reported in that first run; this is a comparison on a reused holdout, not a new blind evaluation. The new checkpoint was selected using validation only, then scored on that cohort once.

## Ideas applied

Inspired by the temporal skeleton-tracking approach discussed in [gem-x.cpp](https://github.com/localai-org/gem-x.cpp), this experiment keeps the existing MediaPipe-derived data and NumPy training environment:

- Separate each hand's palm-scaled finger shape from its wrist position relative to the shoulders.
- Include both hands and the head, shoulders, elbows, and wrists.
- Smooth each coordinate using up to five current/past frames, resetting when tracking is missing.
- Retain hand-presence indicators and ordered position/velocity summaries so movement direction contributes.
- Increase dropout from 0.15 to 0.35 and L2 regularization from 0.0001 to 0.001.

No GEM-X code, weights, or dependency was added. Features were rebuilt offline from the cached, checksum-verified source shards. The original trainer and checkpoint are preserved. Representation, parameter count, and regularization changed together, so this run does not isolate which change caused the result.

## Measured comparison

| Measure | Original baseline | Motion experiment |
| --- | --- | --- |
| Test first-choice accuracy | 19.38% (542/2,797) | **41.44% (1,159/2,797)** |
| Test top-five accuracy | 43.90% | 65.36% |
| Test macro F1 | 0.1922 | 0.4092 |
| Test balanced accuracy | 19.32% | 41.57% |
| Best validation accuracy | 26.39% | 46.42% |
| Selected epoch | 68 | 64 |
| Epochs completed | 83 | 79 |
| Input features | 4,050 | 5,270 |
| Learned parameters | 544,328 | 700,488 |

Top-five accuracy means the correct sign is somewhere in a five-label shortlist; it is not translation accuracy. Each clip contains one of 200 known isolated signs. Random-choice accuracy is 0.50%. No additional hyperparameter runs were selected using the test results. Training used a fixed seed of 42, the same 128-unit hidden layer width, and two CPU threads. The recorded elapsed time for validation of data, training, and final scoring was 1133.33 seconds, excluding feature preparation.

## Evaluation cohort

| Split | Clips | Distinct signers |
| --- | --- | --- |
| Train | 3,192 | 31 |
| Validation | 754 | 5 |
| Test | 2,797 | 11 |

All 6,743 accepted clips were preserved. Clip IDs, labels, and row order were checked against the original prepared dataset; no source clips or signers overlap between splits. The original data audit and applicable source terms remain in effect. The run records feature-code, trainer-code, prepared-array, metadata, and checkpoint hashes.

## Saved artifacts and checks

- [Training commands and explanation](README.md)
- [Motion feature implementation](motion_features.py) and [trainer](train_motion.py)
- [Structured results](runs/asl200-motion-v2/report.json)
- [Configuration and code hashes](runs/asl200-motion-v2/config.json)
- [Epoch history](runs/asl200-motion-v2/history.json)
- [Best checkpoint](runs/asl200-motion-v2/best.npz)
- [Per-sign metrics](runs/asl200-motion-v2/per-class.json)
- [Prepared-data audit](data/asl-citizen-motion-v2/audit.json)

Checkpoint SHA-256: `1328bf323ee79f40512ccccd655746a2d5f69fd2f8285d4315011d88a9ec7111`.

All 14 training checks passed, covering the original numerical/serialization checks plus motion direction, translation/scale invariance, separate hand shape and wrist location, smoothing across gaps, invalid inputs, checksum changes, and signer leakage. The saved checkpoint was also loaded through the prediction command on a validation example. These checks verify software behavior; the recognition measurements are reported separately above.

```sh
.venv-training/bin/python training/predict.py \
  --checkpoint training/runs/asl200-motion-v2/best.npz \
  --features training/data/asl-citizen-motion-v2/val_x.npy --index 0
```

## Current limits

This classifier uses complete, preprocessed 200-frame clips. Its velocity is relative to normalized clip time, not physical speed. Causal smoothing does not make the whole classifier a streaming recognizer. Matching raw-video preprocessing, automatic sign boundaries, unsupported-sign rejection, calibrated confidence, facial grammar, and sentence translation remain unfinished. There has been no evaluation on real Zoom/Meet calls and no user study of the app with fluent Deaf signers.

The browser continues to offer its six-letter geometric experiment with review before text or speech. The research checkpoint stays local under the applicable noncommercial [ASL Citizen terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/) and processed-source conditions; data and checkpoints are excluded from version control and the app's asset roots.
