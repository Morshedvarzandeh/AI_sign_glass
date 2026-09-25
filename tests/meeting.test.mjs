import test from 'node:test';
import assert from 'node:assert/strict';
import { MeetingAudio, meetingSupport } from '../src/meeting.js';

class Track extends EventTarget {
  constructor(kind) { super(); this.kind = kind; this.readyState = 'live'; this.enabled = true; }
  stop() { this.readyState = 'ended'; }
}
function stream(audio = true) {
  const tracks = [new Track('video'), ...(audio ? [new Track('audio')] : [])];
  return { getTracks: () => tracks, getVideoTracks: () => tracks.filter(t => t.kind === 'video'), getAudioTracks: () => tracks.filter(t => t.kind === 'audio') };
}
function setup(getDisplayMedia) {
  const events = { ready: [], errors: [], ended: 0 };
  const meeting = new MeetingAudio({ getDisplayMedia }, { status() {}, ready: t => events.ready.push(t), error: text => events.errors.push(text), ended: () => events.ended++ });
  return { meeting, events };
}
test('meeting input requires supported desktop audio-track recognition and screen sharing', () => {
  const nav = { userAgent: 'Chrome/140.0', mediaDevices: { getDisplayMedia() {} } };
  assert.equal(meetingSupport(nav, class {}), true);
  for (const userAgent of ['Chrome/134.0', 'Safari/18', 'Firefox/150', 'Chrome/140.0 Mobile', 'Android Chrome/140.0']) assert.equal(meetingSupport({ ...nav, userAgent }, class {}), false);
  assert.equal(meetingSupport(nav, undefined), false);
});
test('meeting capture passes live shared audio and releases all tracks on stop', async () => {
  const capture = stream();
  const { meeting, events } = setup(async () => capture);
  await meeting.start();
  assert.equal(events.ready[0], capture.getAudioTracks()[0]);
  assert.equal(capture.getVideoTracks()[0].enabled, false);
  meeting.stop();
  assert.ok(capture.getTracks().every(t => t.readyState === 'ended'));
  assert.equal(meeting.track, null);
});
test('missing shared audio closes capture without falling back to microphone', async () => {
  const capture = stream(false);
  const { meeting, events } = setup(async () => capture);
  await meeting.start();
  assert.equal(events.ready.length, 0);
  assert.match(events.errors[0], /No meeting audio/);
  assert.equal(capture.getTracks()[0].readyState, 'ended');
});
test('cancelling a pending picker stops a stream granted later', async () => {
  let resolve;
  const capture = stream();
  const { meeting, events } = setup(() => new Promise(r => { resolve = r; }));
  const pending = meeting.start(); meeting.stop(); resolve(capture); await pending;
  assert.equal(events.ready.length, 0);
  assert.ok(capture.getTracks().every(t => t.readyState === 'ended'));
});
test('browser Stop sharing and permission denial terminate the session', async () => {
  const capture = stream();
  const { meeting, events } = setup(async () => capture);
  await meeting.start(); capture.getTracks()[0].dispatchEvent(new Event('ended'));
  assert.equal(events.ended, 1); assert.equal(meeting.active, false);
  assert.ok(capture.getTracks().every(t => t.readyState === 'ended'));
  const denied = setup(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  await denied.meeting.start();
  assert.equal(denied.meeting.active, false); assert.match(denied.events.errors[0], /cancelled or denied/);
});
