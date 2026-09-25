import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createServer } from '../server.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--no-sandbox'] });
await mkdir('test-results', { recursive: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, permissions: ['camera', 'microphone'] });
  await context.addInitScript(() => {
    window.testSpeech = { recognitions: [], spoken: [] };
    class FakeRecognition {
      constructor() { window.testSpeech.recognitions.push(this); }
      start(track) { this.track = track; this.onstart?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    }
    Object.defineProperty(window, 'SpeechRecognition', { value: FakeRecognition, configurable: true });
    Object.defineProperty(window, 'speechSynthesis', { value: { cancel() {}, speak(utterance) { window.testSpeech.spoken.push(utterance); } } });
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url);
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  assert.equal(await page.locator('#show-reply').isDisabled(), true);
  await page.locator('#toggle-captions').click();
  assert.match(await page.locator('#mic-status').textContent(), /Listening/);
  await page.evaluate(() => {
    const result = Object.assign([{ transcript: 'Testing live captions.' }], { isFinal: false });
    window.testSpeech.recognitions.at(-1).onresult({ resultIndex: 0, results: [result] });
  });
  assert.equal(await page.locator('#interim-caption').textContent(), 'Testing live captions.');
  assert.equal(await page.locator('#entry-count').textContent(), '0');
  await page.evaluate(() => {
    const result = Object.assign([{ transcript: 'Testing live captions.' }], { isFinal: true });
    window.testSpeech.recognitions.at(-1).onresult({ resultIndex: 0, results: [result] });
  });
  assert.equal(await page.locator('#entry-count').textContent(), '1');
  assert.equal(await page.locator('#interim-caption').textContent(), '');
  const popupEvent = page.waitForEvent('popup');
  await page.locator('#open-display').click();
  const display = await popupEvent;
  await display.waitForFunction(() => document.querySelector('#display-text')?.textContent === 'Testing live captions.');
  await page.locator('[data-size="48"]').click();
  await page.locator('#contrast').check();
  await display.waitForFunction(() => document.body.classList.contains('high-contrast') && document.documentElement.style.getPropertyValue('--caption-size') === '48px');
  await page.locator('#reply').fill('<img src=x onerror=alert(1)> مرحبا');
  await page.locator('#show-reply').click();
  assert.equal(await page.locator('#transcript img').count(), 0);
  await display.waitForFunction(() => document.querySelector('#display-text').textContent.includes('مرحبا'));
  assert.match(await page.locator('#mic-status').textContent(), /off/);
  await page.locator('[data-phrase="Thank you!"]').click();
  await page.locator('#speak-reply').click();
  assert.equal(await page.evaluate(() => window.testSpeech.spoken.at(-1).text), 'Thank you!');
  assert.equal(await page.locator('#stop-speaking').isVisible(), true);
  await page.locator('#stop-speaking').click();
  await page.locator('#clear-transcript').click();
  await display.waitForFunction(() => document.querySelector('#display-text').textContent === 'Your words will appear here.');
  assert.equal(await page.locator('#reply').inputValue(), '');
  assert.equal(await page.locator('#entry-count').textContent(), '0');
  await page.locator('#demo-button').click();
  assert.match(await page.locator('#stage-label').textContent(), /SAMPLE/);
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#download-transcript').click();
  const download = await downloadEvent;
  assert.match(download.suggestedFilename(), /^clearsign-.*\.txt$/);
  await page.locator('#demo-button').click();
  await page.locator('#toggle-captions').click();
  await page.evaluate(() => window.testSpeech.recognitions.at(-1).onerror({ error: 'not-allowed' }));
  assert.match(await page.locator('#notice').textContent(), /denied/);
  assert.match(await page.locator('#mic-status').textContent(), /off/);
  await page.evaluate(() => {
    navigator.mediaDevices.getDisplayMedia = async () => {
      const audio = new AudioContext(); const dest = audio.createMediaStreamDestination();
      const canvas = document.createElement('canvas'); canvas.width = 20; canvas.height = 20;
      const capture = new MediaStream([...canvas.captureStream(1).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      window.testMeeting = { audio, capture };
      return capture;
    };
  });
  await page.locator('#nav-meeting').click();
  await page.locator('#toggle-captions').click();
  await page.waitForFunction(() => window.testSpeech.recognitions.at(-1).track?.kind === 'audio');
  assert.equal(await page.evaluate(() => window.testSpeech.recognitions.at(-1).track === window.testMeeting.capture.getAudioTracks()[0]), true);
  await page.locator('#toggle-captions').click();
  assert.equal(await page.evaluate(() => window.testMeeting.capture.getTracks().every(t => t.readyState === 'ended')), true);
  await page.evaluate(() => window.testMeeting.audio.close());
  await page.locator('#audio-source').selectOption('microphone');
  await page.locator('#tab-captions').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#tab-sign').getAttribute('aria-selected'), 'true');
  await display.close(); await page.bringToFront();
  await page.locator('#toggle-camera').click();
  await page.waitForFunction(() => /Camera on/.test(document.querySelector('#camera-status')?.textContent), undefined, { timeout: 60000 });
  assert.equal(await page.locator('#add-letter').isDisabled(), true);
  assert.equal(await page.evaluate(() => document.querySelector('#camera').srcObject.getVideoTracks()[0].readyState), 'live');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/sign-studio.png', fullPage: true });
  await page.locator('#sign-message').fill('Hello from the sign studio');
  await page.locator('#show-sign').click();
  assert.equal(await page.locator('#preview-caption').textContent(), 'Hello from the sign studio');
  await page.locator('#tab-captions').click();
  assert.equal(await page.evaluate(() => document.querySelector('#camera').srcObject), null);
  await page.reload();
  assert.equal(await page.locator('#entry-count').textContent(), '0');
  assert.equal(await page.locator('[data-size="48"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#contrast').isChecked(), true);
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), ['clearsign.preferences']);
  const denied = await context.newPage();
  await denied.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => { throw new DOMException('Denied', 'NotAllowedError'); } });
  });
  await denied.goto(url);
  assert.match(await denied.locator('#notice').textContent(), /does not offer/);
  await denied.locator('#tab-sign').click(); await denied.locator('#toggle-camera').click();
  await denied.waitForFunction(() => document.querySelector('#notice').textContent.includes('Camera permission was denied'));
  assert.equal(await denied.evaluate(() => document.querySelector('#camera').srcObject), null);
  await denied.close();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const mobile = await phone.newPage();
  await mobile.goto(url);
  await mobile.locator('#reply').fill('Hello! Can we talk?'); await mobile.locator('#show-reply').click();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await mobile.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await mobile.locator('#tab-sign').click();
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await mobile.locator('#help-button').click();
  assert.equal(await mobile.locator('#help-dialog').isVisible(), true);
  await mobile.keyboard.press('Escape');
  assert.deepEqual(errors, []);
  console.log('PASS: captions lifecycle, safe text, replies, display synchronization, clear/export, demo labels, shared meeting audio routing and cleanup, permissions, real model loading, camera cleanup, preferences, keyboard tabs and mobile layout.');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
