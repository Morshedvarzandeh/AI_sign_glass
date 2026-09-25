import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoCandidateGate, validateVideoFile, formatVideoTime } from '../src/core.js';

test('video files are validated before creating local object URLs', () => {
  assert.equal(validateVideoFile(null), 'missing-file');
  assert.equal(validateVideoFile({ name: 'note.txt', type: 'text/plain', size: 12 }), 'invalid-file');
  assert.equal(validateVideoFile({ name: 'empty.mp4', type: 'video/mp4', size: 0 }), 'empty-file');
  assert.equal(validateVideoFile({ name: 'huge.mp4', type: 'video/mp4', size: 501 * 1024 * 1024 }), 'large-file');
  assert.equal(validateVideoFile({ name: 'clip.webm', type: '', size: 1024 }), null);
  assert.equal(validateVideoFile({ name: 'clip.mp4', type: 'video/mp4', size: 1024 }), null);
});
test('a held letter produces one suggestion until the handshape changes or is released', () => {
  const next = createVideoCandidateGate();
  for (let ms = 0; ms < 700; ms += 100) assert.equal(next('L', ms).fresh, false);
  assert.equal(next('L', 700).fresh, true);
  assert.equal(next('L', 800).fresh, false);
  assert.equal(next('L', 900).fresh, false);
  next(null, 1000);
  for (let ms = 1100; ms < 1800; ms += 100) assert.equal(next('L', ms).fresh, false);
  assert.equal(next('L', 1800).fresh, true);
});
test('paused video cannot turn a frame into a confident candidate', () => {
  const next = createVideoCandidateGate();
  for (let attempt = 0; attempt < 100; attempt++) assert.equal(next('L', 0).ready, false);
});
test('seeking or a frame gap resets accumulated confidence', () => {
  const next = createVideoCandidateGate();
  for (let ms = 0; ms <= 600; ms += 100) next('L', ms);
  assert.equal(next('L', 8000).ready, false);
  assert.equal(next('L', 0).ready, false);
  assert.equal(next('L', NaN).ready, false);
});
test('changing letters requires a fresh stable sequence', () => {
  const next = createVideoCandidateGate();
  for (let ms = 0; ms <= 700; ms += 100) next('L', ms);
  assert.equal(next('V', 800).ready, false);
  assert.equal(next('L', 900).ready, false);
});
test('candidate time is derived from video playback', () => {
  assert.equal(formatVideoTime(64.9), '1:04');
  assert.equal(formatVideoTime(-1), '0:00');
  assert.equal(formatVideoTime(Infinity), '0:00');
});
