const session = new URLSearchParams(location.search).get('session');
const text = document.querySelector('#display-text');
const status = document.querySelector('#display-status');
let channel;
let lastSeen = Date.now();
let ended = false;
if (session && typeof BroadcastChannel === 'function') {
  channel = new BroadcastChannel(`clearsign-${session}`);
  channel.addEventListener('message', ({ data }) => {
    if (data?.type === 'closed') {
      ended = true;
      status.textContent = 'Conversation ended'; text.textContent = 'Your conversation has ended.';
      document.querySelector('#display-interim').textContent = ''; return;
    }
    if (data?.type !== 'state') return;
    ended = false;
    lastSeen = Date.now();
    status.textContent = 'Connected to this browser';
    text.textContent = data.entry?.text || 'Your words will appear here.';
    document.querySelector('#display-speaker').textContent = data.entry ? `${data.entry.sample ? 'SAMPLE · ' : ''}${data.entry.speaker}` : 'CAPTION DISPLAY';
    document.querySelector('#display-interim').textContent = data.interim || '';
    document.body.classList.toggle('high-contrast', data.prefs?.contrast === true);
    document.documentElement.style.setProperty('--caption-size', `${[28,36,48].includes(data.prefs?.size) ? data.prefs.size : 36}px`);
  });
  channel.postMessage({ type: 'request' });
  setInterval(() => {
    channel.postMessage({ type: 'request' });
    if (!ended && Date.now() - lastSeen > 20000) status.textContent = 'Conversation tab is not responding. Captions may be out of date.';
  }, 5000);
} else status.textContent = 'Open this display from the ClearSign conversation page.';
document.querySelector('#fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch { status.textContent = 'Full screen is unavailable. You can maximize this window instead.'; }
});
document.addEventListener('fullscreenchange', () => {
  document.querySelector('#fullscreen').textContent = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
});
