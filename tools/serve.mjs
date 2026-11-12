// Zero-dependency static file server for the mockups.
//   node tools/serve.mjs            serve on http://127.0.0.1:4517
//   node tools/serve.mjs --open     ...and open the gallery in the default browser
//   PORT=5000 node tools/serve.mjs  use another port
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_PORT = 4517;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
  '.md': 'text/plain; charset=utf-8',
};

async function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  const full = path.resolve(ROOT, '.' + rel);
  // Never serve anything outside the project folder.
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  try {
    const s = await stat(full);
    if (s.isDirectory()) {
      if (!rel.endsWith('/')) return { redirect: rel + '/' };
      const index = path.join(full, 'index.html');
      await stat(index);
      return { file: index };
    }
    return { file: full };
  } catch {
    return null;
  }
}

export function startServer(port = DEFAULT_PORT) {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/' || req.url === '') {
      res.writeHead(302, { Location: '/mockups/' });
      return res.end();
    }
    const hit = await resolveFile(req.url);
    if (!hit) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Not found');
    }
    if (hit.redirect) {
      res.writeHead(302, { Location: hit.redirect });
      return res.end();
    }
    try {
      const body = await readFile(hit.file);
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(hit.file).toLowerCase()] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Could not read file');
    }
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    // Loopback only: the mockups are never exposed to the network.
    server.listen(port, '127.0.0.1', () => resolve({ server, port, url: `http://127.0.0.1:${port}/` }));
  });
}

const runDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const wantOpen = process.argv.includes('--open');
  const openInBrowser = (target) => {
    const cmd = process.platform === 'win32' ? `start "" "${target}"`
      : process.platform === 'darwin' ? `open "${target}"` : `xdg-open "${target}"`;
    exec(cmd);
  };
  try {
    const { url } = await startServer(port);
    console.log(`Doozer mockups: ${url}mockups/`);
    if (wantOpen) openInBrowser(`${url}mockups/`);
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      // Most likely the mockups are already being served (another terminal, or Claude's preview).
      const existing = `http://127.0.0.1:${port}/mockups/`;
      console.log(`Port ${port} is already in use - the mockups are probably already running at ${existing}`);
      if (wantOpen) openInBrowser(existing);
    } else {
      console.error(err);
      process.exitCode = 1;
    }
  }
}
