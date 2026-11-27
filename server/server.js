#!/usr/bin/env node
// Kana Dojo server: serves the app and stores each user's progress so it syncs between devices.
// No dependencies, just Node 22+.
//
//   node server/server.js [--port 8000] [--host ::] [--db var/kana-dojo.db] [--signups open|closed]
//                         [--base /kana] [--trust-proxy 1] [--contact you@example.com] [--log-days 30]
//                         [--store sqlite|firestore] [--project <gcp project>] [--database staging]
//                         [--donate https://buymeacoffee.com/you] [--public-url https://example.web.app]
//                         [--proxy-nets 142.250.0.0/15,…]
//
// (Each flag can also be set with an environment variable: PORT, HOST, KANA_DB, KANA_SIGNUPS, KANA_BASE,
// TRUST_PROXY, KANA_CONTACT, KANA_LOG_DAYS, KANA_STORE, GOOGLE_CLOUD_PROJECT, KANA_FIRESTORE_DB, KANA_DONATE_URL,
// KANA_PUBLIC_URL, KANA_PROXY_NETS; KANA_LOG_FORWARDED=1 also logs each API request's forwarding headers.)
'use strict';
const crypto = require('node:crypto');
const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const zlib = require('node:zlib');
const path = require('node:path');
const { openStore } = require('./store');
const { accounts } = require('./accounts');
const { hashPassword, checkPassword } = require('./passwords');
const M = require('../js/merge');
const { appVersion } = require('./version');
const { metrics } = require('./metrics');

