// Accounts, sign-ins and progress, on top of a store (server/store/sqlite.js or store/firestore.js).
// Every rule lives here, so the stores only store and fetch, and behave the same.
'use strict';
const crypto = require('node:crypto');
const M = require('../js/merge');
const { hashPassword } = require('./passwords');

const DAY = 24 * 3600e3;
const SESSION_IDLE = 180 * DAY;    // sign-ins unused this long expire
const SESSION_TOUCH = 3600e3;      // note a sign-in's use at most this often
const SNAPSHOTS = 40;              // earlier copies of progress kept per user
const MAX_PROGRESS = 4 * 1024 * 1024; // bytes of progress per account (a learner who knows everything has ~3 MB)

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function error(code, message) {
  const e = new Error(message);
  e.code = code;
  return e;
}

// opts.now: the clock (tests set it).
function accounts(store, opts = {}) {
  const now = opts.now || Date.now;

  // An earlier copy of `previous` to keep when `next` replaces it: one from the start of each day it
  // changes, and one from just before every reset, import or restore (a new generation).
  function snapshotOf(previous, next) {
    if (!previous || !Object.keys(previous.cards).length) return null;
    const label = previous.gen !== next.gen
      ? new Date(now()).toISOString().slice(0, 19) + 'Z before reset/import'
      : new Date(now()).toISOString().slice(0, 10);
    return { label, progress: previous };
  }

  return {
    store,
    SESSION_IDLE,
    SNAPSHOTS,

    // ---------- users ----------
    userByName: (name) => store.userByName(String(name)),
    userById: (id) => store.userById(id),
    listUsers: () => store.listUsers(),
    async createUser(username, password) {
      const id = await store.addUser(username, await hashPassword(password), now());
      return { id, username };
    },
    async setPassword(userId, password) { await store.setPassword(userId, await hashPassword(password)); },
    deleteUser: (userId) => store.deleteUser(userId),

    // ---------- sign-ins: the browser holds a random token; only its hash is stored ----------
    async newSession(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const t = now();
      await store.addSession(sha(token), userId, t, t + SESSION_IDLE);
      return token;
    },
    // The user a token belongs to, or null if it's unknown or expired.
    async sessionUser(token) {
      if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
      const h = sha(token);
      const s = await store.getSession(h);
      if (!s) return null;
      const t = now();
      if (t - s.used > SESSION_IDLE) { await store.deleteSession(h); return null; }
      if (t - s.used > SESSION_TOUCH) await store.touchSession(h, t, t + SESSION_IDLE);
      return store.userById(s.userId);
    },
    endSession: (token) => store.deleteSession(sha(token)),
    endOtherSessions: (userId, token) => store.deleteSessions(userId, sha(token)),
    endAllSessions: (userId) => store.deleteSessions(userId),
    expireSessions: () => store.deleteIdleSessions(now() - SESSION_IDLE),

    // ---------- progress ----------
    async getProgress(userId) {
      const r = await store.getProgress(userId);
      return r ? M.clean(r.progress) : null;
    },
    // Merge what a device sent into the stored progress; returns the merged progress.
    // Throws code 'TOO_BIG' if the result would be more than MAX_PROGRESS.
    syncProgress(userId, incoming) {
      const fromDevice = M.clean(incoming);
      return store.saveProgress(userId, (cur) => {
        const stored = M.clean(cur && cur.progress);
        const merged = M.merge(stored, fromDevice);
        if (cur && M.same(merged, stored)) return { result: merged };
        if (Buffer.byteLength(JSON.stringify(merged)) > MAX_PROGRESS) throw error('TOO_BIG', 'Too much progress to store');
        return { result: merged, progress: merged, updated: now(), snapshot: snapshotOf(cur && stored, merged), keep: SNAPSHOTS };
      });
    },
    // Replace a user's progress outright with a new generation (admin restore), keeping what it replaces.
    replaceProgress(userId, progress) {
      const next = { ...M.clean(progress), gen: now() }; // newer generation: devices take it instead of merging
      return store.saveProgress(userId, (cur) => {
        const stored = cur ? M.clean(cur.progress) : null;
        return { result: next, progress: next, updated: now(), snapshot: snapshotOf(stored, next), keep: SNAPSHOTS };
      });
    },
    listSnapshots: (userId) => store.listSnapshots(userId),
    getSnapshot: (userId, label) => store.getSnapshot(userId, label),
  };
}

module.exports = { accounts, MAX_PROGRESS };
