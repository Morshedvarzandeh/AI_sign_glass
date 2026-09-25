import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.mjs';

test('static server serves app modules and refuses private paths, traversal, and writes', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-security-policy'), /connect-src 'self' blob:/);
  assert.match((await fetch(base + '/src/app.js')).headers.get('content-type'), /javascript/);
  assert.match((await fetch(base + '/vendor/wasm/vision_wasm_internal.wasm')).headers.get('content-type'), /wasm/);
  for (const route of ['/package.json', '/README.md', '/.git/config', '/src/..%2fpackage.json', '/vendor/..%2f..%2f..%2fserver.mjs', '/%zz']) {
    assert.ok((await fetch(base + route)).status >= 400, route);
  }
  assert.equal((await fetch(base + '/', { method: 'POST', body: 'x' })).status, 405);
  const head = await fetch(base + '/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});
