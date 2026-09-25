# ClearSign

**ClearSign is an accessible communication companion for deaf and hard-of-hearing people and the people they communicate with—in person, in online meetings, and across everyday devices. It brings together live speech and shared meeting-audio captions, readable and spoken replies, and experimental ASL fingerspelling from camera, shared call video, or local recordings into reviewed text and speech. Its meeting workflow is designed for Google Meet, Zoom, Microsoft Teams, and other audio/video apps through browser audio sharing and shareable text. Phones, computers, and optional compatible display glasses are all part of the vision; glasses are not required.**

This repository contains a working early prototype. No special glasses, account, paid API key, or application server is required for the basic communication interface. Speech recognition depends on the browser's speech service. Hand tracking for all three video sources runs locally on the device after installing its model. Adding video input does not provide full ASL word or sentence translation.

## Run locally

Use Node.js 20 or later:

```sh
cd "/home/morshed/AI sign glass"
npm ci
npm run setup:model
npm start
```

Open **http://127.0.0.1:4173**. The library and model are already installed in the initial local copy. `npm ci` and the model setup command make a fresh checkout ready to run. The server binds to loopback by default. Stop it with Ctrl+C. Set `PORT` to change the port.

For a phone, host the app with **HTTPS**. Loading it on a phone through an unencrypted LAN IP will not enable camera or microphone access. `HOST=0.0.0.0` can expose the development server to your network, but it does not provide HTTPS. The included Node server is intended for local development; use a suitable HTTPS host for shared access.

## Features and their current limits

| Feature | What works now | Current limit |
| --- | --- | --- |
| Speech → text | Start/stop captions, interim text, spoken-language selection, readable errors | Requires a browser with the Web Speech recognition API and its service; accuracy and languages vary. Not verified with a physical microphone in this development environment. |
| Meeting audio → text | User-selected shared tab/system audio is passed to speech recognition; copy replies for chat; share the large-text window through the meeting app | Experimental; requires desktop Chrome/Edge 135+ and a working speech service. System-audio capture varies by OS. Actual Zoom, Meet, and Teams calls have not been tested. No native meeting plug-in or account integration. |
| Text → voice | Typed or quick replies, spoken playback, stop voice | Requires a supported browser voice for the selected language. Captions pause to prevent audio feedback. |
| Video signs → text/speech experiment | Camera, shared call video, or local recording; MediaPipe hand landmarks; timestamped suggestions for **A, B, I, L, V, Y**; reviewed text can be displayed, spoken, or copied | **Not a trained ASL recognition model and not a general sign-language translator.** Other signs may resemble these handshapes. No measured recognition accuracy; not yet validated with fluent Deaf signers. |
| Caption display | A separate synchronized large-text browser window with size and contrast controls | Synchronizes within the same browser and origin. Does not pair with glasses or another phone. Compatible glasses can display it through the device's own screen mirroring. |
| Conversation | Latest 120 messages, text download, clear session, labeled sample demo | Conversation text is in memory only; reload clears it. Downloads remain wherever the user saves them. |
| Accessibility | Keyboard controls, semantic tabs, labeled inputs, focus indicators, reduced-motion support, RTL message text, adjustable captions | Requires further testing with assistive technologies and people with different access needs. |

## Why ASL first?

ASL is a practical starting point with public learning and research resources. There is **no universal sign language**, and ASL is not the native sign language of every Deaf community. Spoken-language selection only affects speech input/output; it does not change the ASL experiment. A future version should explicitly support the user's regional sign language.

The fingerspelling experiment only checks a few static, palm-facing, upright handshapes. It rejects unstable or unsupported geometry and waits for a steady candidate; this does **not** establish correctness. The user must verify each letter before adding it to their message. Movement, facial expressions, grammar, full words, sentence translation, and most of the alphabet are unsupported.

## Signs in live calls and recorded videos

The requested direction is **someone signing in video → recognized text → optional speech**. The video workflow is implemented; general sign-language understanding is still unfinished. The installed recognizer checks only six isolated letter shapes. It cannot translate signed words or sentences, and its suggestions can be incorrect for other signs.

1. Open **Sign to text**.
2. Choose a source:
   - **Your camera**: local camera preview, mirrored for convenience.
   - **Live call / shared video**: choose a Zoom, Meet, Teams, or other video tab/window using the browser picker. Enlarge the signer’s video so the hand is visible. This mode captures video only; it does not use speech audio to invent sign text. Support depends on the browser’s screen-capture capability.
   - **Uploaded video**: choose a file on your device, then **Analyze video**. The file is opened locally with a blob URL; it is not uploaded. MP4, WebM, and other browser-supported video formats work subject to codec support. Files are limited to 500 MB.
