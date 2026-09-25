# First ASL training run: results

**The first local training run completed. Its first-choice accuracy on separate test signers was 19.38%. This is too low for everyday communication.** The trained checkpoint is saved for further research; the browser app continues using its six-letter experiment.

Run: `asl200-first`, started 2026-09-21T20:40:02.977664+00:00. Trained from random initialization for 200 isolated ASL signs using body/hand motion features extracted from real ASL Citizen videos. No YouTube videos, user recordings, paid service, or GPU were used.

## Measured results

| Measure | Result |
| --- | --- |
| Test first-choice accuracy | **19.38%** (542 correct out of 2,797) |
| Test top-five accuracy | 43.90% — the correct sign appeared somewhere in five suggestions |
| Test macro F1 | 0.1922 |
| Best validation first-choice accuracy | 26.39% |
| Random-guess first-choice baseline | 0.50% for 200 classes |
| Training-majority-class test baseline | 0.61% |
| Selected checkpoint | Epoch 68 |
| Training stopped | Epoch 83, after 15 epochs without validation improvement |
| Training and final scoring time | 91.05 seconds; excludes download and data preparation |

Top-five accuracy is a shortlist measure, not translation accuracy. This test used isolated clips containing one of the 200 known signs. It did not include full conversations, unsupported signs, ordinary hand movements, or live meeting capture. The drop from validation to test performance also shows why the separate test set matters.

## Data audit

| Split | Clips used | Distinct signers |
| --- | --- | --- |
| Train | 3,192 | 31 |
| Val | 754 | 5 |
| Test | 2,797 | 11 |

The prepared mirror listed 10,296 records, including **3,552 duplicate source-video records**. Its supplied split mixed videos from the original Microsoft training and test sets. We reconstructed splits using exact original video IDs and removed duplicates. There are no overlapping source videos or signers between the three corrected splits. One empty landmark sequence was excluded, leaving 6,743 usable clips. A matching check found no identical feature sequences under different video IDs among the accepted examples.

The [processed feature source](https://huggingface.co/datasets/SharoonArshad/asl-citizen-processed-200) is pinned to revision `0dbf1ca7e7f9a1c3f626b5738683f06145fde699`. The original split CSVs came directly from Microsoft's dataset archive. The mirror's published benchmark results are not comparable to this corrected evaluation.

## What was saved

- [Training and setup instructions](README.md)
- [Structured results](runs/asl200-first/report.json)
- [Epoch history](runs/asl200-first/history.json)
- [Best checkpoint](runs/asl200-first/best.npz)
- [Per-sign metrics](runs/asl200-first/per-class.json)
- [Data provenance and split audit](data/asl-citizen-200/audit.json)

The checkpoint contains 544,328 learned parameters, normalization fitted only on training data, the canonical sign label map, and the selected epoch. It uses a 128-unit temporal-feature neural network. Checkpoint SHA-256: `c5bfa00f8efe42674f1826afd177308a9712a972741be3241eac2dcbdf012202`.

The numerical gradients, checkpoint reload, temporal ordering, metrics, normalization, label checks, and split restoration passed seven automated checks. The saved checkpoint was also loaded through the prediction command. These verify the training software; the separate test metrics above measure this model's limited recognition performance.

A subsequent [motion experiment and comparison](MOTION-RESULTS.md) is available. The original run and checkpoint described here are preserved.

## Next model work

Improve generalization using stronger sequence representations and suitable additional training examples; the falling training loss and much lower held-out accuracy indicate overfitting. Tune using training and validation data, and preserve a separate test protocol. Add unsupported-sign evaluation and rejection before considering automatic output.

Raw-video preprocessing still needs to match the training features, including body landmarks and both hands. Facial cues and continuous-sentence translation need additional modeling. Real Zoom/Meet and user-recorded video performance have not been measured.

This checkpoint is kept locally for noncommercial research under the applicable [ASL Citizen dataset terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/) and processed-source conditions. It has not been deployed or connected to the app. Source data and checkpoints are excluded from Git and are not served by the app's static server.
