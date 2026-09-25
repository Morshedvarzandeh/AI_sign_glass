import { readPreferences, transcriptText, formatVideoTime } from './core.js';
import { CaptionController } from './speech.js';
import { SignVideo } from './sign-video.js';
import { MeetingAudio, meetingSupport } from './meeting.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let prefs;
try { prefs = readPreferences(localStorage); } catch { prefs = readPreferences(null); }
let entries = [];
let interim = '';
let demoTimers = [];
let demoActive = false;
let cameraCandidate = null;
let mode = 'captions';
let speechToken = 0;
let suggestionId = 0;
let videoSuggestions = [];
const session = crypto.randomUUID();
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(`clearsign-${session}`) : null;
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function notice(message, error = false) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
  $('#notice').classList.toggle('error', error);
}
function sendDisplay() {
  channel?.postMessage({ type: 'state', entry: entries.at(-1) || null, interim, prefs });
}
channel?.addEventListener('message', event => { if (event.data?.type === 'request') sendDisplay(); });
function applyPreferences(save = false) {
  document.documentElement.style.setProperty('--caption-size', `${prefs.size}px`);
  document.body.classList.toggle('high-contrast', prefs.contrast);
  $('#contrast').checked = prefs.contrast;
  $('#language').value = prefs.language;
  $('#sign-voice-language').value = prefs.language;
  $('#size-label').textContent = ({ 28: 'Small', 36: 'Medium', 48: 'Large' })[prefs.size];
  $$('[data-size]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.size) === prefs.size)));
  if (save) { try { localStorage.setItem('clearsign.preferences', JSON.stringify(prefs)); } catch { notice('Preferences could not be saved, but they still apply to this session.'); } }
  sendDisplay();
}
function renderLatest() {
  const latest = entries.at(-1);
  $('#live-caption').classList.toggle('empty', !latest);
  $('#live-caption').textContent = latest?.text || 'Your conversation\nstarts here.';
  $('#stage-label').textContent = latest ? `${latest.sample ? 'SAMPLE · ' : ''}${latest.speaker.toUpperCase()}` : 'A SPACE FOR EVERY WORD';
  $('#stage-hint').hidden = !!latest || !!interim;
  $('#interim-caption').textContent = interim;
  $('#preview-caption').textContent = interim || latest?.text || 'Your words, in view.';
  sendDisplay();
}
function addEntry(text, speaker = 'Speaker', sample = false) {
  const clean = text.trim().slice(0, 5000);
  if (!clean) return;
  const entry = { text: clean, speaker, sample, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
  entries.push(entry);
  if (entries.length > 120) { entries.shift(); $('#transcript').firstElementChild?.remove(); }
  const li = document.createElement('li');
  const meta = document.createElement('div'); meta.className = 'entry-meta';
  const name = document.createElement('strong'); name.textContent = speaker + (sample ? ' · SAMPLE' : '');
  const time = document.createElement('time'); time.textContent = entry.time;
  const content = document.createElement('p'); content.className = 'entry-text'; content.dir = 'auto'; content.textContent = clean;
  meta.append(name, time); li.append(meta, content); $('#transcript').append(li);
  $('#transcript').scrollTop = $('#transcript').scrollHeight;
  $('#transcript-empty').hidden = true;
  $('#entry-count').textContent = String(entries.length);
  $('#download-transcript').disabled = false;
  $('#clear-transcript').disabled = false;
  renderLatest();
}
function setMicStatus(status) {
  const shared = $('#audio-source').value === 'meeting';
  const labels = { idle: shared ? 'Meeting audio off' : 'Microphone off', starting: shared ? 'Starting meeting captions…' : 'Starting microphone…', listening: shared ? 'Listening · Meeting audio' : 'Listening', reconnecting: 'Reconnecting…' };
  const running = status !== 'idle';
  $('#mic-status').lastChild.textContent = labels[status];
  $('#mic-status').classList.toggle('active', running);
  $('#mic-status').classList.remove('demo');
  $('#toggle-captions span').textContent = running ? 'Stop captions' : 'Start captions';
  $('#toggle-captions').setAttribute('aria-pressed', String(running));
  $('#captions-panel').classList.toggle('listening', status === 'listening');
}
const captions = new CaptionController(Recognition, {
  status: setMicStatus,
  interim: text => { interim = text; renderLatest(); },
  final: text => addEntry(text, $('#audio-source').value === 'meeting' ? 'Meeting audio' : 'Speaker'),
  error: text => { meeting.stop(); notice(text, true); },
});
const meeting = new MeetingAudio(navigator.mediaDevices, {
  status: status => {
    if (status === 'choosing') {
      $('#mic-status').lastChild.textContent = 'Choose a meeting tab…';
      $('#toggle-captions span').textContent = 'Cancel capture';
    }
  },
  ready: track => captions.start(prefs.language, track),
  ended: () => { captions.stop(); notice('Meeting audio sharing ended. Start captions to choose a source again.'); },
  error: text => { captions.stop(); notice(text, true); },
});
function stopListening() { captions.stop(); meeting.stop(); }
function stopDemo() {
  demoTimers.forEach(clearTimeout); demoTimers = [];
  demoActive = false;
  $('#demo-button').firstChild.textContent = 'Try a demo';
  if (!captions.active) setMicStatus('idle');
}
function stopVoice() {
  speechToken++;
  window.speechSynthesis?.cancel();
  $('#stop-speaking').hidden = true;
  $('#stop-sign-speaking').hidden = true;
}
function startDemo() {
  if (demoActive) { stopDemo(); return; }
  stopVoice(); stopListening(); notice('Demo mode: these are sample captions. No microphone or meeting audio is being captured.');
  demoActive = true;
  $('#demo-button').firstChild.textContent = 'Stop demo';
  $('#mic-status').lastChild.textContent = 'Sample conversation';
  $('#mic-status').classList.add('demo');
  const lines = ['Hi! It’s lovely to see you.', 'Would you like to find a quiet place to talk?', 'Take your time. I’m right here.'];
  addEntry(lines[0], 'Speaker', true);
  lines.slice(1).forEach((line, i) => demoTimers.push(setTimeout(() => addEntry(line, 'Speaker', true), (i + 1) * 2200)));
  demoTimers.push(setTimeout(stopDemo, 5000));
}
function setMode(next, focus = false) {
  mode = next;
  if (next !== 'sign') camera.stop();
  // Shared meeting captions can continue while the signer composes a response.
  if (next === 'sign') { if (!meeting.active) captions.stop(); stopDemo(); }
  $('#captions-panel').hidden = next !== 'captions';
  $('#sign-panel').hidden = next !== 'sign';
  $('#breadcrumb-page').textContent = next === 'sign' ? 'Sign studio' : 'Conversation';
  $$('[data-view]').forEach(button => {
    const selected = button.dataset.view === next;
    if (button.getAttribute('role') === 'tab') {
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
    } else {
      button.classList.toggle('selected', selected);
      if (selected) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
    }
  });
  if (focus) $(`#tab-${next}`).focus();
}
function clearVideoSuggestions() {
  videoSuggestions = [];
  $('#video-candidates').replaceChildren();
  $('#video-review-count').textContent = '0';
  $('#video-review-empty').hidden = false;
  $('#clear-video-candidates').disabled = true;
}
function updateSignText() {
  const empty = !$('#sign-message').value.trim();
  for (const id of ['show-sign', 'speak-sign', 'copy-sign']) $('#' + id).disabled = empty;
}
function addReviewedLetter(letter, id) {
  if ($('#sign-message').value.length >= 500) { notice('The reviewed message is full. Show or copy it, then shorten it before adding more letters.'); return; }
  $('#sign-message').value += letter;
  const suggestion = id ? videoSuggestions.find(item => item.id === id) : videoSuggestions.findLast(item => !item.added && item.letter === letter);
  if (suggestion) {
    suggestion.added = true;
    const button = document.querySelector(`[data-suggestion="${suggestion.id}"]`);
    if (button) { button.disabled = true; button.textContent = `${suggestion.letter} · Added`; }
  }
  updateSignText();
}
function queueVideoSuggestion(suggestion) {
  const item = { ...suggestion, id: ++suggestionId, added: false };
  videoSuggestions.push(item);
  if (videoSuggestions.length > 120) { videoSuggestions.shift(); $('#video-candidates').firstElementChild?.remove(); }
  const li = document.createElement('li');
  const button = document.createElement('button');
  button.className = 'suggestion-button'; button.dataset.suggestion = String(item.id);
  button.textContent = `${item.letter} · ${formatVideoTime(item.seconds)}`;
  button.setAttribute('aria-label', `Confirm letter ${item.letter} at ${formatVideoTime(item.seconds)}`);
  li.append(button); $('#video-candidates').append(li);
  $('#video-review-count').textContent = String(videoSuggestions.length);
  $('#video-review-empty').hidden = true; $('#clear-video-candidates').disabled = false;
}
function videoStartLabel() {
  return { camera: 'Start camera', screen: 'Choose live video', file: 'Analyze video' }[$('#sign-source').value];
}
const camera = new SignVideo($('#camera'), $('#landmarks'), {
  status: (status, source) => {
    const activeLabels = { camera: 'Camera on · Processed locally', screen: 'Live video · Processed locally', file: 'Video playing · Processed locally' };
    const idleLabel = $('#sign-source').value === 'camera' ? 'Camera off' : 'Video off';
    const text = { idle: idleLabel, starting: source === 'file' ? 'Loading video…' : source === 'screen' ? 'Choose a video to share…' : 'Waiting for camera…', loading: 'Loading hand tracking…', active: activeLabels[source], paused: 'Video paused', ended: 'Video finished · Review suggestions' };
    $('#camera-status').textContent = text[status];
    $('#toggle-camera span').textContent = status === 'idle' ? videoStartLabel() : source === 'camera' ? 'Stop camera' : 'Stop video';
    $('#toggle-camera').setAttribute('aria-pressed', String(status !== 'idle'));
    $('#camera-placeholder').hidden = ['active', 'loading', 'paused', 'ended'].includes(status);
    $('#video-playback').hidden = source !== 'file' || !['active', 'paused', 'ended'].includes(status);
    $('#pause-video').textContent = status === 'paused' || status === 'ended' ? 'Play video' : 'Pause video';
  },
  candidate: (state, hands) => {
    cameraCandidate = state.ready ? state.candidate : null;
    const candidateText = state.candidate || '—';
    if ($('#candidate').textContent !== candidateText) $('#candidate').textContent = candidateText;
    $('#candidate-label').textContent = hands > 1 ? 'Six-letter mode: one hand only' : state.ready ? 'Check this letter' : state.candidate ? 'Hold steady…' : hands ? 'No supported shape' : 'Waiting for a hand';
    $('#hold-progress').value = state.progress;
    $('#add-letter').disabled = !state.ready;
  },
  detected: queueVideoSuggestion,
  discontinuity: clearVideoSuggestions,
  info: message => notice(message),
  error: message => notice(message, true),
});
function speakText(text) {
  if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { notice('Speech playback is unavailable in this browser. The reviewed text is still visible.', true); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  const token = speechToken;
  utterance.lang = prefs.language;
  const finished = () => {
    if (token !== speechToken) return;
    $('#stop-speaking').hidden = true; $('#stop-sign-speaking').hidden = true;
    if ($('#notice').textContent.startsWith('Reviewed text is playing')) notice('Speech finished. Reviewed text remains on the display.');
  };
  utterance.onend = finished;
  utterance.onerror = event => {
    if (token !== speechToken) return;
    finished();
    if (event.error !== 'canceled' && event.error !== 'interrupted') notice('The text could not be spoken. It is still visible on the display.', true);
  };
  try {
    speechSynthesis.speak(utterance);
    $('#stop-speaking').hidden = false; $('#stop-sign-speaking').hidden = false;
    notice('Reviewed text is playing on this device. Audio captions are paused. Sending this voice into a call needs your meeting app’s audio-sharing setup.');
  } catch { finished(); notice('The text could not be spoken. It is still visible on the display.', true); }
}
function presentText(text, speaker, speak) {
  stopDemo(); stopVoice(); stopListening();
  addEntry(text, speaker);
  if (speak) speakText(text);
  else notice('Reviewed text is on the caption display. Start audio captions again when ready to listen.');
}
function showReply(speak = false) {
  const text = $('#reply').value.trim();
  if (text) presentText(text, 'You', speak);
}
function showSignText(speak = false) {
  const text = $('#sign-message').value.trim();
  if (!text) { notice('Review a suggested letter or type text first.'); $('#sign-message').focus(); return; }
  $('#reply').value = text; updateReply();
  presentText(text, 'Reviewed sign text', speak);
}
async function copyText(input) {
  const text = input.value.trim(); if (!text) return;
  try { await navigator.clipboard.writeText(text); notice('Text copied. Paste it into your meeting chat when ready.'); }
  catch { input.focus(); input.select(); notice('Copy is unavailable here. The text is selected; use your device’s Copy command.'); }
}
function updateReply() {
  $('#reply-count').textContent = `${$('#reply').value.length} / 500`;
  $('#show-reply').disabled = !$('#reply').value.trim();
  $('#speak-reply').disabled = !$('#reply').value.trim();
  $('#copy-reply').disabled = !$('#reply').value.trim();
}
function openDisplay() {
  if (!channel) { notice('This browser cannot synchronize a second display. Use the captions on this screen.', true); return; }
  const popup = window.open(`/display.html?session=${encodeURIComponent(session)}`, 'clearsign-display', 'popup,width=1000,height=600');
  if (!popup) notice('The display window was blocked. Allow pop-ups for this app and try again.', true);
  else popup.focus();
}
$$('[data-view]').forEach(button => button.addEventListener('click', () => setMode(button.dataset.view)));
$('.tabs').addEventListener('keydown', event => {
  if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
    event.preventDefault(); setMode(event.key === 'Home' ? 'captions' : event.key === 'End' ? 'sign' : mode === 'captions' ? 'sign' : 'captions', true);
  }
});
$('#toggle-captions').addEventListener('click', () => {
  if (captions.active || meeting.active) { stopListening(); return; }
  stopDemo(); stopVoice(); notice('');
  if ($('#audio-source').value === 'meeting') {
    if (!meetingSupport(navigator, Recognition)) { notice('Meeting audio captions currently require desktop Chrome or Edge 135+ with speech recognition. On this browser, use Microphone or copy your replies into the meeting chat.', true); return; }
    meeting.start();
  } else captions.start(prefs.language);
});
$('#audio-source').addEventListener('change', () => {
  stopListening(); stopDemo();
  const shared = $('#audio-source').value === 'meeting';
  $('#meeting-guide').hidden = !shared;
  $('#stage-hint').textContent = shared ? 'Choose your meeting tab and enable audio sharing to start.' : 'Start captions and spoken words will appear as text.';
  notice(shared ? 'For Google Meet, Zoom web, Teams web, or another audio tab: select the tab and enable “Share tab audio”. Desktop app sound depends on browser and operating system support.' : '');
});
$('#demo-button').addEventListener('click', startDemo);
$('#language').addEventListener('change', () => {
  const active = captions.active; const track = meeting.track; captions.stop(); stopVoice();
  prefs.language = $('#language').value; applyPreferences(true);
  if (active) captions.start(prefs.language, track);
});
$$('[data-size]').forEach(button => button.addEventListener('click', () => { prefs.size = Number(button.dataset.size); applyPreferences(true); }));
$('#contrast').addEventListener('change', () => { prefs.contrast = $('#contrast').checked; applyPreferences(true); });
$('#open-display').addEventListener('click', openDisplay);
$('#nav-display').addEventListener('click', openDisplay);
$('#nav-meeting').addEventListener('click', () => {
  setMode('captions');
  if ($('#audio-source').value !== 'meeting') {
    $('#audio-source').value = 'meeting'; $('#audio-source').dispatchEvent(new Event('change'));
  }
  $('#meeting-guide').hidden = false; $('#audio-source').focus();
});
$('#help-button').addEventListener('click', () => $('#help-dialog').showModal());
$('#reply').addEventListener('input', updateReply);
$('#reply').addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') showReply(); });
$$('[data-phrase]').forEach(button => button.addEventListener('click', () => { $('#reply').value = button.dataset.phrase; updateReply(); $('#reply').focus(); }));
$('#show-reply').addEventListener('click', () => showReply());
$('#speak-reply').addEventListener('click', () => showReply(true));
$('#copy-reply').addEventListener('click', () => copyText($('#reply')));
$('#copy-sign').addEventListener('click', () => copyText($('#sign-message')));
for (const id of ['stop-speaking', 'stop-sign-speaking']) {
  $('#' + id).addEventListener('click', () => { stopVoice(); notice('Speech stopped. Reviewed text remains on the display.'); });
}
function updateVideoSource() {
  camera.stop(); clearVideoSuggestions();
  const source = $('#sign-source').value;
  $('#sign-file-row').hidden = source !== 'file';
  $('#toggle-camera span').textContent = videoStartLabel();
  $('#camera-status').textContent = source === 'camera' ? 'Camera off' : 'Video off';
  const hints = {
    camera: 'Keep the whole hand in view, upright and facing the camera.',
    screen: 'Choose a meeting tab or window showing the signer. Enlarge their video and keep ClearSign visible beside the call. Video only; no call audio is captured here.',
    file: 'Choose a recording, then Analyze video. The file stays on this device. Use the player to pause, seek, or replay. Seeking clears unreviewed suggestions.',
  };
  $('#sign-source-hint').textContent = hints[source];
  $('#video-placeholder-hint').textContent = source === 'screen' ? 'Share the video of the person signing.' : source === 'file' ? 'Choose a recording from your device.' : 'Choose a video source to begin.';
}
$('#sign-source').addEventListener('change', updateVideoSource);
$('#sign-file').addEventListener('change', () => {
  camera.stop(); clearVideoSuggestions();
  $('#sign-file-name').textContent = $('#sign-file').files[0]?.name || 'No recording selected';
});
$('#toggle-camera').addEventListener('click', () => {
  notice('');
  if (camera.active) { camera.stop(); return; }
  stopListening(); stopDemo(); stopVoice();
  camera.start({ source: $('#sign-source').value, file: $('#sign-file').files[0] });
});
$('#pause-video').addEventListener('click', async () => {
  if ($('#camera').paused) { try { await $('#camera').play(); } catch { notice('The video could not resume. Choose the recording again.', true); } }
  else camera.pauseFile();
});
$('#replay-video').addEventListener('click', async () => {
  clearVideoSuggestions(); camera.resetCandidate(); $('#camera').currentTime = 0;
  try { await $('#camera').play(); } catch { notice('The video could not replay. Choose the recording again.', true); }
});
$('#video-speed').addEventListener('change', () => { $('#camera').playbackRate = Number($('#video-speed').value); camera.resetCandidate(); });
$('#camera').addEventListener('timeupdate', () => { $('#video-time').textContent = formatVideoTime($('#camera').currentTime); });
$('#video-candidates').addEventListener('click', event => {
  const button = event.target.closest('[data-suggestion]');
  if (!button || button.disabled) return;
  const item = videoSuggestions.find(item => item.id === Number(button.dataset.suggestion));
  if (item && !item.added) addReviewedLetter(item.letter, item.id);
});
$('#clear-video-candidates').addEventListener('click', () => { clearVideoSuggestions(); camera.resetCandidate(); });
$('#sign-message').addEventListener('input', updateSignText);
$('#add-letter').addEventListener('click', () => {
  if (cameraCandidate) { addReviewedLetter(cameraCandidate); camera.resetCandidate(); }
});
$('#add-space').addEventListener('click', () => { if ($('#sign-message').value.length < 500) $('#sign-message').value += ' '; updateSignText(); });
$('#delete-letter').addEventListener('click', () => { $('#sign-message').value = [...$('#sign-message').value].slice(0, -1).join(''); updateSignText(); });
$('#show-sign').addEventListener('click', () => showSignText());
$('#speak-sign').addEventListener('click', () => showSignText(true));
$('#sign-voice-language').replaceChildren(...[...$('#language').options].map(option => option.cloneNode(true)));
$('#sign-voice-language').addEventListener('change', () => {
  $('#language').value = $('#sign-voice-language').value; $('#language').dispatchEvent(new Event('change'));
});
$('#clear-transcript').addEventListener('click', () => {
  stopDemo(); stopVoice(); stopListening(); camera.stop(); clearVideoSuggestions();
  entries = []; interim = ''; $('#transcript').replaceChildren();
  $('#entry-count').textContent = '0'; $('#transcript-empty').hidden = false;
  $('#download-transcript').disabled = true; $('#clear-transcript').disabled = true;
  $('#reply').value = ''; $('#sign-message').value = ''; $('#sign-file').value = ''; $('#sign-file-name').textContent = 'No recording selected'; updateReply(); updateSignText(); renderLatest();
  notice('Conversation cleared from this tab and its connected display.');
});
$('#download-transcript').addEventListener('click', () => {
  if (!entries.length) return;
  const url = URL.createObjectURL(new Blob(['ClearSign conversation\n\n' + transcriptText(entries)], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = `clearsign-${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.addEventListener('visibilitychange', () => {
  // Keep microphone captions running while the caption display is in front.
  // Camera stops when hidden so it never silently continues using the camera.
  if (document.hidden && camera.active && camera.source === 'camera') { camera.stop(); notice('Camera paused because the app is in the background. Start it again when ready.'); }
  if (document.hidden && camera.active && camera.source === 'file') camera.pauseFile();
});
window.addEventListener('pagehide', () => { stopDemo(); stopListening(); camera.stop(); stopVoice(); channel?.postMessage({ type: 'closed' }); });
applyPreferences(); updateReply(); updateSignText();
const launch = new URLSearchParams(location.search);
if (launch.get('mode') === 'sign') {
  setMode('sign');
  if (['camera', 'screen', 'file'].includes(launch.get('source'))) {
    $('#sign-source').value = launch.get('source'); updateVideoSource();
  }
}
if (!Recognition) notice('This browser does not offer live speech recognition. You can use typed replies, the sign studio, and the caption demo.');