3. Stable supported letter shapes appear as **unverified, timestamped suggestions**. Confirm individual suggestions to add them to **Reviewed text**, or edit that text yourself. Repeated frames of a held pose produce one queued suggestion.
4. Use **Show text**, **Speak text**, or **Copy text**. Speech is an explicit user action and plays locally. The voice-language control changes pronunciation, not sign-language recognition or translation.

Recordings have pause, replay, speed, and native seek controls. A paused frame cannot accumulate detection confidence. Seeking resets pending recognition and clears the suggestion list; reviewed text is retained. Changing a source clears unreviewed suggestions. At the end of a recording, the text remains available for review and the file can be replayed. The list holds the latest 120 suggestions.

Keep ClearSign visible beside a live call for best processing speed. Hiding the app stops its camera and pauses uploaded playback. Shared video may continue while the meeting tab has focus, subject to browser timer throttling; use **Stop video** or the browser’s **Stop sharing** control to end capture. Closing the page releases all video tracks and local file URLs. No video frames are recorded, sent to a server, or saved by ClearSign.

See [the model integration notes](docs/video-recognition.md) for the remaining work needed to translate actual signed conversations.

## Books and training data

See the [ASL training resource guide](docs/training-resources.md) for reference books, candidate datasets including YouTube-ASL, video-learning links, published use restrictions, and a proposed development sequence. Books can guide vocabulary and grammar; video recognition also needs labeled motion examples. The guide explains how suitable YouTube clips could become reviewed training examples.

Two **200-sign research models have now been trained locally** on ASL Citizen motion features. The second experiment separates finger shape from wrist position, smooths tracking across frames, and represents both hands and upper-body movement. See [the motion experiment and comparison](training/MOTION-RESULTS.md), [the original baseline](training/RESULTS.md), and [training commands](training/README.md). The pipeline removes duplicate source videos and restores the original splits with separate signers for training, validation, and testing. These checkpoints are local noncommercial experiments; **they are not integrated into the browser app and do not translate sentences**. The browser still uses its six-letter geometric experiment.

## Glasses compatibility

Ordinary glasses have no electronic display. This app works on the screen already available to the user. Glasses with a display may show the caption window if they support mirroring from that device. No glasses SDK, Bluetooth pairing, or hardware integration has been implemented, and no glasses have been tested. Do not describe the preview as a connected device.

## Zoom, Google Meet, Teams, and other software

ClearSign is a companion that runs alongside these applications. It does not require access to the user's meeting account or send messages automatically.

1. Join the meeting in a **desktop Chrome or Edge browser tab**, version 135 or later.
2. In ClearSign choose **Online meetings**, then **Start captions**.
3. In the browser's picker choose the meeting tab and enable **Share tab audio**. This shares the audio with ClearSign's browser speech service. The screen picker is required by the browser; ClearSign disables video frames and never displays, records, or uploads them.
4. Keep ClearSign or its separate caption window beside the meeting. If desired, share that window using the meeting app's own screen-sharing control.
5. Type a reply, or review a message in the sign studio. Press **Copy for chat** and paste it into the meeting chat yourself.
6. **Speak reply** plays locally. Sending that voice to the meeting requires the meeting app's computer-audio sharing or a separately configured virtual audio device. The prototype does not create virtual microphones/cameras or put subtitles inside another app's native caption system.

| Environment | Intended workflow | Limitation |
| --- | --- | --- |
| Google Meet, Zoom web, Teams web, other browser calls | Share the meeting's tab with audio | Desktop Chromium 135+ and browser speech recognition required; service-specific call behavior needs real testing. |
| Desktop Zoom, Teams, Discord, and other applications | Share system audio if the browser/OS offers it | App/window sharing may contain no audio. If so, use the browser version. No universal desktop audio driver is included. |
| Safari, Firefox, mobile browsers | Typed replies, local speech features when available, large-text display | Shared audio transcription is deliberately unavailable where the audio-track overload cannot be relied on. |

The audio input is explicit: meeting mode never silently falls back to the microphone. If audio is absent, sharing is stopped and the app explains how to try again. Stopping captions, clearing the session, closing the tab, or using the browser's **Stop sharing** control releases shared tracks. Sharing also stops if speech recognition fails. Meeting capture can continue while using the sign studio; return to Live captions or use Stop sharing to stop it.

