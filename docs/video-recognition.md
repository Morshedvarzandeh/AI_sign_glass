# Video signing to text and speech: implementation status

The intended product translates a person’s signing in live video calls and uploaded recordings into readable language and optional speech. The source handling and output workflow now support that direction. **The model needed for general ASL word/sentence translation has not been integrated.**

## Implemented

- Camera, user-selected meeting tab/window, and local video-file inputs.
- Local video playback with pause, seek, speed, and replay.
- Video-only frame processing with a pinned, locally served MediaPipe hand-landmark model.
- A bounded queue of timestamped letter suggestions, with confirmation before entering reviewed text.
- Direct display, speech, and copy actions for reviewed text. Nothing is automatically spoken.
- Stream and file-URL cleanup after errors, cancellation, source changes, sharing termination, and page close.
- A browser connection policy blocks external requests from page scripts, including the MediaPipe runtime’s usage-logging endpoint. Local model assets and file blob URLs remain available. Browser-native speech recognition/synthesis services are not controlled by this page policy.

The existing geometric classifier only considers A, B, I, L, V, and Y. It accepts one upright hand at a time. These restrictions deliberately remain visible in the interface. The model finds hand positions; it is not itself trained to understand ASL. A detector loading successfully is not evidence of sign-language accuracy.

## Model research

The following sources were inspected on September 21, 2026. None was integrated or used to claim sentence translation:

- [SignBart, author repository](https://github.com/TinhNguyen2312/SignBart) publishes research code and checkpoint links for **isolated sign classification**, including WLASL and ASL-Citizen subsets. An integration would require matching its pose/hand preprocessing, obtaining the exact label map, reviewing the checkpoint’s applicable license, and evaluating real recordings. Its benchmark results do not establish continuous-conversation translation.
- [ASL-Citizen small transformer model card](https://huggingface.co/SharoonArshad/asl-citizen-small-transformer-encoder-200) describes a model for 200 isolated ASL classes with fixed-length pose and hand sequences. Its model card explicitly limits it to isolated signs and lists a noncommercial share-alike license. It is not a sentence-translation drop-in.
- [WLASL, dataset authors](https://github.com/dxli94/WLASL) describes word-level ASL data and research models. Dataset coverage, use restrictions, and isolated-word framing need to be considered before choosing a checkpoint for a product.

See the [ASL books and training resource guide](training-resources.md) for learning references, dataset candidates, and a proposed training and evaluation sequence.

## Local training experiments

A 200-class temporal-feature neural network has now been trained from random initialization on precomputed ASL Citizen body/hand motion features. The [training directory](../training/README.md) contains the reproducible preparation, training, tests, and checkpoint-prediction tools; [the results](../training/RESULTS.md) report actual evaluation metrics. Dataset duplicates were removed, and the original Microsoft splits were restored so evaluation uses different signers.

A second [motion experiment](../training/MOTION-RESULTS.md) separates palm-scaled finger shape from body-relative wrist position, smooths valid tracking histories, and adds ordered velocity summaries for both hands and the upper body. It retains the same clips and signer splits, with stronger regularization. It uses the existing landmark data and NumPy runtime; no GEM-X code or weights are required.

Both checkpoints are offline research models. The browser does not load them. Both consume prepared motion features and lack a validated raw-video adapter, facial cues, unsupported-sign rejection, and a continuous-sentence decoder. Connecting it to live calls and uploaded videos requires the integration and evaluation below.

## Remaining work

1. Choose a properly licensed model with published input preprocessing, label/token mapping, weights, and evaluation. Decide whether the first useful release recognizes a defined vocabulary of isolated words or translates continuous sentences.
2. Add the required temporal representation: both hands, body pose, and facial cues where the chosen model uses them. The current one-hand letter rules are insufficient.
3. Implement frame sampling, video segmentation, language decoding, rejection of unsupported signs, and output correction appropriate to that model. Word-label sequences are not automatically grammatical English.
4. Evaluate with fluent Deaf ASL signers and consented real clips across signers, lighting, backgrounds, camera positions, and meeting-video compression. Report measured errors and latency separately from software tests.
5. Only enable automatic text or speech after the recognition system meets agreed quality criteria. Keep review and correction available.

## Browser source references

- [MDN: user-selected display/video capture](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)
- [MDN: video playback and failures](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)

Browser sharing access is separate from access to Zoom/Meet participant video through a platform SDK. This prototype uses the visible video selected by the user; it does not access meeting accounts or private participant streams.