const arg = (name, env, def) => {
  const i = process.argv.indexOf('--' + name);
  if (i > 1 && process.argv[i + 1] !== undefined) return process.argv[i + 1];
  return process.env[env] !== undefined ? process.env[env] : def;
};
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(arg('port', 'PORT', 8000));
const HOST = arg('host', 'HOST', undefined); // default: every interface, IPv4 and IPv6
// Where accounts and progress are kept: a SQLite file (--db), or Firestore in a Google Cloud project.
const STORE = arg('store', 'KANA_STORE', 'sqlite');
const DB_FILE = path.resolve(ROOT, arg('db', 'KANA_DB', path.join('var', 'kana-dojo.db')));
const PROJECT = arg('project', 'GOOGLE_CLOUD_PROJECT', '');
const DATABASE = arg('database', 'KANA_FIRESTORE_DB', '(default)'); // which Firestore database in the project
const SIGNUPS = arg('signups', 'KANA_SIGNUPS', 'open') !== 'closed';
// How many proxies in front of the server add to X-Forwarded-For: the client's address is that many
// entries from the end (earlier entries come from the client and can't be trusted). 0 = no proxy.
const TRUST_PROXY = Math.max(0, Math.floor(Number(arg('trust-proxy', 'TRUST_PROXY', 0)) || 0));
// Networks of further proxies that may sit in front of those (e.g. Firebase Hosting in front of Cloud Run).
// When the address found above is in one of these, the client is the one before it.
const PROXY_NETS = new net.BlockList();
const PROXY_NETS_LIST = String(arg('proxy-nets', 'KANA_PROXY_NETS', '')).split(',').map((s) => s.trim()).filter(Boolean);
for (const cidr of PROXY_NETS_LIST) {
  const [addr, bits] = cidr.split('/');
  const type = net.isIPv6(addr) ? 'ipv6' : 'ipv4';
  if (!net.isIP(addr) || !(Number(bits) >= 0)) throw new Error(`--proxy-nets: "${cidr}" isn't a network like 142.250.0.0/15`);
  PROXY_NETS.addSubnet(addr, Number(bits), type);
}
const inProxyNets = (ip) => net.isIP(ip) > 0 && PROXY_NETS_LIST.length > 0 && PROXY_NETS.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
const LOG_FORWARDED = arg('log-forwarded', 'KANA_LOG_FORWARDED', '') === '1';
// The site's one public address (e.g. https://kanadojo.web.app): pages opened at the service's own
// *.run.app address are sent there, so everyone uses the same address (and the same saved progress).
const PUBLIC_URL = String(arg('public-url', 'KANA_PUBLIC_URL', '')).replace(/\/+$/, '');
if (PUBLIC_URL && !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(PUBLIC_URL)) throw new Error(`--public-url must look like https://example.web.app, not "${PUBLIC_URL}"`);
// Shown in the privacy note: who to contact, and how long server logs are kept (both optional).
const CONTACT = String(arg('contact', 'KANA_CONTACT', '')).trim();
// A page where people can support the site (e.g. Buy Me a Coffee). The app links to it; nothing else.
const DONATE = String(arg('donate', 'KANA_DONATE_URL', '')).trim();
if (DONATE && !/^https:\/\/[^\s"'<>]+$/.test(DONATE)) throw new Error(`--donate must be an https:// address, not "${DONATE}"`);
const LOG_DAYS = Math.max(0, Math.floor(Number(arg('log-days', 'KANA_LOG_DAYS', 0)) || 0));
// New accounts allowed per network address, and in all, each day.
const SIGNUPS_PER_IP = 5;
const SIGNUPS_PER_DAY = Math.max(1, Math.floor(Number(process.env.KANA_SIGNUPS_PER_DAY) || 200));
// Also serve the app under this path (e.g. /kana, when a reverse proxy publishes it at
// https://example.com/kana). The app still answers at / too.
const BASE = String(arg('base', 'KANA_BASE', '')).replace(/\/+$/, '');
if (BASE && !/^\/[\w.-]+(\/[\w.-]+)*$/.test(BASE)) throw new Error(`--base must look like /kana, not "${BASE}"`);

const store = openStore({ kind: STORE, file: DB_FILE, project: PROJECT, database: DATABASE });
const db = accounts(store);
const usage = metrics(store); // daily usage totals (node server/admin.js metrics)
const STORE_INFO = STORE === 'sqlite' ? `database: ${DB_FILE}` : `store: ${STORE} ${PROJECT || '(project from Cloud Run)'}/${DATABASE}`;

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
  let body = Buffer.from(JSON.stringify(obj));
  const headers = { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  // Bigger replies (synced progress) are gzipped when the browser accepts it: progress shrinks ~5x.
  if (body.length > 1024 && /\bgzip\b/.test((res.req && res.req.headers['accept-encoding']) || '')) {
    body = zlib.gzipSync(body);
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(status, { ...headers, 'Content-Length': body.length });
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

// index.html is stamped with the app's version (server/version.js): in a <meta> tag the page shows, and
// in the ?v= on each script and stylesheet, so browsers fetch fresh files after an update.
const INDEX = path.join(ROOT, 'index.html');
function indexHtml() {
  const v = appVersion();
  const attr = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return fs.readFileSync(INDEX, 'utf8')
    .replace(/\?v=dev\b/g, '?v=' + encodeURIComponent(v.label))
    .replace('</head>', `  <meta name="app-version" content="${attr(v.label)}" data-note="${attr(v.note)}">\n` +
      `  <meta name="site" data-contact="${attr(CONTACT)}" data-log-days="${LOG_DAYS || ''}" data-donate="${attr(DONATE)}">\n</head>`);
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
  const type = TYPES[path.extname(file)] || 'application/octet-stream';
  // Text files are sent gzipped when the browser accepts it (the kanji and word data shrink ~4x).
  const gz = /^(text\/|application\/(json|manifest)|image\/svg)/.test(type) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  const body = file === INDEX ? Buffer.from(indexHtml()) : null; // generated rather than read as is
  const tag = body ? crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16)
    : `${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}`;
  const etag = gz ? `"${tag}-gz"` : `"${tag}"`;
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Cache-Control': 'no-cache', // always check for a newer version, so updates show up on reload
    ETag: etag,
    Vary: 'Accept-Encoding',
  };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  if (gz) {
    const out = body ? zlib.gzipSync(body) : gzipped(file, tag);
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': out.length });
    return res.end(req.method === 'HEAD' ? undefined : out);
  }
  if (body) {
    res.writeHead(200, { ...headers, 'Content-Length': body.length });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }
  res.writeHead(200, { ...headers, 'Content-Length': st.size });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

const gzCache = new Map(); // file -> { tag, body }
function gzipped(file, tag) {
  const hit = gzCache.get(file);
  if (hit && hit.tag === tag) return hit.body;
  const body = zlib.gzipSync(fs.readFileSync(file), { level: 9 });
  gzCache.set(file, { tag, body });
  return body;
}

// ---------------------------------------------------------------------------
// Rate limiting (in memory)
// ---------------------------------------------------------------------------
const hits = new Map();
const recentHits = (key, windowMs) => (hits.get(key) || []).filter((t) => Date.now() - t < windowMs);
function hit(key) { const a = hits.get(key) || []; a.push(Date.now()); hits.set(key, a.slice(-200)); }
function tooMany(key, max, windowMs) { hit(key); return recentHits(key, windowMs).length > max; }
function clearHits(key) { hits.delete(key); }
const DAY = 24 * 3600e3;
setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of hits) if (!ts.some((t) => now - t < DAY)) hits.delete(k);
}, 600e3).unref();

