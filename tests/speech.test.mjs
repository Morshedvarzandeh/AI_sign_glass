import test from 'node:test';
import assert from 'node:assert/strict';
import { CaptionController } from '../src/speech.js';

function setup() {
  const instances = [];
  class Recognition {
    constructor() { instances.push(this); }
    start(track) { this.track = track; this.onstart?.(); }
    abort() { this.onend?.(); this.aborted = true; }
  }
  const events = { statuses: [], interim: [], final: [], errors: [] };
  const callbacks = { status: x => events.statuses.push(x), interim: x => events.interim.push(x), final: x => events.final.push(x), error: x => events.errors.push(x) };
  const pending = new Map(); let id = 0;
  const timers = { setTimeout(fn) { pending.set(++id, fn); return id; }, clearTimeout(id) { pending.delete(id); } };
  const controller = new CaptionController(Recognition, callbacks, timers);
  const flush = () => { const fns = [...pending.values()]; pending.clear(); fns.forEach(fn => fn()); };
  return { controller, instances, events, pending, flush, callbacks };
}
test('interim captions remain separate from final transcript and late events are ignored after stop', () => {
  const { controller, instances, events } = setup();
  controller.start('en-GB');
  const recognition = instances[0];
  assert.equal(recognition.lang, 'en-GB');
  const partial = Object.assign([{ transcript: 'Hello there' }], { isFinal: false });
  recognition.onresult({ resultIndex: 0, results: [partial] });
  assert.deepEqual(events.final, []);
  assert.equal(events.interim.at(-1), 'Hello there');
  recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Hello there.' }], { isFinal: true })] });
  assert.deepEqual(events.final, ['Hello there.']);
  controller.stop();
  recognition.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: 'Late result' }], { isFinal: true })] });
  assert.deepEqual(events.final, ['Hello there.']);
  assert.equal(events.statuses.at(-1), 'idle');
});
test('stop cancels a pending automatic restart', () => {
  const { controller, instances, pending, flush } = setup();
  controller.start('en-US'); instances[0].onend();
  assert.equal(pending.size, 1);
  controller.stop(); flush();
  assert.equal(instances.length, 1);
});
test('permission and network failures stop input with an actionable error', () => {
  for (const error of ['not-allowed', 'network']) {
    const { controller, instances, events, pending } = setup();
    controller.start('en-US'); instances[0].onerror({ error });
    assert.equal(controller.active, false);
    assert.equal(pending.size, 0);
    assert.equal(events.errors.length, 1);
    assert.equal(instances[0].aborted, true);
  }
});
test('repeated empty sessions stop instead of restarting forever', () => {
  const { controller, instances, events, flush } = setup();
  controller.start('en-US');
  for (let i = 0; i < 3; i++) { instances.at(-1).onend(); flush(); }
  assert.equal(controller.active, false);
  assert.equal(events.errors.length, 1);
  assert.equal(instances.length, 3);
});
test('unsupported speech recognition produces a useful fallback', () => {
  const { callbacks, events } = setup();
  new CaptionController(undefined, callbacks).start('en-US');
  assert.match(events.errors[0], /type a message/);
});
test('shared meeting audio is passed through restarts and never replaced with microphone input', () => {
  const { controller, instances, flush } = setup();
  const track = { kind: 'audio', readyState: 'live' };
  controller.start('en-US', track);
  assert.equal(instances[0].track, track);
  instances[0].onend(); flush();
  assert.equal(instances[1].track, track);
  track.readyState = 'ended'; instances[1].onend(); flush();
  assert.equal(controller.active, false);
  assert.equal(instances[2].track, undefined);
});
