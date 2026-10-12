import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { initApi } from './src/app.mjs';

const root = resolve('public');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.pdf': 'application/pdf',
};

const api = initApi({ dataDir: resolve('.data') });
const sessions = api.sessionStore;
const COOKIE_NAME = 'vsdr';

// разбор cookie из заголовка
function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

// создаёт или достаёт сессию по cookie, при необходимости помечает Set-Cookie
function getOrCreateSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  let session = cookies[COOKIE_NAME] ? sessions.get(cookies[COOKIE_NAME]) : null;
  let created = false;
  if (!session) {
    session = sessions.create();
    created = true;
  }
  if (created) {
    res.setHeader('Set-Cookie',
      `${COOKIE_NAME}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  }
  return session;
}

const server = createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const session = getOrCreateSession(req, res);
      await api.handle(req, res, session);
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      const session = getOrCreateSession(req, res);
      void session;
      res.writeHead(405); return res.end();
    }
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
    const path = await realpath(resolve(root, '.' + decodeURIComponent(pathname)));
    if (!path.startsWith(root + sep)) throw new Error('outside');
    if ((await stat(path)).size > 5_000_000) { res.writeHead(413); return res.end(); }
    const content = await readFile(path);
    res.writeHead(200, { 'content-type': types[extname(path)] || 'application/octet-stream' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (e) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Страница не найдена');
  }
});

server.listen(3000, '127.0.0.1', () => {
  console.log('vse-dela server started on http://127.0.0.1:3000');
});