// Behind a reverse proxy, the proxy says who the real client is: the last address in X-Forwarded-For is
// the one the nearest proxy saw (anything before it could have been sent by the client itself). A proxy on
// this machine counts as one proxy without --trust-proxy.
const LOOPBACK = /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/;
function clientIp(req) {
  const hops = TRUST_PROXY || (LOOPBACK.test(req.socket.remoteAddress || '') ? 1 : 0);
  const xff = hops && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',').map((s) => s.trim()) : [];
  if (xff.length < hops) return req.socket.remoteAddress || '?';
  let i = xff.length - hops;
  // Step back past known proxies (at most 3), never to an entry the client could have written itself.
  for (let n = 0; n < 3 && i > 0 && inProxyNets(xff[i]); n++) i--;
  return xff[i] || req.socket.remoteAddress || '?';
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
const USERNAME = /^[A-Za-z0-9_.-]{3,24}$/;
// What the app may count (js/usage.js).
const METRIC_KEY = /^(visits|lessons|workouts|(answers|correct|written|learned|drills)_(hiragana|katakana|kanji|vocab))$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
let dummyHash = null; // checked against when a username doesn't exist, so timing doesn't reveal that
hashPassword('not a real password').then((h) => { dummyHash = h; });

const str = (v) => (typeof v === 'string' ? v : '');
function validPassword(pw) {
  if (pw.length < MIN_PASSWORD) throw new HttpError(400, `Passwords need at least ${MIN_PASSWORD} characters`);
  if (pw.length > MAX_PASSWORD) throw new HttpError(400, 'That password is too long');
}

