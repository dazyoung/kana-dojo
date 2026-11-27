// Storage on SQLite (built into Node 22+): the database file, for a server running on its own machine.
//
// A store only stores and fetches; every rule (when sign-ins expire, which earlier copies of progress to
// keep, merging) lives in server/accounts.js. store/firestore.js has the same methods, and
// server/test/store.test.js runs the same tests against both, so they behave the same.
//
// User ids are strings. Times are milliseconds since 1970. Progress is a plain object (see js/merge.js).
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

function taken() {
  const e = new Error('That username is taken');
  e.code = 'TAKEN';
  return e;
}

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
    -- Earlier copies of each user's progress, for recovery (see accounts.js for which are kept).
    CREATE TABLE IF NOT EXISTS snapshots (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label   TEXT NOT NULL,              -- '2026-11-24' or '2026-11-24T13:05:00Z before reset/import'
      data    TEXT NOT NULL,
      PRIMARY KEY (user_id, label)
    );
    -- Usage metrics: daily totals, and the day's one-way visitor codes (kept two days; see server/metrics.js).
    CREATE TABLE IF NOT EXISTS metrics (
      day TEXT NOT NULL,
      key TEXT NOT NULL,
      n   INTEGER NOT NULL,
      PRIMARY KEY (day, key)
    );
    CREATE TABLE IF NOT EXISTS metric_seen (
      day  TEXT NOT NULL,
      kind TEXT NOT NULL,
      hash TEXT NOT NULL,
      PRIMARY KEY (day, kind, hash)
    );
    CREATE TABLE IF NOT EXISTS secrets (
      name  TEXT PRIMARY KEY,
      value TEXT NOT NULL
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
    delSessions: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?'),
    delIdle: db.prepare('DELETE FROM sessions WHERE used < ?'),
    getProgress: db.prepare('SELECT data, updated FROM progress WHERE user_id = ?'),
    putProgress: db.prepare(`INSERT INTO progress (user_id, data, updated) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated = excluded.updated`),
    addSnapshot: db.prepare('INSERT OR IGNORE INTO snapshots (user_id, label, data) VALUES (?, ?, ?)'),
    pruneSnapshots: db.prepare(`DELETE FROM snapshots WHERE user_id = ? AND label NOT IN
      (SELECT label FROM snapshots WHERE user_id = ? ORDER BY label DESC LIMIT ?)`),
    listSnapshots: db.prepare('SELECT label, data FROM snapshots WHERE user_id = ? ORDER BY label DESC'),
    getSnapshot: db.prepare('SELECT data FROM snapshots WHERE user_id = ? AND label = ?'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    addMetric: db.prepare(`INSERT INTO metrics (day, key, n) VALUES (?, ?, ?)
      ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n`),
    addSeen: db.prepare('INSERT OR IGNORE INTO metric_seen (day, kind, hash) VALUES (?, ?, ?)'),
    getMetrics: db.prepare('SELECT day, key, n FROM metrics WHERE day >= ? AND day <= ? ORDER BY day'),
    forgetSeen: db.prepare('DELETE FROM metric_seen WHERE day < ?'),
    getSecret: db.prepare('SELECT value FROM secrets WHERE name = ?'),
    addSecret: db.prepare('INSERT OR IGNORE INTO secrets (name, value) VALUES (?, ?)'),
  };

  const user = (r) => (r ? { id: String(r.id), username: r.username, pass: r.pass, created: r.created } : null);
  const uid = (id) => Number(id);

  return {
    kind: 'sqlite',
    file,

    // ---------- users ----------
    async userByName(name) { return user(q.userByName.get(name)); },
    async userById(id) { return user(q.userById.get(uid(id))); },
    // Usernames are unique ignoring case; a clash throws an error with code 'TAKEN'.
    async addUser(username, pass, created) {
      try { return String(q.addUser.run(username, pass, created).lastInsertRowid); } catch (e) {
        if (/UNIQUE/.test(e.message)) throw taken();
        throw e;
      }
    },
    async setPassword(id, pass) { q.setPass.run(pass, uid(id)); },
    // Deletes the account with its sessions, progress and snapshots.
    async deleteUser(id) { q.delUser.run(uid(id)); },
    // Every account, oldest first: { id, username, created, updated, progress }.
    async listUsers() {
      return q.listUsers.all().map((r) => ({
        id: String(r.id), username: r.username, created: r.created,
        updated: r.updated || null, progress: r.data ? JSON.parse(r.data) : null,
      }));
    },

    // ---------- sessions (keyed by the hash of the browser's token) ----------
    // `expires` is for stores that delete old sessions themselves (Firestore's TTL); here deleteIdleSessions does it.
    async addSession(hash, userId, now, expires) { q.addSession.run(hash, uid(userId), now, now); },
    async getSession(hash) {
      const s = q.session.get(hash);
      return s ? { userId: String(s.user_id), created: s.created, used: s.used } : null;
    },
    async touchSession(hash, now, expires) { q.touchSession.run(now, hash); },
    async deleteSession(hash) { q.delSession.run(hash); },
    // All of a user's sessions, except `keepHash` if given.
    async deleteSessions(userId, keepHash = '') { q.delSessions.run(uid(userId), keepHash); },
    async deleteIdleSessions(usedBefore) { q.delIdle.run(usedBefore); },

    // ---------- progress ----------
    async getProgress(userId) {
      const r = q.getProgress.get(uid(userId));
      return r ? { progress: JSON.parse(r.data), updated: r.updated } : null;
    },
    // Read, change and write a user's progress as one step that nothing else can interleave with.
    // change(current) gets { progress, updated } or null, and returns
    //   { result, progress?, updated?, snapshot?: { label, progress }, keep? }
    // If `progress` is given it's stored. If `snapshot` is given it's saved unless that label already exists,
    // and then only the `keep` newest snapshots are kept. Returns `result`. change() must not have side
    // effects: other stores may run it more than once.
    async saveProgress(userId, change) {
      const id = uid(userId);
      db.exec('BEGIN IMMEDIATE');
      try {
        const r = q.getProgress.get(id);
        const out = change(r ? { progress: JSON.parse(r.data), updated: r.updated } : null);
        if (out.progress) q.putProgress.run(id, JSON.stringify(out.progress), out.updated);
        if (out.snapshot) {
          q.addSnapshot.run(id, out.snapshot.label, JSON.stringify(out.snapshot.progress));
          q.pruneSnapshots.run(id, id, out.keep);
        }
        db.exec('COMMIT');
        return out.result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },

    // ---------- snapshots ----------
    // Newest first: [{ label, progress }].
    async listSnapshots(userId) {
      return q.listSnapshots.all(uid(userId)).map((r) => ({ label: r.label, progress: JSON.parse(r.data) }));
    },
    async getSnapshot(userId, label) {
      const r = q.getSnapshot.get(uid(userId), label);
      return r ? JSON.parse(r.data) : null;
    },

    async countUsers() { return q.countUsers.get().n; },

    // ---------- usage metrics (see server/metrics.js) ----------
    // Add to a day's totals. `seen` is { kind: [one-way codes] }: codes not seen that day before are kept, and
    // the day's `kind` total goes up by how many were new.
    async addMetrics(day, counters, seen = {}) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const add = { ...counters };
        for (const [kind, hashes] of Object.entries(seen)) {
          let fresh = 0;
          for (const h of hashes) fresh += Number(q.addSeen.run(day, kind, h).changes);
          if (fresh) add[kind] = (add[kind] || 0) + fresh;
        }
        for (const [k, n] of Object.entries(add)) if (n) q.addMetric.run(day, k, n);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    // [{ day, counters }] for the days from..to (as 'YYYY-MM-DD') that have any, oldest first.
    async getMetrics(from, to) {
      const out = new Map();
      for (const r of q.getMetrics.all(from, to)) {
        if (!out.has(r.day)) out.set(r.day, {});
        out.get(r.day)[r.key] = r.n;
      }
      return [...out].map(([day, counters]) => ({ day, counters }));
    },
    // Drop the one-way codes of days before `day`; their totals stay.
    async forgetSeen(day) { q.forgetSeen.run(day); },
    // A random value made once and kept (e.g. what visitor codes are made with).
    async secret(name) {
      q.addSecret.run(name, crypto.randomBytes(32).toString('hex'));
      return q.getSecret.get(name).value;
    },

    // A consistent copy of the whole database, as another SQLite file.
    async backup(out) { db.exec(`VACUUM INTO '${String(out).replace(/'/g, "''")}'`); },
    async close() { db.close(); },
  };
}

module.exports = { open };
