// Conservative gate: desktop Chromium 135+ supports SpeechRecognition.start(audioTrack).
// Older engines can ignore its argument and silently open the microphone instead.
export function meetingSupport(navigator, Recognition) {
  const version = navigator.userAgent?.match(/(?:Chrome|Chromium|Edg)\/(\d+)/);
  return !!Recognition && !!navigator.mediaDevices?.getDisplayMedia && !!version && Number(version[1]) >= 135 && !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
}

export class MeetingAudio {
  constructor(mediaDevices, callbacks) {
    this.mediaDevices = mediaDevices; this.callbacks = callbacks;
    this.generation = 0; this.active = false;
  }
  async start() {
    this.stop(); const generation = this.generation;
    this.active = true; this.callbacks.status('choosing');
    try {
      const stream = await this.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'browser', frameRate: 1 },
        audio: { suppressLocalAudioPlayback: false },
        selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'exclude',
      });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const track = stream.getAudioTracks().find(track => track.readyState === 'live');
      if (!track) {
        this.stop();
        this.callbacks.error('No meeting audio was shared. Choose the meeting’s browser tab and enable “Share tab audio”. Desktop app audio is available only when your system offers it.');
        return;
      }
      this.track = track;
      // The browser requires screen capture for its audio picker. Frames are never
      // displayed, uploaded, or recorded. Disable video frames while retaining the
      // shared stream, so the browser's Stop sharing control remains effective.
      stream.getVideoTracks().forEach(video => { video.enabled = false; });
      stream.getTracks().forEach(shared => shared.addEventListener('ended', () => {
        if (generation !== this.generation) return;
        this.stop(); this.callbacks.ended();
      }, { once: true }));
      this.callbacks.status('shared'); this.callbacks.ready(track);
    } catch (error) {
      if (generation !== this.generation) return;
      this.stop();
      this.callbacks.error(error.name === 'NotAllowedError' ? 'Audio sharing was cancelled or denied. You can try again or choose Microphone.' : 'This browser could not share meeting audio. Try a meeting in a desktop Chrome or Edge tab with audio sharing enabled.');
    }
  }
  stop() {
    this.generation++; this.active = false;
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null; this.track = null;
    this.callbacks.status('idle');
  }
}