async function authUser(req) {
  const m = /^Bearer (\S+)$/.exec(String(req.headers.authorization || ''));
  const user = m && await db.sessionUser(m[1]);
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

async function syncProgress(userId, incoming) {
  try { return await db.syncProgress(userId, incoming); } catch (e) {
    if (e.code === 'TOO_BIG') throw new HttpError(413, e.message);
    throw e;
  }
}

const routes = {
  'GET /api/health': async () => ({ ok: true, signups: SIGNUPS, version: appVersion().version, build: appVersion().label }),

  // Anonymous usage totals from the app (js/usage.js), split by whether the device is signed in, plus one
  // visitor a day per address + browser (as a one-way code; see server/metrics.js).
  'POST /api/metrics': async (req) => {
    const ip = clientIp(req);
    if (tooMany('metrics:' + ip, 30, 60e3)) throw new HttpError(429, 'Too many');
    const body = await readJSON(req, 8 * 1024);
    const counts = body.counts && typeof body.counts === 'object' && !Array.isArray(body.counts) ? body.counts : {};
    const prefix = body.signedIn === true ? 'acct_' : 'anon_';
    const add = {};
    for (const [k, v] of Object.entries(counts).slice(0, 40)) {
      const n = Math.floor(Number(v));
      if (METRIC_KEY.test(k) && n > 0) add[prefix + k] = Math.min(n, 200); // more than a minute of real use
    }
    if (Object.keys(add).length) usage.add(add);
    await usage.seen('visitors', `${ip}|${String(req.headers['user-agent'] || '').slice(0, 300)}`);
    return { ok: true };
  },

  'POST /api/signup': async (req) => {
    guardAuthAttempts(req);
    if (!SIGNUPS) throw new HttpError(403, 'New accounts are switched off on this server');
    const ip = clientIp(req);
    if (recentHits('signup:' + ip, DAY).length >= SIGNUPS_PER_IP) {
      throw new HttpError(429, 'Too many new accounts from your network today. Try again tomorrow.');
    }
    if (recentHits('signup:all', DAY).length >= SIGNUPS_PER_DAY) {
      throw new HttpError(429, 'No more new accounts can be made today. Try again tomorrow.');
    }
    const body = await readJSON(req);
    const username = str(body.username).trim();
    const password = str(body.password);
    if (!USERNAME.test(username)) throw new HttpError(400, 'Usernames are 3–24 letters, numbers, dots, dashes or underscores');
    validPassword(password);
    if (await db.userByName(username)) throw new HttpError(409, 'That username is taken');
    let id;
    try { ({ id } = await db.createUser(username, password)); } catch (e) {
      if (e.code === 'TAKEN') throw new HttpError(409, 'That username is taken');
      throw e;
    }
    hit('signup:' + ip);
    hit('signup:all');
    usage.add({ signups: 1 });
    return { status: 201, body: { username, token: await db.newSession(id) } };
  },

  'POST /api/login': async (req) => {
    guardAuthAttempts(req);
    const body = await readJSON(req);
    const user = await db.userByName(str(body.username).trim());
    if (!(await verifyPassword(user, str(body.password)))) {
      usage.add({ login_failures: 1 });
      throw new HttpError(401, 'Wrong username or password');
    }
    usage.add({ logins: 1 });
    return { username: user.username, token: await db.newSession(user.id) };
  },

  'POST /api/logout': async (req) => {
    const { token } = await authUser(req);
    await db.endSession(token);
    return { ok: true };
  },

  'GET /api/me': async (req) => {
    const { user } = await authUser(req);
    return { username: user.username, created: user.created };
  },

  // Send this device's progress; get back the merged progress from all devices.
  // Both sides say which progress format they speak (merge.js FORMAT). An app page loaded before an
  // update is refused rather than merged, since it would misread the newer format.
  'POST /api/sync': async (req) => {
    const { user } = await authUser(req);
    if (tooMany('sync:' + user.id, 120, 60e3)) throw new HttpError(429, 'Syncing too often');
    const body = await readJSON(req);
    if (!(Number(body.client) >= M.FORMAT)) throw new HttpError(409, 'The app was updated. Reload the page to keep syncing.');
    const progress = await syncProgress(user.id, body.progress);
    usage.add({ syncs: 1 });
    usage.seen('accounts', user.id).catch(() => {});
    return { format: M.FORMAT, progress, stats: M.stats(progress) };
  },

  'POST /api/password': async (req) => {
    guardAuthAttempts(req);
    const { user, token } = await authUser(req);
    const body = await readJSON(req);
    if (!(await verifyPassword(user, str(body.password)))) throw new HttpError(403, 'Current password is wrong');
    const next = str(body.newPassword);
    validPassword(next);
    await db.setPassword(user.id, next);
    await db.endOtherSessions(user.id, token); // sign out other devices
    usage.add({ password_changes: 1 });
    return { ok: true };
  },

  'POST /api/delete-account': async (req) => {
    guardAuthAttempts(req);
    const { user } = await authUser(req);
    const body = await readJSON(req);
    if (!(await verifyPassword(user, str(body.password)))) throw new HttpError(403, 'Password is wrong');
    await db.deleteUser(user.id); // sessions, progress and snapshots go with it
    usage.add({ accounts_deleted: 1 });
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
  const fwd = LOG_FORWARDED ? ` xff=[${req.headers['x-forwarded-for'] || ''}] host=${req.headers.host || ''} xfh=${req.headers['x-forwarded-host'] || ''}` : '';
  console.log(`${new Date().toISOString()} ${clientIp(req)} ${req.method} ${p} ${status} ${Date.now() - t0}ms${fwd}`);
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
  // A page opened at the service's own address goes to the public one. (Requests arriving through
  // Firebase Hosting carry X-Forwarded-Host, so they're served; API calls are never redirected.)
  if (PUBLIC_URL && /\.run\.app$/i.test(String(req.headers.host || '').replace(/:\d+$/, '')) && !req.headers['x-forwarded-host'] &&
      (req.method === 'GET' || req.method === 'HEAD')) {
    res.writeHead(301, { ...SECURITY_HEADERS, Location: PUBLIC_URL + req.url, 'Cache-Control': 'no-cache' });
    return res.end();
  }
  serveStatic(req, res, p);
});
server.headersTimeout = 20e3;
server.requestTimeout = 60e3;

server.listen(PORT, HOST, () => {
  console.log(`${new Date().toISOString()} Kana Dojo ${appVersion().label} on http://localhost:${PORT}  (${STORE_INFO}, sign-ups ${SIGNUPS ? 'open' : 'closed'})`);
});

const expire = () => db.expireSessions().catch((e) => console.error(new Date().toISOString(), 'expiring sign-ins failed:', e.message));
expire();
setInterval(expire, 24 * 3600e3).unref();

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close();
    Promise.resolve(usage.flush()).then(() => store.close()).finally(() => process.exit(0));
  });
}
