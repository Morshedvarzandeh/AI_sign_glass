import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.task': 'application/octet-stream' };

export function createServer() {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self)');
    res.setHeader('Cache-Control', 'no-cache');
    // Video processing uses local model assets. In particular, prevent the
    // third-party vision runtime from transmitting its built-in usage logs.
    res.setHeader('Content-Security-Policy', "connect-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'");
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const base = pathname.startsWith('/src/') ? path.join(root, 'src')
        : pathname.startsWith('/vendor/') ? path.join(root, 'node_modules/@mediapipe/tasks-vision')
        : path.join(root, 'public');
      const relative = pathname.startsWith('/src/') ? pathname.slice(5)
        : pathname.startsWith('/vendor/') ? pathname.slice(8)
        : pathname === '/' ? 'index.html' : pathname.slice(1);
      const file = path.resolve(base, relative);
      if (!file.startsWith(base + path.sep) || !types[path.extname(file)]) {
        res.writeHead(404); res.end('Not found'); return;
      }
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      res.writeHead(error instanceof URIError ? 400 : 404);
      res.end('Not found');
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const host = process.env.HOST || '127.0.0.1';
  createServer().listen(port, host, () => console.log(`ClearSign is running at http://${host}:${port}`));
}