## Privacy

- No account, remote database, or transcript upload is included. Browser connection policy permits only local app assets and blob URLs, blocking the vision library’s external usage-logging endpoint. Browser-native speech services are separate and may still process microphone audio or spoken text remotely.
- Microphone and camera access start only after the corresponding button is pressed and browser permission is granted.
- Browser speech recognition may send audio to its provider's servers. It can require internet access. The UI explains this before starting.
- The same applies to shared meeting audio. ClearSign does not record the meeting or request meeting account credentials. The user chooses the audio source each time.
- Camera and shared-video frames are processed with locally served MediaPipe assets; local recordings are played from blob URLs. This application does not upload or record the video. No microphone or video audio is used by the sign recognizer.
- Only language, caption size, and contrast preferences are stored in local storage. Transcript, reply, and sign-message text are not persisted.
- Opening the separate display shares current text with that window in the same browser using a randomly scoped `BroadcastChannel`. Clearing the conversation clears its connected display too.
- Hiding the main page stops its camera and pauses local recordings. Shared sign-video capture and microphone captions may continue; use Stop video / Stop captions explicitly when finished.

## Project structure

```text
public/             Pages, styles, icon, downloaded local model
src/app.js          Conversation UI and session state
src/speech.js       Speech recognition lifecycle and error handling
src/meeting.js      Shared meeting audio, browser support gate, track cleanup
src/sign-video.js   Camera/shared-video/file lifecycle and local frame processing
src/sign.js         Compatibility export for the original camera entry point
src/core.js         Settings, transcript export, experimental handshape rules
src/display.js      Synchronized caption display
server.mjs          Local static server with explicit asset roots
scripts/            Model setup and browser checks
tests/              Unit, lifecycle, server, and browser tests
training/           CPU research trainer, dataset audit, prediction tool, results
```

The interface uses native JavaScript and CSS. MediaPipe Tasks Vision is pinned in `package-lock.json`; no build step is required. The hand-landmark model is versioned upstream and downloaded separately by `npm run setup:model`. It is a **landmark model, not a sign-language translation model**.

## Verification

```sh
npm test
npm run test:browser
npm run test:video
```

Browser tests require Playwright and its Chromium browser. Install the browser using `npx playwright install chromium` after `npm ci`. `PLAYWRIGHT_MODULE` can point to a preinstalled Playwright entry file. Browser tests run their own local server, exercise UI workflows with simulated browser APIs, and load the real hand-landmark model. Video checks use synthetic recordings and simulated screen captures to exercise file decoding, pause/replay, stream cleanup, and reviewed text-to-speech. They load the real landmark model, but do not measure signing accuracy. Simulations verify software behavior, not microphone accuracy, signing accuracy, real Zoom/Meet capture behavior, or glasses compatibility.

## Next development milestones

1. Co-design the interaction with Deaf ASL users and agree on the first useful vocabulary and target devices.
2. Replace geometric candidates with an evaluated recognition model using properly licensed, consented data. Add explicit unknown predictions and correction workflows. Test across signing styles, lighting, skin tones, handedness, motion, and camera positions.
3. Evaluate local speech-to-text for browsers without speech recognition and for users who want offline audio processing.
4. Add an adapter for a selected family of display glasses after verifying its actual display and connectivity capabilities.
   For broader desktop meeting integration, evaluate a native companion with OS audio loopback, an optional virtual microphone/camera, and platform-specific caption APIs. Those integrations are not part of this browser prototype.
5. Validate caption latency, sign accuracy, battery use, and accessibility on real devices before presenting the product as reliable everyday assistive technology.

## References

- [NIDCD: American Sign Language and regional sign languages](https://www.nidcd.nih.gov/health/american-sign-language)
- [MDN: SpeechRecognition and browser/cloud limitations](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [MDN: camera permissions and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MDN: transcription from an audio track](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/start)
- [MDN browser compatibility data: audio-track support](https://github.com/mdn/browser-compat-data/blob/main/api/SpeechRecognition.json)
- [Chrome: user-controlled screen and audio capture](https://developer.chrome.com/docs/web-platform/screen-sharing-controls)
- [Zoom: sharing computer audio with a meeting](https://support.zoom.com/hc/en/article?id=zm_kb&sysparm_article=KB0063608)
- [Google: MediaPipe hand landmark detection for the web](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js)
- [Google MediaPipe Tasks Vision: on-device processing](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md)

Third-party MediaPipe code and model assets remain subject to their respective upstream licenses. This prototype is not affiliated with Google.
