# ASL books and video resources for model development

Sources checked September 21, 2026. A first local research model has now been trained on an ASL Citizen motion-feature subset; see [the training results](../training/RESULTS.md). The books and remaining datasets below are references and candidates. ClearSign's browser still recognizes only six experimental letter shapes: the research model has not been integrated, and sentence translation remains unfinished.

## What books can contribute

Books can guide vocabulary selection and annotation rules. They explain how handshape, orientation, location, movement, and nonmanual signals distinguish signs. For ClearSign's video input, the proposed recognition model must also learn from labeled video sequences showing those features over time. Adding a PDF to the app would not train its current geometric classifier.

| Book | Suggested use in ClearSign |
| --- | --- |
| [The American Sign Language Handshape Dictionary, second edition](https://gupress.gallaudet.edu/Books/T/The-American-Sign-Language-Handshape-Dictionary), Richard A. Tennant and Marianne Gluszak Brown | Reference for a defined vocabulary and the features that distinguish similar signs. The publisher describes more than 1,900 illustrated signs organized by handshape. |
| [Linguistics of American Sign Language: An Introduction, fifth edition](https://gupress.gallaudet.edu/Books/L/Linguistics-of-American-Sign-Language-5th-Ed), Clayton Valli, Ceil Lucas, Kristin J. Mulrooney, and Miako Villanueva | Reference for annotation and language evaluation: sign structure, morphology, syntax, meaning, and variation. The publisher also provides accompanying signed demonstrations. |

These books are learning references. This project has not obtained permission to reproduce their illustrations or use their text or associated videos as machine-learning training data. Reading or purchasing a reference is separate from establishing the applicable reuse rights.

## Video datasets to investigate

| Resource | Coverage and proposed role | Published use conditions |
| --- | --- | --- |
| [ASL Citizen — Microsoft Research](https://www.microsoft.com/en-us/research/project/asl-citizen/) | Approximately 84,000 videos covering 2,700 isolated ASL signs, collected with contributor consent. A processed 200-sign subset is now used in our first local research experiment. It does not by itself supply sentence translation. | The [dataset terms](https://www.microsoft.com/en-us/research/project/asl-citizen/dataset-license/) permit noncommercial, non-revenue-generating research and restrict redistribution. Commercial use needs separate arrangements with Microsoft. |
| [How2Sign — dataset authors](https://how2sign.github.io/) | More than 80 hours of continuous ASL with English transcripts and other modalities. Candidate for later research into signed sentences. The authors provide manually realigned timestamps because the original clip boundaries do not always align with the signed content. | Published for research under CC BY-NC 4.0. Attribution and noncommercial restrictions apply; it is not a commercially cleared training source for this project. |

Dataset availability does not establish that a trained model will work reliably on compressed Zoom/Meet video, unfamiliar signers, or everyday conversations. Those are separate evaluation tasks. The ASL Citizen motion features are stored locally for the research run; books, How2Sign, and YouTube media have not been downloaded.

The [training implementation](../training/README.md) identifies the processed feature source, exact revision, license conditions, and data audit. Its published split contained duplicate source videos. Our preparation removes those duplicates and reconstructs the original Microsoft splits with separate signers before training. Results from this corrected evaluation should not be compared directly to results reported using the mirror's supplied split.

## YouTube videos and existing research

YouTube is a useful source to investigate for signed conversations and lessons. An existing research effort already addresses this: [Google Research's YouTube-ASL](https://github.com/google-research/google-research/blob/master/youtube_asl/README.md) reports 11,093 videos, 984 hours, and 610,193 English captions at collection time. Native Deaf annotators filtered video quality and caption alignment. The release provides video IDs; it is not a packaged collection of video files or a ready-to-run recognition model.

The [YouTube-ASL paper, Appendix B.6](https://papers.nips.cc/paper/2023/file/5c61452daca5f0c260e683b317d13a3f-Paper-Datasets_and_Benchmarks.pdf) licenses the released IDs under CC BY 4.0 and distinguishes them from the underlying videos and captions, which remain subject to YouTube's terms. Availability changes when creators delete or privatize videos. This is a research candidate, not a source whose use in ClearSign has been cleared.

For learning and vocabulary planning, start with these creator and institution links:

| Reference | Role and current status |
| --- | --- |
| [Bill Vicars / ASL University on YouTube](https://www.youtube.com/@sign-language), linked by [his official biography](https://www.lifeprint.com/asl101/pages-layout/bio.htm) | ASL instruction to consult while planning vocabulary. Lifeprint's [published permission rules](https://www.lifeprint.com/asl101/pages-layout/permission.htm) permit linking and self-study but restrict app reuse. Link as a learning reference; no training or reproduction permission has been obtained. |
| [Gallaudet ASL Connect topic videos](https://gallaudet.edu/asl-connect/topics/) | An institution's video lessons for checking vocabulary and finding learning material. This educational page does not establish permission to train ClearSign on its videos. |

### Turning suitable videos into training examples

The following is a proposed workflow, not an implemented YouTube importer:

1. Identify the sign language and select clips with visible hands, face, and upper body. Have a fluent ASL reviewer verify what is signed.
2. Establish usable rights and an authorized source for each clip. Prefer creator-supplied originals with explicit training permission, or appropriately licensed material with verified provenance. [YouTube's license guide](https://support.google.com/youtube/answer/2797468?hl=en) distinguishes the default Standard license from Creative Commons and describes the Creative Commons search filter. Public viewing access alone is not a training-permission record.
3. Pair each signing segment with a checked meaning and start/end times. Automatic speech captions may describe a teacher's explanation or voice-over rather than the visible signing. The YouTube-ASL paper discusses this alignment problem; captions should not be accepted as correct training labels without review.
4. Record the source URL, creator, permission or license evidence, language, clip boundaries, translation, review status, and a dataset-local signer identifier. Keep unreviewed candidates outside the training set.
5. Split evaluation data by signer and source video, avoiding adjacent clips from the same recording in both training and testing. Evaluate meeting-style footage separately before drawing conclusions about live calls.

No YouTube media has been downloaded, embedded, or used for training in this update. The app's local-file analysis is inference only; opening a video does not train a model.

## Proposed development sequence

1. **Define a useful first vocabulary with Deaf ASL signers.** Start with a small set of isolated signs; record sign variants and intended meanings. Keep continuous conversation translation as a separate milestone.
2. **Select usable data and a reproducible baseline.** Confirm the data and model licenses for the intended use. Preserve the dataset version, source, label map, consent provenance, and attribution. For newly collected clips, obtain explicit consent for training; normal meeting sharing or video analysis must not silently become training collection.
3. **Train on motion.** Use the chosen model's exact preprocessing for time sequences of both hands, body pose, and facial cues where required. The existing hand-landmark detector can locate hands but does not understand ASL. Include unsupported signs and ordinary movements when evaluating rejection behavior.
4. **Measure generalization.** Keep evaluation signers separate from training signers where possible, document the split, and prevent duplicate clips or adjacent frames leaking across splits. Report per-sign errors, false detections on unsupported input, latency, and performance on consented real call recordings. Use fluent ASL reviewers for meaning and variants.
5. **Connect a validated model to both video sources.** Reuse camera, shared-video, and local-file inputs. Preserve timestamped suggestions, correction, and explicit speech controls. Claim only the vocabulary and conditions actually evaluated.
6. **Develop sentence translation separately.** Continuous signing needs segmentation and translation of meaning, including grammatical and facial cues. Joining isolated English word labels is not sufficient. Evaluate sentence meaning with fluent Deaf ASL signers before describing it as conversation translation.

See [the video implementation notes](video-recognition.md) for the current model research and integration gaps.
