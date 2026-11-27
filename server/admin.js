#!/usr/bin/env node
// Admin tasks for Kana Dojo's accounts. Run from the project folder, e.g.:
//
//   node server/admin.js users                       list accounts
//   node server/admin.js snapshots <user>            list saved earlier copies of a user's progress
//   node server/admin.js restore <user> <snapshot>   put an earlier copy back (devices pick it up on next sync)
//   node server/admin.js reset-password <user>       set a new random password and print it
//   node server/admin.js delete <user>               delete an account and its progress
//   node server/admin.js backup <file>               copy the whole database to <file> (SQLite only)
//   node server/admin.js metrics [days]              usage over the last 30 (or [days]) days
//
// Add --db <file> to use a database other than var/kana-dojo.db, or --firestore <project> for the
// Firestore database of a Google Cloud project (signed in with `gcloud auth login`); add --database <name>
// for a database other than "(default)" (e.g. staging).
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
const DATABASE = flag('--database') || '(default)';
const [cmd, a1, a2] = args;

if (!PROJECT && !fs.existsSync(DB_FILE)) { console.error(`No database at ${DB_FILE}`); process.exit(1); }
const store = PROJECT ? openStore({ kind: 'firestore', project: PROJECT, database: DATABASE }) : openStore({ kind: 'sqlite', file: DB_FILE });
const db = accounts(store);
const fmt = (t) => (t ? new Date(t).toLocaleString() : '-');
const describe = (p) => { const s = M.stats(M.clean(p)); return `${s.cards} cards, ${s.answers} answers`; };

async function user(name) {
  const u = name && await db.userByName(name);
  if (!u) { console.error(`No user "${name}"`); process.exit(1); }
  return u;
}

// The usage report: a line per day, then the period by script. "no acct" = devices not signed in.
const SCRIPTS = ['hiragana', 'katakana', 'kanji', 'vocab'];
function report(rows, accounts, from, to) {
  const sum = (c, re) => Object.entries(c).filter(([k]) => re.test(k)).reduce((t, [, n]) => t + n, 0);
  const total = {};
  for (const r of rows) for (const [k, n] of Object.entries(r.counters)) total[k] = (total[k] || 0) + n;
  const cols = [
    ['Day', 10, (c, d) => d],
    ['Visitors', 8, (c) => c.visitors || 0],
    ['Visits', 6, (c) => sum(c, /^(anon|acct)_visits$/)],
    ['Answers no acct / acct', 22, (c) => `${sum(c, /^anon_answers_/)} / ${sum(c, /^acct_answers_/)}`],
    ['Written', 7, (c) => sum(c, /_written_/)],
    ['Learned', 7, (c) => sum(c, /_learned_/)],
    ['Lessons', 7, (c) => sum(c, /_lessons$/)],
    ['Sign-ups', 8, (c) => c.signups || 0],
    ['Logins', 6, (c) => c.logins || 0],
    ['Active accts', 12, (c) => c.accounts || 0],
  ];
  const line = (c, d) => cols.map(([, w, f], i) => String(f(c, d)).padStart(i ? w : 0).padEnd(i ? 0 : w)).join('  ');
  const out = [`Kana Dojo usage, ${from} to ${to} (UTC days). Accounts: ${accounts} in all.`, ''];
  out.push(cols.map(([h, w], i) => (i ? h.padStart(w) : h.padEnd(w))).join('  '));
  for (const r of rows) out.push(line(r.counters, r.day));
  if (!rows.length) out.push('(nothing recorded yet)');
  out.push(line(total, 'Total'));
  out.push('', 'Visitors and active accounts in the total are summed per day, so someone who came on 3 days counts 3 times.', '');
  out.push(['Script', 'Answers no acct / acct', 'Correct', 'Written', 'Learned', 'Drills'].map((h, i) => (i ? h.padStart(i === 1 ? 22 : 8) : h.padEnd(10))).join('  '));
  for (const s of SCRIPTS) {
    const a = sum(total, new RegExp(`_answers_${s}$`));
    const ok = sum(total, new RegExp(`_correct_${s}$`));
    out.push([
      s.padEnd(10),
      `${sum(total, new RegExp(`^anon_answers_${s}$`))} / ${sum(total, new RegExp(`^acct_answers_${s}$`))}`.padStart(22),
      (a ? `${Math.round((100 * ok) / a)}%` : '-').padStart(8),
      String(sum(total, new RegExp(`_written_${s}$`))).padStart(8),
      String(sum(total, new RegExp(`_learned_${s}$`))).padStart(8),
      String(sum(total, new RegExp(`_drills_${s}$`))).padStart(8),
    ].join('  '));
  }
  out.push('', `Also: ${sum(total, /_workouts$/)} workouts, ${total.syncs || 0} syncs, ${total.login_failures || 0} failed sign-ins, ` +
    `${total.password_changes || 0} password changes, ${total.accounts_deleted || 0} accounts deleted.`);
  return out.join('\n');
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
    case 'metrics': {
      const days = Math.max(1, Math.min(400, Number(a1) || 30));
      const to = new Date().toISOString().slice(0, 10);
      const from = new Date(Date.now() - (days - 1) * 864e5).toISOString().slice(0, 10);
      console.log(report(await store.getMetrics(from, to), await store.countUsers(), from, to));
      break;
    }
    default:
      console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 14).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  }
  await store.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
