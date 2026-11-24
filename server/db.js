// Database (SQLite, built into Node 22+) and password hashing.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// node:sqlite prints an "experimental" warning on load; it's stable enough for this.
const emitWarning = process.emitWarning;
process.emitWarning = function (w, ...rest) {
  if (/SQLite is an experimental/.test(String(w && w.message ? w.message : w))) return;
  return emitWarning.call(this, w, ...rest);
};
const { DatabaseSync } = require('node:sqlite');

const DAY = 24 * 3600e3;
const SESSION_IDLE = 180 * DAY;   // sessions unused this long expire
const SNAPSHOTS = 40;             // earlier copies of progress kept per user

function open(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id       INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass     TEXT NOT NULL,
      created  INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token   TEXT PRIMARY KEY,           -- sha256 of the token the browser holds
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created INTEGER NOT NULL,
      used    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS progress (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      data    TEXT NOT NULL,
      updated INTEGER NOT NULL
    );
    -- Earlier copies of each user's progress, for recovery: the progress as it was at the start
    -- of each day it changed, and just before every reset or import.
    CREATE TABLE IF NOT EXISTS snapshots (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label   TEXT NOT NULL,              -- '2026-11-24' or '2026-11-24T13:05:00Z before reset/import'
      data    TEXT NOT NULL,
      PRIMARY KEY (user_id, label)
    );
  `);

  const q = {
    userByName: db.prepare('SELECT * FROM users WHERE username = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    addUser: db.prepare('INSERT INTO users (username, pass, created) VALUES (?, ?, ?)'),
    setPass: db.prepare('UPDATE users SET pass = ? WHERE id = ?'),
    delUser: db.prepare('DELETE FROM users WHERE id = ?'),
    listUsers: db.prepare(`SELECT u.id, u.username, u.created, p.updated, p.data
      FROM users u LEFT JOIN progress p ON p.user_id = u.id ORDER BY u.id`),
    addSession: db.prepare('INSERT INTO sessions (token, user_id, created, used) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE token = ?'),
    touchSession: db.prepare('UPDATE sessions SET used = ? WHERE token = ?'),
    delSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    delOtherSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?'),
    delAllSessions: db.prepare('DELETE FROM sessions WHERE user_id = ?'),
    expireSessions: db.prepare('DELETE FROM sessions WHERE used < ?'),
    getProgress: db.prepare('SELECT data, updated FROM progress WHERE user_id = ?'),
    putProgress: db.prepare(`INSERT INTO progress (user_id, data, updated) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated`),
    addSnapshot: db.prepare('INSERT OR IGNORE INTO snapshots (user_id, label, data) VALUES (?, ?, ?)'),
    pruneSnapshots: db.prepare(`DELETE FROM snapshots WHERE user_id = ? AND label NOT IN
      (SELECT label FROM snapshots WHERE user_id = ? ORDER BY label DESC LIMIT ${SNAPSHOTS})`),
    listSnapshots: db.prepare('SELECT label, data FROM snapshots WHERE user_id = ? ORDER BY label DESC'),
    getSnapshot: db.prepare('SELECT data FROM snapshots WHERE user_id = ? AND label = ?'),
  };

  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
  const today = () => new Date().toISOString().slice(0, 10);

  return {
    raw: db,
    close: () => db.close(),
    tx(fn) {
      db.exec('BEGIN IMMEDIATE');
      try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
    },

    userByName: (name) => q.userByName.get(name),
    userById: (id) => q.userById.get(id),
    addUser: (name, passHash) => Number(q.addUser.run(name, passHash, Date.now()).lastInsertRowid),
    setPassword: (id, passHash) => q.setPass.run(passHash, id),
    deleteUser: (id) => q.delUser.run(id),
    listUsers: () => q.listUsers.all(),

    // Sessions: the browser holds a random token; only its hash is stored.
    newSession(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      q.addSession.run(sha(token), userId, now, now);
      return token;
    },
    sessionUser(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
      const h = sha(token);
      const s = q.session.get(h);
      if (!s) return null;
      const now = Date.now();
      if (now - s.used > SESSION_IDLE) { q.delSession.run(h); return null; }
      if (now - s.used > 3600e3) q.touchSession.run(now, h);
      return q.userById.get(s.user_id) || null;
    },
    endSession: (token) => q.delSession.run(sha(token)),
    endOtherSessions: (userId, token) => q.delOtherSessions.run(userId, sha(token)),
    endAllSessions: (userId) => q.delAllSessions.run(userId),
    expireSessions: () => q.expireSessions.run(Date.now() - SESSION_IDLE),

    getProgress(userId) {
      const r = q.getProgress.get(userId);
      return r ? JSON.parse(r.data) : null;
    },
    // Save progress. `previous` (what was stored before) is kept as a snapshot the first time
    // progress changes each day, and always when a reset/import replaces it.
    putProgress(userId, progress, previous) {
      q.putProgress.run(userId, JSON.stringify(progress), Date.now());
      if (previous && Object.keys(previous.cards).length) {
        const label = previous.gen !== progress.gen
          ? new Date().toISOString().slice(0, 19) + 'Z before reset/import'
          : today();
        q.addSnapshot.run(userId, label, JSON.stringify(previous));
        q.pruneSnapshots.run(userId, userId);
      }
    },
    listSnapshots: (userId) => q.listSnapshots.all(userId),
    getSnapshot(userId, label) {
      const r = q.getSnapshot.get(userId, label);
      return r ? JSON.parse(r.data) : null;
    },
  };
}

// ---------- passwords (scrypt) ----------
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const scrypt = (pw, salt, len, opts) => new Promise((res, rej) =>
  crypto.scrypt(pw.normalize('NFKC'), salt, len, opts, (e, k) => (e ? rej(e) : res(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${Math.log2(SCRYPT.N)}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function checkPassword(pw, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, logN, r, p, salt, hash] = parts;
  const want = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), want.length,
    { N: 1 << Number(logN), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem });
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { open, hashPassword, checkPassword };
