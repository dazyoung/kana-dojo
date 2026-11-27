#!/usr/bin/env node
// Admin tasks for Kana Dojo's accounts. Run from the project folder, e.g.:
//
//   node server/admin.js users                       list accounts
//   node server/admin.js snapshots <user>            list saved earlier copies of a user's progress
//   node server/admin.js restore <user> <snapshot>   put an earlier copy back (devices pick it up on next sync)
//   node server/admin.js reset-password <user>       set a new random password and print it
//   node server/admin.js delete <user>               delete an account and its progress
//   node server/admin.js backup <file>               copy the whole database to <file> (SQLite only)
//
// Add --db <file> to use a database other than var/kana-dojo.db, or --firestore <project> for the
// Firestore database of a Google Cloud project (signed in with `gcloud auth login`).
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { openStore } = require('./store');
const { accounts } = require('./accounts');
const M = require('../js/merge');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined; };
const DB_FILE = path.resolve(ROOT, flag('--db') || process.env.KANA_DB || 'var/kana-dojo.db');
const PROJECT = flag('--firestore');
const [cmd, a1, a2] = args;

if (!PROJECT && !fs.existsSync(DB_FILE)) { console.error(`No database at ${DB_FILE}`); process.exit(1); }
const store = PROJECT ? openStore({ kind: 'firestore', project: PROJECT }) : openStore({ kind: 'sqlite', file: DB_FILE });
const db = accounts(store);
const fmt = (t) => (t ? new Date(t).toLocaleString() : '-');
const describe = (p) => { const s = M.stats(M.clean(p)); return `${s.cards} cards, ${s.answers} answers`; };

async function user(name) {
  const u = name && await db.userByName(name);
  if (!u) { console.error(`No user "${name}"`); process.exit(1); }
  return u;
}

(async () => {
  switch (cmd) {
    case 'users': {
      const rows = await db.listUsers();
      if (!rows.length) console.log('No accounts yet.');
      for (const r of rows) {
        console.log(`${r.username.padEnd(24)} created ${fmt(r.created)} · last sync ${fmt(r.updated)} · ${r.progress ? describe(r.progress) : 'no progress'}`);
      }
      break;
    }
    case 'snapshots': {
      const u = await user(a1);
      const rows = await db.listSnapshots(u.id);
      if (!rows.length) console.log('No snapshots yet (one is saved the first time progress changes each day).');
      for (const r of rows) console.log(`${r.label.padEnd(36)} ${describe(r.progress)}`);
      break;
    }
    case 'restore': {
      const u = await user(a1);
      const snap = await db.getSnapshot(u.id, a2 || '');
      if (!snap) { console.error(`No snapshot "${a2}". See: node server/admin.js snapshots ${u.username}`); process.exit(1); }
      const restored = await db.replaceProgress(u.id, snap);
      console.log(`Restored ${u.username} to "${a2}" (${describe(restored)}). The progress it replaced was saved as a snapshot.`);
      break;
    }
    case 'reset-password': {
      const u = await user(a1);
      const pw = crypto.randomBytes(9).toString('base64url');
      await db.setPassword(u.id, pw);
      await db.endAllSessions(u.id);
      console.log(`New password for ${u.username}: ${pw}\n(All their devices are signed out. They can change it in Settings.)`);
      break;
    }
    case 'delete': {
      const u = await user(a1);
      await db.deleteUser(u.id);
      console.log(`Deleted ${u.username}.`);
      break;
    }
    case 'backup': {
      if (!a1) { console.error('Usage: node server/admin.js backup <file>'); process.exit(1); }
      if (!store.backup) { console.error('Firestore is backed up with `gcloud firestore export` (see README).'); process.exit(1); }
      const out = path.resolve(a1);
      if (fs.existsSync(out)) { console.error(`${out} already exists`); process.exit(1); }
      await store.backup(out);
      console.log(`Database copied to ${out}`);
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
  await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
