const ERRORS = {
  'not-allowed': 'Microphone access was denied. Allow microphone access in your browser, then try again.',
  'service-not-allowed': 'Speech recognition is unavailable in this browser. You can still type a message.',
  'audio-capture': 'No microphone is available. Connect one or use a typed message.',
  network: 'The speech service could not connect. Check your connection, then try again.',
  'language-not-supported': 'This speech service does not support the selected language. Try another language.',
};

export class CaptionController {
  constructor(Recognition, callbacks, timers = globalThis) {
    this.Recognition = Recognition;
    this.callbacks = callbacks;
    this.timers = timers;
    this.active = false;
    this.run = 0;
    this.emptyEnds = 0;
  }
  start(language, audioTrack = null) {
    if (!this.Recognition) { this.callbacks.error('Live captions are unavailable in this browser. Try a browser with speech recognition support, or type a message.'); return; }
    this.stop();
    this.language = language;
    this.audioTrack = audioTrack;
    this.active = true;
    this.emptyEnds = 0;
    this.callbacks.status('starting');
    this.connect(this.run);
  }
  connect(run) {
    if (!this.active || run !== this.run) return;
    let hadResult = false;
    const recognition = new this.Recognition();
    this.recognition = recognition;
    recognition.lang = this.language;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onstart = () => { if (this.active && run === this.run) this.callbacks.status('listening'); };
    recognition.onresult = event => {
      if (!this.active || run !== this.run) return;
      hadResult = true;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript.trim();
        if (result.isFinal && text) this.callbacks.final(text);
        else interim += text + ' ';
      }
      this.callbacks.interim(interim.trim());
    };
    recognition.onerror = event => {
      if (!this.active || run !== this.run || event.error === 'aborted' || event.error === 'no-speech') return;
      this.stop();
      this.callbacks.error(ERRORS[event.error] || 'Speech recognition stopped. Please try again or type your message.');
    };
    recognition.onend = () => {
      if (!this.active || run !== this.run) return;
      this.callbacks.interim('');
      this.emptyEnds = hadResult ? 0 : this.emptyEnds + 1;
      if (this.emptyEnds >= 3) {
        this.stop();
        this.callbacks.error('No speech was received. Check the microphone and start captions again.');
        return;
      }
      this.callbacks.status('reconnecting');
      this.timer = this.timers.setTimeout(() => this.connect(run), 400);
    };
    try {
      if (this.audioTrack) {
        if (this.audioTrack.kind !== 'audio' || this.audioTrack.readyState !== 'live') throw new Error('Audio ended');
        recognition.start(this.audioTrack);
      } else recognition.start();
    }
    catch { this.stop(); this.callbacks.error(this.audioTrack ? 'The shared audio could not be transcribed. Re-share a live meeting tab with audio enabled.' : 'Could not start the microphone. Please try again.'); }
  }
  stop() {
    this.active = false;
    this.run++;
    this.timers.clearTimeout(this.timer);
    if (this.recognition) {
      try { this.recognition.abort(); } catch { /* already stopped */ }
      this.recognition = null;
    }
    this.callbacks.interim('');
    this.callbacks.status('idle');
  }
}
