#!/usr/bin/env node
// Kana Dojo server: serves the app and stores each user's progress so it syncs between devices.
// No dependencies, just Node 22+.
//
//   node server/server.js [--port 8000] [--host ::] [--db var/kana-dojo.db] [--signups open|closed]
//                         [--base /kana] [--trust-proxy 1]
//
// (Each flag can also be set with an environment variable: PORT, HOST, KANA_DB, KANA_SIGNUPS, KANA_BASE, TRUST_PROXY.)
'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { open, hashPassword, checkPassword } = require('./db');
const M = require('../js/merge');

const arg = (name, env, def) => {
  const i = process.argv.indexOf('--' + name);
  if (i > 1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  return process.env[env] !== undefined ? process.env[env] : def;
};
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(arg('port', 'PORT', 8000));
const HOST = arg('host', 'HOST', undefined); // default: every interface, IPv4 and IPv6
const DB_FILE = path.resolve(ROOT, arg('db', 'KANA_DB', path.join('var', 'kana-dojo.db')));
const SIGNUPS = arg('signups', 'KANA_SIGNUPS', 'open') !== 'closed';
const TRUST_PROXY = arg('trust-proxy', 'TRUST_PROXY', '') === '1';
// Also serve the app under this path (e.g. /kana, when a reverse proxy publishes it at
// https://example.com/kana). The app still answers at / too.
const BASE = String(arg('base', 'KANA_BASE', '')).replace(/\/+$/, '');
if (BASE && !/^\/[\w.-]+(\/[\w.-]+)*$/.test(BASE)) throw new Error(`--base must look like /kana, not "${BASE}"`);

const db = open(DB_FILE);

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJSON(req, limit = 4 * 1024 * 1024) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Expected JSON');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > limit) throw new HttpError(413, 'Too much data');
    chunks.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
    return v;
  } catch (e) { throw new HttpError(400, 'Bad JSON'); }
}

// ---------------------------------------------------------------------------
// Static files (only the app's own files are served)
// ---------------------------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};
const PUBLIC_FILES = new Set(['/index.html', '/icon.png']);
const PUBLIC_DIRS = ['/css/', '/js/', '/data/'];

function publicPath(p) {
  if (p === '/') p = '/index.html';
  if (PUBLIC_FILES.has(p)) return path.join(ROOT, p);
  for (const d of PUBLIC_DIRS) {
    const name = p.slice(d.length);
    if (p.startsWith(d) && /^[\w.-]+$/.test(name) && !name.startsWith('.')) return path.join(ROOT, d, name);
  }
  return null;
}

function serveStatic(req, res, p) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJSON(res, 405, { error: 'Method not allowed' });
  const file = publicPath(p);
  let st = null;
  try { if (file) st = fs.statSync(file); } catch (e) { /* missing */ }
  if (!st || !st.isFile()) {
    res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache', // always check for a newer version, so updates show up on reload
    ETag: etag,
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

// ---------------------------------------------------------------------------
// Rate limiting (in memory)
// ---------------------------------------------------------------------------
const hits = new Map();
const recentHits = (key, windowMs) => (hits.get(key) || []).filter((t) => Date.now() - t < windowMs);
function hit(key) { const a = hits.get(key) || []; a.push(Date.now()); hits.set(key, a.slice(-200)); }
function tooMany(key, max, windowMs) { hit(key); return recentHits(key, windowMs).length > max; }
function clearHits(key) { hits.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of hits) if (!ts.some((t) => now - t < 3600e3)) hits.delete(k);
}, 600e3).unref();

// Behind a reverse proxy on this machine, the proxy says who the real client is.
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;
const clientIp = (req) => ((TRUST_PROXY || LOOPBACK.test(req.socket.remoteAddress || '')) && req.headers['x-forwarded-for']
  ? String(req.headers['x-forwarded-for']).split(',')[0].trim()
  : req.socket.remoteAddress) || '?';

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
let dummyHash = null; // checked against when a username doesn't exist, so timing doesn't reveal that
hashPassword('not a real password').then((h) => { dummyHash = h; });

