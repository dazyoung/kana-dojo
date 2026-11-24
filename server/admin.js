#!/usr/bin/env node
// Admin tasks for the Kana Dojo database. Run from the project folder, e.g.:
//
//   node server/admin.js users                       list accounts
//   node server/admin.js snapshots <user>            list saved earlier copies of a user's progress
//   node server/admin.js restore <user> <snapshot>   put an earlier copy back (devices pick it up on next sync)
//   node server/admin.js reset-password <user>       set a new random password and print it
//   node server/admin.js delete <user>               delete an account and its progress
//   node server/admin.js backup <file>               copy the whole database to <file>
//
// Add --db <file> to use a database other than var/kana-dojo.db.
'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { open, hashPassword } = require('./db');
const M = require('../js/merge');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const dbAt = args.indexOf('--db');
const DB_FILE = path.resolve(ROOT, dbAt >= 0 ? args.splice(dbAt, 2)[1] : (process.env.KANA_DB || 'var/kana-dojo.db'));
const [cmd, a1, a2] = args;

if (!fs.existsSync(DB_FILE)) { console.error(`No database at ${DB_FILE}`); process.exit(1); }
const db = open(DB_FILE);
const fmt = (t) => (t ? new Date(t).toLocaleString() : '-');
const describe = (p) => { const s = M.stats(M.clean(p)); return `${s.cards} cards, ${s.answers} answers`; };

function user(name) {
  const u = name && db.userByName(name);
  if (!u) { console.error(`No user "${name}"`); process.exit(1); }
  return u;
}

(async () => {
  switch (cmd) {
    case 'users': {
      const rows = db.listUsers();
      if (!rows.length) console.log('No accounts yet.');
      for (const r of rows) {
        console.log(`${r.username.padEnd(24)} created ${fmt(r.created)} · last sync ${fmt(r.updated)} · ${r.data ? describe(JSON.parse(r.data)) : 'no progress'}`);
      }
      break;
    }
    case 'snapshots': {
      const u = user(a1);
      const rows = db.listSnapshots(u.id);
      if (!rows.length) console.log('No snapshots yet (one is saved the first time progress changes each day).');
      for (const r of rows) console.log(`${r.label.padEnd(36)} ${describe(JSON.parse(r.data))}`);
      break;
    }
    case 'restore': {
      const u = user(a1);
      const snap = db.getSnapshot(u.id, a2 || '');
      if (!snap) { console.error(`No snapshot "${a2}". See: node server/admin.js snapshots ${u.username}`); process.exit(1); }
      const current = M.clean(db.getProgress(u.id));
      const restored = { ...M.clean(snap), gen: Date.now() }; // newer generation, so it replaces what devices have
      db.tx(() => db.putProgress(u.id, restored, current));
      console.log(`Restored ${u.username} to "${a2}" (${describe(restored)}). The progress it replaced was saved as a snapshot.`);
      break;
    }
    case 'reset-password': {
      const u = user(a1);
      const pw = crypto.randomBytes(9).toString('base64url');
      db.setPassword(u.id, await hashPassword(pw));
      db.endAllSessions(u.id);
      console.log(`New password for ${u.username}: ${pw}\n(All their devices are signed out. They can change it in Settings.)`);
      break;
    }
    case 'delete': {
      const u = user(a1);
      db.deleteUser(u.id);
      console.log(`Deleted ${u.username}.`);
      break;
    }
    case 'backup': {
      if (!a1) { console.error('Usage: node server/admin.js backup <file>'); process.exit(1); }
      const out = path.resolve(a1);
      if (fs.existsSync(out)) { console.error(`${out} already exists`); process.exit(1); }
      db.raw.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
      console.log(`Database copied to ${out}`);
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 12).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
  db.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
