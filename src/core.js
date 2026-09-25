export const DEFAULTS = Object.freeze({ language: 'en-US', size: 36, contrast: false });
export const LANGUAGES = ['en-US', 'en-GB', 'fr-FR', 'nl-NL', 'es-ES', 'de-DE', 'ar-SA', 'bn-BD'];
export function readPreferences(storage) {
  try {
    const raw = JSON.parse(storage.getItem('clearsign.preferences')) || {};
    return {
      language: LANGUAGES.includes(raw.language) ? raw.language : DEFAULTS.language,
      size: [28, 36, 48].includes(raw.size) ? raw.size : DEFAULTS.size,
      contrast: raw.contrast === true,
    };
  } catch { return { ...DEFAULTS }; }
}
export function transcriptText(entries) {
  return entries.map(entry => `[${entry.time}] ${entry.sample ? '[SAMPLE] ' : ''}${entry.speaker}: ${entry.text}`).join('\n\n');
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
const angle = (a, b, c) => {
  const u = [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
  const v = [c.x - b.x, c.y - b.y, (c.z || 0) - (b.z || 0)];
  const norm = Math.hypot(...u) * Math.hypot(...v);
  return norm ? Math.acos(Math.max(-1, Math.min(1, u.reduce((n, x, i) => n + x * v[i], 0) / norm))) * 180 / Math.PI : 0;
};

// Experimental geometric candidates, NOT a trained ASL classifier. Always confirm.
// Only palm-facing, upright, single-hand poses are accepted. No words or motion.
export function classifyHand(points) {
  if (!Array.isArray(points) || points.length !== 21 || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || (p.z !== undefined && !Number.isFinite(p.z)))) return null;
  const scale = distance(points[0], points[9]);
  if (scale < 0.07 || points[9].y > points[0].y - scale * 0.35 || Math.abs(points[9].x - points[0].x) > scale * 0.7) return null;
  if (Math.abs((points[5].z || 0) - (points[17].z || 0)) > scale * 0.65) return null;
  const fingers = [5, 9, 13, 17].map(base => {
    const straight = angle(points[base], points[base + 1], points[base + 3]);
    const reach = distance(points[base + 3], points[0]) / distance(points[base + 1], points[0]);
    if (straight > 155 && reach > 1.12) return 1;
    if (straight < 125 && reach < 1.05) return 0;
    return -1;
  });
  if (fingers.includes(-1)) return null;
  const thumbOut = distance(points[4], points[5]) > scale * 0.65 && angle(points[1], points[2], points[4]) > 145;
  const thumbIn = distance(points[4], points[5]) < scale * 0.6;
  const pattern = fingers.join('');
  if (pattern === '1000' && thumbOut) return 'L';
  if (pattern === '0001' && thumbOut) return 'Y';
  if (pattern === '0001' && thumbIn) return 'I';
  if (pattern === '1100' && thumbIn && distance(points[8], points[12]) / scale > 0.45) return 'V';
  if (pattern === '1111' && thumbIn && distance(points[8], points[12]) / scale < 0.4) return 'B';
  if (pattern === '0000' && !thumbOut && points[4].y < points[5].y && distance(points[4], points[5]) < scale * 0.55) return 'A';
  return null;
}

export function createStabilityTracker(holdMs = 850) {
  let previous = null;
  let since = 0;
  return (candidate, now) => {
    if (!candidate || candidate !== previous) { previous = candidate; since = now; }
    const progress = candidate ? Math.min(1, Math.max(0, (now - since) / holdMs)) : 0;
    return { candidate, progress, ready: progress === 1 };
  };
}

export function validateVideoFile(file) {
  if (!file) return 'missing-file';
  if (!(file.type?.startsWith('video/') || (!file.type && /\.(mp4|webm|ogv|ogg|mov|m4v)$/i.test(file.name || '')))) return 'invalid-file';
  if (!Number.isFinite(file.size) || file.size <= 0) return 'empty-file';
  if (file.size > 500 * 1024 * 1024) return 'large-file';
  return null;
}
export function createVideoCandidateGate(holdMs = 650, maxGapMs = 500) {
  let stabilize = createStabilityTracker(holdMs); let lastTime = null; let emitted = null;
  return (candidate, mediaTime) => {
    // Video time prevents a paused frame or a seek from fabricating stability.
    if (!Number.isFinite(mediaTime) || (lastTime !== null && (mediaTime < lastTime || mediaTime - lastTime > maxGapMs))) {
      stabilize = createStabilityTracker(holdMs); emitted = null;
    }
    if (!Number.isFinite(mediaTime)) { lastTime = null; return { candidate: null, ready: false, fresh: false, progress: 0 }; }
    lastTime = mediaTime;
    if (candidate !== emitted) emitted = null;
    const state = stabilize(candidate, mediaTime);
    const fresh = state.ready && candidate !== emitted;
    if (fresh) emitted = candidate;
    return { ...state, fresh };
  };
}
export function formatVideoTime(seconds) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`;
}
