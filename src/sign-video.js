import { classifyHand, createVideoCandidateGate, validateVideoFile } from './core.js';

const CONNECTIONS = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[9,13],[13,14],[14,15],[15,16],[13,17],[0,17],[17,18],[18,19],[19,20]];
async function loadDetector() {
  const { HandLandmarker, FilesetResolver } = await import('/vendor/vision_bundle.mjs');
  const files = await FilesetResolver.forVisionTasks('/vendor/wasm');
  return HandLandmarker.createFromOptions(files, {
    baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'CPU' },
    runningMode: 'VIDEO', numHands: 2,
    minHandDetectionConfidence: 0.7, minHandPresenceConfidence: 0.7, minTrackingConfidence: 0.7,
  });
}

// All sources feed the same local experiment. Audio is never used to infer signs.
export class SignVideo {
  constructor(video, canvas, callbacks, dependencies = {}) {
    this.video = video; this.canvas = canvas; this.callbacks = callbacks;
    this.mediaDevices = dependencies.mediaDevices ?? navigator.mediaDevices;
    this.loadDetector = dependencies.loadDetector ?? loadDetector;
    this.urls = dependencies.urls ?? URL;
    this.active = false; this.source = 'camera'; this.generation = 0;
    this.gate = createVideoCandidateGate();
    this.processingCanvas = document.createElement('canvas');
  }
  status(state) { this.callbacks.status(state, this.source); }
  async start({ source = 'camera', file } = {}) {
    this.stop(); this.source = source;
    const generation = this.generation;
    this.events = new AbortController(); const signal = this.events.signal;
    this.active = true; this.callbacks.discontinuity?.();
    this.video.controls = false; this.video.autoplay = false;
    this.video.muted = true; this.video.playbackRate = 1;
    this.video.closest('.camera-stage')?.classList.toggle('mirrored', source === 'camera');
    this.video.setAttribute('aria-label', source === 'camera' ? 'Mirrored camera preview' : source === 'screen' ? 'Shared signing video preview' : 'Uploaded signing video');
    this.status('starting');
    let preparing = true;
    try {
      if (!['camera', 'screen', 'file'].includes(source)) throw new Error('unknown-source');
      if (source === 'file') {
        const error = validateVideoFile(file); if (error) throw new Error(error);
        this.objectURL = this.urls.createObjectURL(file);
        this.video.src = this.objectURL; this.video.load();
        await this.waitForMetadata(signal);
      } else {
        let stream;
        if (source === 'screen') {
          if (!this.mediaDevices?.getDisplayMedia) throw new Error('screen-unavailable');
          stream = await this.mediaDevices.getDisplayMedia({
            video: { displaySurface: 'browser', frameRate: { ideal: 15 } }, audio: false,
            selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'exclude',
          });
        } else {
          if (!this.mediaDevices?.getUserMedia) throw new Error('secure-context');
          stream = await this.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } } });
        }
        // Release late permission grants after the user has cancelled our session.
        if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        stream.getAudioTracks().forEach(track => { track.stop(); stream.removeTrack(track); });
        if (!stream.getVideoTracks().some(track => track.readyState === 'live')) throw new Error('no-video');
        stream.getVideoTracks().forEach(track => track.addEventListener('ended', () => {
          if (generation !== this.generation) return;
          this.stop(); this.callbacks.info?.(source === 'screen' ? 'Shared video ended. Choose a live video again to continue.' : 'The camera disconnected. Reconnect it and try again.');
        }, { once: true, signal }));
        this.video.srcObject = stream; await this.video.play();
      }
      if (generation !== this.generation) return;
      this.status('loading');
      const detector = await this.loadDetector();
      if (generation !== this.generation) { detector.close(); return; }
      this.detector = detector; this.lastVideoTime = -1; this.lastFrame = -100;
      this.video.addEventListener('pause', () => {
        if (preparing || source !== 'file') return;
        this.resetCandidate(); this.status(this.video.ended ? 'ended' : 'paused');
      }, { signal });
      this.video.addEventListener('play', () => { if (!preparing) { this.resetCandidate(); this.status('active'); } }, { signal });
      this.video.addEventListener('ended', () => { this.resetCandidate(); this.status('ended'); }, { signal });
      this.video.addEventListener('seeking', () => {
        this.resetCandidate(); this.lastVideoTime = -1; this.callbacks.discontinuity?.();
      }, { signal });
      this.video.addEventListener('error', () => {
        if (generation !== this.generation) return;
        this.stop(); this.callbacks.error('This video could not be decoded. Try another MP4 or WebM recording supported by your browser.');
      }, { signal });
      preparing = false;
      this.video.controls = source === 'file';
      if (source === 'file') await this.video.play();
      if (generation !== this.generation) return;
      this.status('active'); this.tick(generation);
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      const messages = {
        NotAllowedError: source === 'screen' ? 'Video sharing was cancelled or denied. Choose a meeting tab or window when ready.' : 'Camera permission was denied. Allow camera access in your browser, then try again.',
        NotFoundError: 'No video source was found. Connect a camera or choose a recording.',
        NotReadableError: 'The selected video source is busy or unavailable. Close other camera apps or choose another video.',
        NotSupportedError: 'This video format cannot be played here. Try an MP4 or WebM recording supported by your browser.',
        'secure-context': 'Camera access needs HTTPS, or localhost on this computer.',
        'screen-unavailable': 'Live video sharing is unavailable here. Use a desktop browser that supports screen sharing, or choose a recorded video.',
        'no-video': 'The selected source contains no live video. Choose a tab or window showing the signer.',
        'missing-file': 'Choose a video file first.', 'invalid-file': 'Choose a video recording, such as MP4 or WebM.',
        'empty-file': 'That video file is empty. Choose another recording.',
        'large-file': 'Choose a recording smaller than 500 MB, or trim it into shorter clips.',
        'decode-error': 'This video could not be decoded. Try another MP4 or WebM recording.',
        'load-timeout': 'The video did not load. Try a shorter recording or another video format.',
      };
      this.callbacks.error(messages[error.message] || messages[error.name] || 'Hand tracking could not load. Video capture has stopped. Check the model setup in the project README.');
    }
  }
  waitForMetadata(signal) {
    if (this.video.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timeout); this.video.removeEventListener('loadedmetadata', loaded);
        this.video.removeEventListener('error', failed); signal.removeEventListener('abort', cancelled);
      };
      const loaded = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('decode-error')); };
      const cancelled = () => { cleanup(); reject(new DOMException('Cancelled', 'AbortError')); };
      const timeout = setTimeout(() => { cleanup(); reject(new Error('load-timeout')); }, 20000);
      this.video.addEventListener('loadedmetadata', loaded, { once: true });
      this.video.addEventListener('error', failed, { once: true });
      signal.addEventListener('abort', cancelled, { once: true });
      if (signal.aborted) cancelled();
    });
  }
  tick(generation) {
    if (generation !== this.generation || !this.active) return;
    const now = performance.now();
    if (this.video.readyState >= 2 && !this.video.paused && !this.video.ended && !this.video.seeking && this.video.currentTime !== this.lastVideoTime && now - this.lastFrame >= 90) {
      this.lastVideoTime = this.video.currentTime; this.lastFrame = now;
      try {
        const scale = Math.min(1, 960 / Math.max(this.video.videoWidth, this.video.videoHeight));
        const input = this.processingCanvas;
        input.width = Math.max(1, Math.round(this.video.videoWidth * scale));
        input.height = Math.max(1, Math.round(this.video.videoHeight * scale));
        input.getContext('2d').drawImage(this.video, 0, 0, input.width, input.height);
        const result = this.detector.detectForVideo(input, now);
        const singleHand = result.landmarks.length === 1 ? result.landmarks[0] : null;
        this.draw(singleHand);
        const state = this.gate(singleHand ? classifyHand(singleHand) : null, this.video.currentTime * 1000);
        this.callbacks.candidate(state, result.landmarks.length);
        if (state.fresh) this.callbacks.detected?.({ letter: state.candidate, seconds: this.video.currentTime, source: this.source });
      } catch {
        this.stop(); this.callbacks.error('Hand tracking stopped. Choose the video again to retry.'); return;
      }
    }
    // Unlike rAF, timers can run while the shared meeting tab has focus.
    // Browsers can throttle them; keeping ClearSign visible gives best results.
    this.timer = setTimeout(() => this.tick(generation), 100);
  }
  draw(points) {
    const canvas = this.canvas;
    canvas.width = this.video.videoWidth || 640; canvas.height = this.video.videoHeight || 480;
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!points) return;
    ctx.strokeStyle = '#bca7f2'; ctx.lineWidth = Math.max(2, canvas.width / 400);
    for (const [a, b] of CONNECTIONS) {
      ctx.beginPath(); ctx.moveTo(points[a].x * canvas.width, points[a].y * canvas.height);
      ctx.lineTo(points[b].x * canvas.width, points[b].y * canvas.height); ctx.stroke();
    }
    ctx.fillStyle = '#e6dafa';
    for (const point of points) { ctx.beginPath(); ctx.arc(point.x * canvas.width, point.y * canvas.height, Math.max(3, canvas.width / 300), 0, Math.PI * 2); ctx.fill(); }
  }
  resetCandidate() {
    this.gate = createVideoCandidateGate();
    this.callbacks.candidate({ candidate: null, progress: 0, ready: false, fresh: false }, 0);
  }
  pauseFile() { if (this.source === 'file' && this.active) this.video.pause(); }
  stop() {
    this.generation++; this.active = false; clearTimeout(this.timer); this.events?.abort();
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.video.pause(); this.video.srcObject = null; this.video.removeAttribute('src');
    this.video.controls = false; this.video.load();
    if (this.objectURL) this.urls.revokeObjectURL(this.objectURL);
    this.objectURL = null; this.detector?.close(); this.detector = null;
    this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.resetCandidate(); this.status('idle');
  }
}
