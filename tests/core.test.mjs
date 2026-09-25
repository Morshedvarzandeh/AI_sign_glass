import test from 'node:test';
import assert from 'node:assert/strict';
import { readPreferences, transcriptText, classifyHand, createStabilityTracker } from '../src/core.js';

test('settings reject malformed, unsupported and incorrectly typed persisted values', () => {
  assert.deepEqual(readPreferences({ getItem: () => '{broken' }), { language: 'en-US', size: 36, contrast: false });
  assert.deepEqual(readPreferences({ getItem: () => JSON.stringify({ language: 'unknown', size: 999, contrast: 'true' }) }), { language: 'en-US', size: 36, contrast: false });
  assert.deepEqual(readPreferences({ getItem: () => JSON.stringify({ language: 'ar-SA', size: 48, contrast: true }) }), { language: 'ar-SA', size: 48, contrast: true });
  assert.deepEqual(readPreferences(null), { language: 'en-US', size: 36, contrast: false });
});
test('export preserves Unicode and labels artificial samples', () => {
  const text = transcriptText([{ time: '10:00', speaker: 'You', text: 'مرحبا 👋' }, { time: '10:01', speaker: 'Speaker', sample: true, text: 'Hello' }]);
  assert.equal(text, '[10:00] You: مرحبا 👋\n\n[10:01] [SAMPLE] Speaker: Hello');
});
test('unstable, missing and changed handshapes cannot be confirmed', () => {
  const update = createStabilityTracker(850);
  assert.equal(update('L', 0).ready, false);
  assert.equal(update('L', 849).ready, false);
  assert.equal(update('L', 850).ready, true);
  assert.equal(update('V', 900).ready, false);
  assert.equal(update(null, 2000).ready, false);
  assert.equal(update('V', 2001).ready, false);
});
test('landmark rules reject missing, degenerate and non-finite inputs', () => {
  for (const points of [null, [], Array(21).fill({ x: 0, y: 0 }), Array(21).fill({ x: NaN, y: 0 }), Array(21).fill({ x: 0, y: 0, z: Infinity })]) assert.equal(classifyHand(points), null);
});

// Synthetic geometry tests guard the rules. They do not measure real signing accuracy.
function syntheticL() {
  const p = Array.from({ length: 21 }, () => ({ x: .5, y: .6, z: 0 }));
  p[0] = { x: .5, y: .9 };
  for (let finger = 0; finger < 4; finger++) {
    const base = 5 + finger * 4;
    const x = .39 + finger * .07;
    p[base] = { x, y: .6 };
    p[base + 1] = { x, y: .45 };
    p[base + 2] = { x, y: finger === 0 ? .32 : .5 };
    p[base + 3] = { x, y: finger === 0 ? .2 : .62 };
  }
  p[1] = { x: .43, y: .8 }; p[2] = { x: .34, y: .73 }; p[3] = { x: .24, y: .66 }; p[4] = { x: .13, y: .59 };
  return p;
}
test('an upright synthetic L is invariant under horizontal mirroring; inverted hand is rejected', () => {
  const hand = syntheticL();
  assert.equal(classifyHand(hand), 'L');
  assert.equal(classifyHand(hand.map(p => ({ ...p, x: 1 - p.x }))), 'L');
  assert.equal(classifyHand(hand.map(p => ({ ...p, y: 1 - p.y }))), null);
});
