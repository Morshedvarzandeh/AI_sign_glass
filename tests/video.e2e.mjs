import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from '../server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
await mkdir('test-results', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
  await page.addInitScript(() => {
    window.testVoices = [];
    Object.defineProperty(window, 'speechSynthesis', { value: { speak(utterance) { window.testVoices.push({ text: utterance.text, language: utterance.lang }); }, cancel() {} } });
    window.revokedVideoURLs = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = url => { window.revokedVideoURLs.push(url); revoke(url); };
  });
  await page.goto(base + '/?mode=sign&source=file');
  assert.equal(await page.locator('#sign-source').inputValue(), 'file');
  assert.equal(await page.evaluate(() => document.querySelector('#camera').srcObject), null);
  await page.locator('#tab-sign').click();
  await page.locator('#sign-source').selectOption('file');
  await page.locator('#toggle-camera').click();
  assert.match(await page.locator('#notice').textContent(), /Choose a video file/);
  await page.locator('#sign-file').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('not video') });
  await page.locator('#toggle-camera').click();
  assert.match(await page.locator('#notice').textContent(), /Choose a video recording/);
  await page.locator('#sign-file').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('broken recording') });
  await page.locator('#toggle-camera').click();
  await page.waitForFunction(() => /could not be decoded/.test(document.querySelector('#notice').textContent));
  assert.equal(await page.evaluate(() => window.revokedVideoURLs.length), 1);

  // A synthetic local recording tests playback and model loading, not ASL accuracy.
  const bytes = await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
    const ctx = canvas.getContext('2d');
    const stream = canvas.captureStream(15);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const parts = [];
    recorder.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
    const done = new Promise(resolve => { recorder.onstop = resolve; });
    recorder.start();
    for (let frame = 0; frame < 45; frame++) {
      ctx.fillStyle = '#252333'; ctx.fillRect(0, 0, 320, 240);
      ctx.fillStyle = '#ac98d0'; ctx.font = '18px sans-serif'; ctx.fillText('Synthetic video test', 70, 112);
      ctx.fillRect(40 + frame * 4, 150, 8, 8);
      await new Promise(resolve => setTimeout(resolve, 67));
    }
    recorder.stop(); await done; stream.getTracks().forEach(track => track.stop());
    return [...new Uint8Array(await new Blob(parts, { type: 'video/webm' }).arrayBuffer())];
  });
  await page.locator('#sign-file').setInputFiles({ name: 'signing-test.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  await page.locator('#toggle-camera').click();
  await page.waitForFunction(() => /Video playing/.test(document.querySelector('#camera-status').textContent), undefined, { timeout: 60000 });
  assert.equal(await page.evaluate(() => document.querySelector('#camera').src.startsWith('blob:')), true);
  assert.equal(await page.evaluate(() => document.querySelector('#camera').controls), true);
  assert.equal(await page.locator('.camera-stage').evaluate(el => el.classList.contains('mirrored')), false);
  await page.locator('#pause-video').click();
  await page.waitForFunction(() => document.querySelector('#camera').paused);
  assert.equal(await page.locator('#add-letter').isDisabled(), true);
  await page.locator('#sign-message').fill('Thank you for explaining.');
  await page.locator('#sign-voice-language').selectOption('en-GB');
  await page.locator('#speak-sign').click();
  assert.deepEqual(await page.evaluate(() => window.testVoices.at(-1)), { text: 'Thank you for explaining.', language: 'en-GB' });
  assert.equal(await page.locator('#preview-caption').textContent(), 'Thank you for explaining.');
  assert.equal(await page.locator('#stop-sign-speaking').isVisible(), true);
  await page.locator('#stop-sign-speaking').click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/video-file.png', fullPage: true });
  await page.locator('#replay-video').click();
  await page.waitForFunction(() => /Video finished/.test(document.querySelector('#camera-status').textContent));
  assert.equal(await page.locator('#video-review-count').textContent(), '0');
  assert.equal(await page.evaluate(() => window.testVoices.length), 1);
  await page.locator('#toggle-camera').click();
  assert.equal(await page.evaluate(() => document.querySelector('#camera').getAttribute('src')), null);
  assert.equal(await page.evaluate(() => window.revokedVideoURLs.length), 2);

  await page.locator('#sign-source').selectOption('screen');
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async options => {
      window.captureOptions = options;
      const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 240;
      const context = canvas.getContext('2d'); let frame = 0;
      const timer = setInterval(() => { context.fillStyle = '#212430'; context.fillRect(0, 0, 320, 240); context.fillStyle = '#aaa'; context.fillRect(frame++ % 250, 100, 20, 20); }, 70);
      const audio = new AudioContext(); const dest = audio.createMediaStreamDestination();
      const stream = new MediaStream([...canvas.captureStream(15).getTracks(), ...dest.stream.getTracks()]);
      window.sharedTest = { stream, tracks: [...stream.getTracks()], timer, audio };
      return stream;
    };
  });
  await page.locator('#toggle-camera').click();
  await page.waitForFunction(() => /Live video ·/.test(document.querySelector('#camera-status').textContent), undefined, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.captureOptions.audio), false);
  assert.equal(await page.evaluate(() => window.sharedTest.tracks.find(t => t.kind === 'audio').readyState), 'ended');
  assert.equal(await page.evaluate(() => document.querySelector('#camera').srcObject.getAudioTracks().length), 0);
  await page.evaluate(() => window.sharedTest.stream.getVideoTracks()[0].dispatchEvent(new Event('ended')));
  assert.equal(await page.evaluate(() => document.querySelector('#camera').srcObject), null);
  assert.equal(await page.evaluate(() => window.sharedTest.tracks.every(t => t.readyState === 'ended')), true);
  assert.match(await page.locator('#notice').textContent(), /Shared video ended/);
  await page.evaluate(() => { clearInterval(window.sharedTest.timer); window.sharedTest.audio.close(); });

  // Cancel an open screen picker and then simulate a late permission grant.
  await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = () => new Promise(resolve => { window.resolveCapture = resolve; }); });
  await page.locator('#toggle-camera').click(); await page.locator('#toggle-camera').click();
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 10; canvas.height = 10;
    window.lateStream = canvas.captureStream(); window.resolveCapture(window.lateStream);
  });
  await page.waitForFunction(() => window.lateStream.getTracks().every(t => t.readyState === 'ended'));
  await page.evaluate(() => { navigator.mediaDevices.getDisplayMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
  await page.locator('#toggle-camera').click();
  await page.waitForFunction(() => /sharing was cancelled or denied/.test(document.querySelector('#notice').textContent));
  await page.locator('#clear-transcript').click();
  assert.equal(await page.locator('#sign-message').inputValue(), '');
  assert.equal(await page.locator('#sign-file').inputValue(), '');
  assert.deepEqual(errors, []);
  assert.equal(requests.some(request => request.method === 'POST'), false, JSON.stringify(requests.filter(request => request.method === 'POST')));
  assert.equal(requests.some(request => !request.url.startsWith(base) && !request.url.startsWith('blob:')), false);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sign-source').selectOption('file');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/video-mobile.png', fullPage: true });

  // Controlled landmark output exercises the full review UI. This fixture is
  // intentionally synthetic and is not evidence of ASL recognition accuracy.
  const review = await browser.newPage({ viewport: { width: 1100, height: 1000 } });
  await review.addInitScript(() => {
    window.reviewSpeech = [];
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(u) { window.reviewSpeech.push(u.text); } } });
  });
  const points = Array.from({ length: 21 }, () => ({ x: .5, y: .6, z: 0 }));
  points[0] = { x: .5, y: .9 };
  for (let finger = 0; finger < 4; finger++) {
    const b = 5 + finger * 4, x = .39 + finger * .07;
    points[b] = { x, y: .6 }; points[b + 1] = { x, y: .45 };
    points[b + 2] = { x, y: finger === 0 ? .32 : .5 };
    points[b + 3] = { x, y: finger === 0 ? .2 : .62 };
  }
  points[1] = { x: .43, y: .8 }; points[2] = { x: .34, y: .73 }; points[3] = { x: .24, y: .66 }; points[4] = { x: .13, y: .59 };
  await review.route('**/vendor/vision_bundle.mjs', route => route.fulfill({ contentType: 'text/javascript', body: `export const FilesetResolver={forVisionTasks:async()=>({})}; export const HandLandmarker={createFromOptions:async()=>({close(){},detectForVideo(){return {landmarks:[${JSON.stringify(points)}]}}})};` }));
  await review.goto(base); await review.locator('#tab-sign').click();
  await review.locator('#sign-source').selectOption('file');
  await review.locator('#sign-file').setInputFiles({ name: 'controlled-letter.webm', mimeType: 'video/webm', buffer: Buffer.from(bytes) });
  await review.locator('#toggle-camera').click();
  await review.waitForFunction(() => document.querySelector('#video-review-count').textContent === '1');
  await review.locator('#pause-video').click();
  assert.equal(await review.locator('#sign-message').inputValue(), '');
  assert.deepEqual(await review.evaluate(() => window.reviewSpeech), []);
  const letter = review.locator('#video-candidates button').first();
  await letter.click();
  assert.equal(await review.locator('#sign-message').inputValue(), 'L');
  assert.equal(await letter.isDisabled(), true);
  await review.locator('#speak-sign').click();
  assert.deepEqual(await review.evaluate(() => window.reviewSpeech), ['L']);
  await review.locator('#replay-video').click();
  await review.waitForFunction(() => /Video finished/.test(document.querySelector('#camera-status').textContent));
  assert.equal(await review.locator('#video-review-count').textContent(), '1');
  await review.evaluate(() => { document.querySelector('#camera').currentTime = .1; });
  await review.waitForFunction(() => document.querySelector('#video-review-count').textContent === '0');
  assert.equal(await review.locator('#sign-message').inputValue(), 'L');
  await review.locator('#sign-source').selectOption('camera');
  assert.equal(await review.evaluate(() => document.querySelector('#camera').getAttribute('src')), null);
  await review.close();
  console.log('PASS: local file validation and decode errors, real model loading, pause/replay, no phantom output, reviewed text-to-speech, source orientation, video-only meeting capture, ended/denied/cancelled sharing, resource cleanup, no uploads, and mobile layout.');
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
