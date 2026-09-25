# Local ASL model training

This directory trains an experimental classifier for **200 isolated ASL signs** from real-video motion features. It does not translate continuous sentences, and it does not replace ClearSign's current six-letter browser experiment. Checkpoints are local research artifacts, not automatically loaded by the app.

## Dataset and evaluation

The input is the [ASL Citizen processed keypoints dataset](https://huggingface.co/datasets/SharoonArshad/asl-citizen-processed-200), pinned to revision `0dbf1ca7e7f9a1c3f626b5738683f06145fde699`. It contains precomputed body and hand coordinates extracted from real signing videos. The mirror declares CC BY-NC-SA 4.0; the original [Microsoft Research dataset terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/) also apply. This run is local, noncommercial research. The mirror's declaration does not replace the original terms. Source data and checkpoints stay outside version control and the web server's asset roots.

**Do not use the mirror's supplied train/test split.** Our audit found 3,552 duplicate video records across its manifests. `prepare.py` reads the original Microsoft archive's split CSVs using HTTP byte ranges, joins every source video to its original split, and removes duplicate video IDs before preparing examples. The original train, validation, and test groups use separate signers. It also verifies labels, downloaded shard checksums, finite landmarks, and identical feature sequences under different IDs. The slash/hyphen spelling of `HURDLE/TRIP1` is normalized back to the official label.

The preparation downloads approximately **1.21 GB**, comprising 27 feature shards and small metadata files. It does not download the full 45.9 GB video archive, scrape YouTube, or collect the user's meeting videos. Cached shards are verified and reused. `data/asl-citizen-200/audit.json` records exact file hashes, counts, provenance, split checks, and feature specifications.

## Model

- Each source sample contains 200 frames and 450 values per frame: 225 position values and 225 velocity values. The upstream landmarks comprise body pose and both hands, with shoulder-based normalization.
- This baseline uses position coordinates to form 16 ordered time-bin means, overall standard deviations, and coordinate ranges: 4,050 input values. Keeping bins in time order retains coarse motion information.
- A learned 128-unit ReLU hidden layer and 200-class softmax output are trained from random initialization using Adam and dropout. This is a small temporal-feature neural network, not a pretrained language model.
- Feature standardization is fitted on training examples only. Validation accuracy selects the best checkpoint. The test set is scored once after training and checkpoint selection finish.
- Execution uses NumPy and limits BLAS to two CPU threads. No GPU, account, paid API, or cloud upload is required.

## Setup and commands

### Motion ideas experiment

The second experiment uses ideas from temporal skeleton tracking while retaining our existing MediaPipe-derived data and NumPy runtime. It introduces separate representations for palm-scaled finger shape and body-relative wrist/arm position, a five-frame causal smoother that resets across tracking gaps, explicit hand-presence channels, and ordered position/velocity summaries. Only the head, shoulders, elbows, wrists, and both hands contribute; lower-body landmarks are omitted. The result has 5,270 features per clip. Velocity is measured in normalized clip time, not metres per second. The classifier summarizes a complete 200-frame sequence; causal smoothing alone does not make it a streaming recognizer.

The original trainer and checkpoint remain reproducible. Because the representation and regularization change together, this experiment does not isolate the benefit of either change. The new trainer uses the same 128-unit hidden layer, with dropout increased from 0.15 to 0.35 and L2 regularization from 0.0001 to 0.001 to address overfitting. It selects a checkpoint using validation only, then evaluates once on the same test cohort as the baseline. That cohort has been reported before; this is a comparative experiment, not a new blind test. No GEM-X code, model weights, or runtime dependency was added.

See [the motion experiment results](MOTION-RESULTS.md). The prepared dataset and first motion run are already saved on this computer. For a fresh preparation and another run, choose new output/run paths:

```sh
.venv-training/bin/python -u training/prepare_motion.py \
  --source training/data/asl-citizen-200 \
  --output training/data/asl-citizen-motion-next

.venv-training/bin/python -u training/train_motion.py \
  --data training/data/asl-citizen-motion-next \
  --run training/runs/asl200-motion-next
```

Preparation is offline and uses the already downloaded, checksum-verified shards. It preserves all 6,743 accepted clips, canonical labels, row order, and original signer splits. Neither data preparation nor training uploads footage. The browser's live recognition is still the six-letter experiment; these new motion features are part of the research training pipeline.

### Python environment

On a machine with Python's venv support:

```sh
python3 -m venv .venv-training
.venv-training/bin/python -m pip install -r training/requirements.txt
```

On this computer, NumPy is already installed and Python's `ensurepip` is absent. The environment was created with `python3 -m venv --without-pip --system-site-packages .venv-training`, so it uses the installed NumPy without modifying system packages. Each run records the exact Python and NumPy versions.

From the repository root:

```sh
# Verify numerical gradients, split handling, feature order, metrics, and checkpoint reloads.
.venv-training/bin/python -m unittest discover -s training -p 'test_*.py' -v

# Download, verify, and prepare the corrected dataset. Network access is needed here.
.venv-training/bin/python -u training/prepare.py --output training/data/asl-citizen-200

# Train offline; choose a NEW run directory for each experiment.
.venv-training/bin/python -u training/train.py \
  --data training/data/asl-citizen-200 \
  --run training/runs/asl200-next \
  --epochs 100 --patience 15

# Inspect one prepared example. This command does not accept raw video files.
.venv-training/bin/python training/predict.py \
  --checkpoint training/runs/asl200-next/best.npz \
  --features training/data/asl-citizen-200/val_x.npy --index 0
```

Training stops early if validation does not improve for 15 epochs. A run directory must be new to avoid overwriting previous results. Ctrl+C stops training; the best completed checkpoint remains available, and status is recorded as interrupted. A later invocation with a new run name retrains from the fixed random seed; optimizer resume is not implemented.

## Outputs

| File in a run directory | Contents |
| --- | --- |
| `status.json` | Training/completed/interrupted/failed state and progress |
| `config.json` | Seed, hyperparameters, environment, and code/data hashes |
| `history.json` | Per-epoch training loss and validation metrics |
| `best.npz` | Learned weights, training normalization, label map, and selected epoch; no pickle required |
| `report.json` | Final selected-checkpoint test metrics, evaluation policy, timing, and limitations |
| `per-class.json`, `test_confusion.npy` | Per-sign errors and confusion matrix |

Data, environment, and run outputs are ignored by Git. The static app server serves only its explicit public/source/vendor roots and does not expose this directory.

## Before this model can recognize live video

Raw camera or uploaded-video preprocessing still needs to be implemented and checked against the upstream feature pipeline. The current app only tracks hands; this research model also requires body landmarks. It does not use facial cues or handle automatic sentence boundaries. Its scores are not calibrated, and its 200-class evaluation contains no unknown signs or ordinary non-signing movements.

A useful integration needs preprocessing parity tests, unsupported-sign rejection, streaming segmentation, and consented real-call evaluation with fluent ASL signers. Existing word-level benchmark accuracy does not establish conversation translation, safe automatic speech, or performance on Zoom/Meet. Keep the review-and-correct workflow when connecting a validated model.