const str = (v) => (typeof v === 'string' ? v : '');
function validPassword(pw) {
  if (pw.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
  if (pw.length > MAX_PASSWORD) throw new HttpError(400, 'That password is too long');
}

function authUser(req) {
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  const user = m && db.sessionUser(m[1]);
  if (!user) throw new HttpError(401, 'Not signed in');
  return { user, token: m[1] };
}

function guardAuthAttempts(req) {
  if (tooMany('auth:' + clientIp(req), 30, 15 * 60e3)) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
}

// After 10 wrong passwords for an account within 15 minutes, that account refuses sign-in
// attempts until the 15 minutes are up.
async function verifyPassword(user, pw) {
  if (user && recentHits('fail:' + user.id, 15 * 60e3).length >= 10) {
    throw new HttpError(429, 'Too many wrong passwords. Try again in 15 minutes.');
  }
  const ok = user ? await checkPassword(pw, user.pass) : (await checkPassword(pw, dummyHash || ''), false);
  if (user) ok ? clearHits('fail:' + user.id) : hit('fail:' + user.id);
  return ok;
}

function syncProgress(userId, incoming) {
  return db.tx(() => {
    const raw = db.getProgress(userId);
    const stored = M.clean(raw);
    const merged = M.merge(stored, M.clean(incoming));
    if (!raw || !M.same(merged, stored)) db.putProgress(userId, merged, raw && stored);
    return merged;
  });
}

const routes = {
  'GET /api/health': async () => ({ ok: true, signups: SIGNUPS }),

  'POST /api/signup': async (req) => {
    guardAuthAttempts(req);
    if (!SIGNUPS) throw new HttpError(403, 'New accounts are switched off on this server');
    const body = await readJSON(req);
    const username = str(body.username).trim();
    const password = str(body.password);
    if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 3–24 letters, numbers, dots, dashes or underscores');
    validPassword(password);
    if (db.userByName(username)) throw new HttpError(409, 'That username is taken');
    const hash = await hashPassword(password);
    let id;
    try { id = db.addUser(username, hash); } catch (e) { throw new HttpError(409, 'That username is taken'); }
    return { status: 201, body: { username, token: db.newSession(id) } };
  },

  'POST /api/login': async (req) => {
    guardAuthAttempts(req);
    const body = await readJSON(req);
    const user = db.userByName(str(body.username).trim());
    if (!(await verifyPassword(user, str(body.password)))) throw new HttpError(401, 'Wrong username or password');
    return { username: user.username, token: db.newSession(user.id) };
  },

  'POST /api/logout': async (req) => {
    const { token } = authUser(req);
    db.endSession(token);
    return { ok: true };
  },

  'GET /api/me': async (req) => {
    const { user } = authUser(req);
    return { username: user.username, created: user.created };
  },

  // Send this device's progress; get back the merged progress from all devices.
  'POST /api/sync': async (req) => {
    const { user } = authUser(req);
    if (tooMany('sync:' + user.id, 120, 60e3)) throw new HttpError(429, 'Syncing too often');
    const body = await readJSON(req);
    const progress = syncProgress(user.id, body.progress);
    return { progress, stats: M.stats(progress) };
  },

  'POST /api/password': async (req) => {
    guardAuthAttempts(req);
    const { user, token } = authUser(req);
    const body = await readJSON(req);
    if (!(await verifyPassword(user, str(body.password)))) throw new HttpError(403, 'Current password is wrong');
    const next = str(body.newPassword);
    validPassword(next);
    db.setPassword(user.id, await hashPassword(next));
    db.endOtherSessions(user.id, token); // sign out other devices
    return { ok: true };
  },

  'POST /api/delete-account': async (req) => {
    guardAuthAttempts(req);
    const { user } = authUser(req);
    const body = await readJSON(req);
    if (!(await verifyPassword(user, str(body.password)))) throw new HttpError(403, 'Password is wrong');
    db.deleteUser(user.id); // sessions, progress and snapshots go with it
    return { ok: true };
  },
};

async function handleApi(req, res, p) {
  const t0 = Date.now();
  let status = 500;
  try {
    const route = routes[`${req.method} ${p}`];
    if (!route) throw new HttpError(Object.keys(routes).some((k) => k.endsWith(' ' + p)) ? 405 : 404, 'Not found');
    const out = await route(req);
    const hasStatus = out && typeof out.status === 'number' && out.body;
    status = hasStatus ? out.status : 200;
    sendJSON(res, status, hasStatus ? out.body : out);
  } catch (e) {
    status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(new Date().toISOString(), 'error', req.method, p, e);
    if (!res.headersSent) sendJSON(res, status, { error: status === 500 ? 'Server error' : e.message });
    else res.destroy();
  }
  console.log(`${new Date().toISOString()} ${clientIp(req)} ${req.method} ${p} ${status} ${Date.now() - t0}ms`);
}

// ---------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { p = null; }
  if (!p || p.includes('\0')) return sendJSON(res, 400, { error: 'Bad request' });
  if (BASE) {
    // "/kana" → "/kana/", so the page's relative links (js/…, api/…) resolve under /kana/.
    if (p === BASE) {
      res.writeHead(301, { ...SECURITY_HEADERS, Location: BASE + '/' });
      return res.end();
    }
    if (p.startsWith(BASE + '/')) p = p.slice(BASE.length);
  }
  if (p.startsWith('/api/')) return void handleApi(req, res, p);
  serveStatic(req, res, p);
});
server.headersTimeout = 20e3;
server.requestTimeout = 60e3;

server.listen(PORT, HOST, () => {
  console.log(`${new Date().toISOString()} Kana Dojo on http://localhost:${PORT}  (database: ${DB_FILE}, sign-ups ${SIGNUPS ? 'open' : 'closed'})`);
});

db.expireSessions();
setInterval(() => db.expireSessions(), 24 * 3600e3).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
