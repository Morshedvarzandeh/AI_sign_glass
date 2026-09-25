import { mkdir, rename, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const source = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const expectedSha256 = 'fbc2a30080c3c557093b5ddfc334698132eb341044ccee322ccf8bcf3607cde1';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = new URL('../public/models/', import.meta.url);
const destination = new URL('hand_landmarker.task', directory);
await mkdir(directory, { recursive: true });
try {
  const current = await readFile(destination);
  if (digest(current) === expectedSha256) { console.log('Hand landmark model is installed and its checksum is verified.'); process.exit(0); }
} catch { /* first download */ }
console.log('Downloading the MediaPipe hand landmark model (version 1)…');
const response = await fetch(source, { signal: AbortSignal.timeout(60000) });
if (!response.ok) throw new Error(`Model download failed: ${response.status}`);
const bytes = Buffer.from(await response.arrayBuffer());
if (bytes.byteLength < 1_000_000 || bytes.byteLength > 30_000_000) throw new Error('Unexpected model file size.');
if (digest(bytes) !== expectedSha256) throw new Error('Model checksum does not match the pinned version.');
await writeFile(new URL('hand_landmarker.task.tmp', directory), bytes);
await rename(new URL('hand_landmarker.task.tmp', directory), destination);
console.log(`Saved ${bytes.byteLength} bytes. SHA-256: ${createHash('sha256').update(bytes).digest('hex')}`);
