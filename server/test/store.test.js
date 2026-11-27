// The same tests for every store, run through accounts.js (where the rules live), so the SQLite store
// (a server on its own machine) and the Firestore store (Google Cloud) behave the same.
//
//   npm test                  SQLite only
//   npm run test:firestore    SQLite and Firestore (starts the Firestore emulator; needs Java)
//
// Firestore is tested whenever FIRESTORE_EMULATOR_HOST is set (each run uses its own emulator project).
'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { openStore } = require('../store');
const { accounts } = require('../accounts');
const { checkPassword } = require('../passwords');
const M = require('../../js/merge');

const DAY = 24 * 3600e3;
const BACKENDS = [{
  name: 'sqlite',
  open: () => openStore({ kind: 'sqlite', file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kana-store-')), 'test.db') }),
}];
if (process.env.FIRESTORE_EMULATOR_HOST) {
  BACKENDS.push({ name: 'firestore', open: () => openStore({ kind: 'firestore', project: `kana-test-${crypto.randomBytes(4).toString('hex')}` }) });
}

// A fresh store and accounts with a clock the test moves by hand.
function setup(b) {
  const clock = { t: Date.UTC(2026, 10, 27, 9, 0, 0) };
  const store = b.open();
  const a = accounts(store, { now: () => clock.t });
  return { a, store, clock };
}
const card = (t, level = 1) => ({ level, due: t + 3600e3, ok: 1, bad: 0, last: t, t, at: t });
const prog = (cards, gen = 0) => ({ v: M.FORMAT, gen, cards, log: {} });
// n word cards with long names: lots of bytes per card, like real word cards.
function many(n, t, tag = 'x') {
  const cards = {};
  for (let i = 0; i < n; i++) cards[`w:${tag}${i}語彙練習:ごいれんしゅう|meaning`] = card(t, 1 + (i % 12));
  return cards;
}

for (const b of BACKENDS) {
  describe(`store: ${b.name}`, () => {
    it('keeps usernames unique ignoring case, with their own spelling', async () => {
      const { a, store } = setup(b);
      const u = await a.createUser('Kenji', 'password123');
      assert.equal((await a.userByName('kenji')).id, u.id);
      assert.equal((await a.userByName('KENJI')).username, 'Kenji');
      assert.equal((await a.userById(u.id)).username, 'Kenji');
      await assert.rejects(a.createUser('kEnJi', 'password123'), { code: 'TAKEN' });
      assert.equal(await a.userByName('nobody'), null);
      assert.equal(await a.userById('999999'), null);
      await store.close();
    });

    it('handles every kind of allowed username', async () => {
      const { a, store, clock } = setup(b);
      for (const name of ['___', '__x__', '...', '-.-', 'a.b-c_d', 'x'.repeat(24)]) {
        const u = await a.createUser(name, 'password123');
        assert.equal((await a.userByName(name.toUpperCase())).id, u.id, name);
        const token = await a.newSession(u.id);
        assert.equal((await a.sessionUser(token)).username, name);
        await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
        assert.ok((await a.getProgress(u.id)).cards['あ|read'], name);
      }
      await store.close();
    });

    it('stores password hashes and changes them', async () => {
      const { a, store } = setup(b);
      const u = await a.createUser('pw-user', 'password123');
      assert.ok(await checkPassword('password123', (await a.userById(u.id)).pass));
      await a.setPassword(u.id, 'another-password');
      const pass = (await a.userByName('pw-user')).pass;
      assert.ok(await checkPassword('another-password', pass));
      assert.ok(!(await checkPassword('password123', pass)));
      await store.close();
    });

    it('signs in and out', async () => {
      const { a, store } = setup(b);
      const u = await a.createUser('sessions', 'password123');
      const t1 = await a.newSession(u.id);
      const t2 = await a.newSession(u.id);
      const t3 = await a.newSession(u.id);
      assert.equal((await a.sessionUser(t1)).id, u.id);
      assert.equal(await a.sessionUser('not-a-real-token-at-all'), null);
      assert.equal(await a.sessionUser(42), null);
      await a.endSession(t1);
      assert.equal(await a.sessionUser(t1), null);
      await a.endOtherSessions(u.id, t2);
      assert.equal((await a.sessionUser(t2)).id, u.id);
      assert.equal(await a.sessionUser(t3), null);
      await a.endAllSessions(u.id);
      assert.equal(await a.sessionUser(t2), null);
      await store.close();
    });

    it('expires sign-ins after 180 days unused', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('idle', 'password123');
      const used = await a.newSession(u.id);
      const unused = await a.newSession(u.id);
      clock.t += 179 * DAY;
      assert.ok(await a.sessionUser(used)); // using it keeps it alive
      clock.t += 179 * DAY;
      assert.ok(await a.sessionUser(used));
      assert.equal(await a.sessionUser(unused), null);
      const old = await a.newSession(u.id);
      clock.t += 181 * DAY;
      await a.expireSessions();
      assert.equal(await store.getSession(crypto.createHash('sha256').update(old).digest('hex')), null);
      assert.equal(await a.sessionUser(used), null);
      await store.close();
    });

    it('merges progress from several devices', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('merge', 'password123');
      assert.equal(await a.getProgress(u.id), null);
      const r1 = await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
      assert.deepEqual(Object.keys(r1.cards), ['あ|read']);
      clock.t += 60e3;
      const r2 = await a.syncProgress(u.id, prog({ 'い|read': card(clock.t, 2) }));
      assert.deepEqual(Object.keys(r2.cards).sort(), ['あ|read', 'い|read']);
      assert.deepEqual(await a.getProgress(u.id), r2);
      // A newer change to the same card wins.
      clock.t += 60e3;
      const r3 = await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t, 5) }));
      assert.equal(r3.cards['あ|read'].level, 5);
      // Nothing new: nothing is written.
      const before = await store.getProgress(u.id);
      clock.t += 60e3;
      await a.syncProgress(u.id, prog({}));
      assert.equal((await store.getProgress(u.id)).updated, before.updated);
      await store.close();
    });

    it('lets two devices sync at the same moment', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('together', 'password123');
      await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
      await Promise.all([
        a.syncProgress(u.id, prog({ 'か|read': card(clock.t) })),
        a.syncProgress(u.id, prog({ 'さ|read': card(clock.t) })),
        a.syncProgress(u.id, prog({ 'た|read': card(clock.t) })),
      ]);
      assert.deepEqual(Object.keys((await a.getProgress(u.id)).cards).sort(), ['あ|read', 'か|read', 'さ|read', 'た|read']);
      await store.close();
    });

    it('keeps progress larger than a Firestore document (1 MiB)', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('big', 'password123');
      const big = prog(many(20000, clock.t));
      assert.ok(Buffer.byteLength(JSON.stringify(big)) > 2.5e6);
      await a.syncProgress(u.id, big);
      assert.deepEqual(await a.getProgress(u.id), M.clean(big));
      clock.t += DAY; // the next day's change keeps a snapshot of it
      await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
      assert.deepEqual((await a.listSnapshots(u.id))[0].progress, M.clean(big));
      await store.close();
    });

    it('refuses progress over 4 MB', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('toobig', 'password123');
      await assert.rejects(a.syncProgress(u.id, prog(many(34000, clock.t))), { code: 'TOO_BIG' });
      assert.equal(await a.getProgress(u.id), null);
      await store.close();
    });

    it('keeps a snapshot from the start of each day, and before a reset', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('snaps', 'password123');
      await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
      assert.deepEqual(await a.listSnapshots(u.id), []); // nothing to keep yet
      const startOfDay = await a.getProgress(u.id);
      clock.t += 3600e3;
      await a.syncProgress(u.id, prog({ 'い|read': card(clock.t) }));
      clock.t += 3600e3;
      await a.syncProgress(u.id, prog({ 'う|read': card(clock.t) }));
      let snaps = await a.listSnapshots(u.id);
      assert.deepEqual(snaps.map((s) => s.label), ['2026-11-27']);
      assert.deepEqual(snaps[0].progress, startOfDay); // the day's first copy, not overwritten
      assert.deepEqual(await a.getSnapshot(u.id, '2026-11-27'), startOfDay);
      assert.equal(await a.getSnapshot(u.id, '2026-11-26'), null);
      clock.t += DAY;
      await a.syncProgress(u.id, prog({ 'え|read': card(clock.t) }));
      clock.t += 60e3;
      await a.syncProgress(u.id, prog({ 'お|read': card(clock.t) }, clock.t)); // a reset: a new generation
      snaps = await a.listSnapshots(u.id);
      assert.deepEqual(snaps.map((s) => s.label), ['2026-11-28T11:01:00Z before reset/import', '2026-11-28', '2026-11-27']);
      assert.deepEqual(Object.keys((await a.getProgress(u.id)).cards), ['お|read']);
      await store.close();
    });

    it('keeps only the 40 newest snapshots', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('forty', 'password123');
      for (let d = 0; d < 45; d++) {
        await a.syncProgress(u.id, prog({ [`w:日${d}:ひ|meaning`]: card(clock.t) }));
        clock.t += DAY;
      }
      const labels = (await a.listSnapshots(u.id)).map((s) => s.label);
      assert.equal(labels.length, 40);
      assert.equal(labels[0], '2027-01-10');
      assert.equal(labels[39], '2026-12-02');
      await store.close();
    });

    it('restores a snapshot as a new generation, keeping what it replaces', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('restore', 'password123');
      await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
      clock.t += DAY;
      await a.syncProgress(u.id, prog({ 'い|read': card(clock.t) }));
      const snap = await a.getSnapshot(u.id, '2026-11-28'); // the start of that day: just あ
      clock.t += 60e3;
      const restored = await a.replaceProgress(u.id, snap);
      assert.equal(restored.gen, clock.t);
      assert.deepEqual(Object.keys((await a.getProgress(u.id)).cards), ['あ|read']);
      const labels = (await a.listSnapshots(u.id)).map((s) => s.label);
      assert.equal(labels[0], '2026-11-28T09:01:00Z before reset/import');
      await store.close();
    });

    it('deletes an account with everything in it, so the name starts fresh', async () => {
      const { a, store, clock } = setup(b);
      const u = await a.createUser('Leaver', 'password123');
      const token = await a.newSession(u.id);
      await a.syncProgress(u.id, prog(many(20000, clock.t))); // big enough to be split up
      clock.t += DAY;
      await a.syncProgress(u.id, prog({ 'あ|read': card(clock.t) }));
      assert.equal((await a.listSnapshots(u.id)).length, 1);
      await a.deleteUser(u.id);
      assert.equal(await a.userByName('leaver'), null);
      assert.equal(await a.sessionUser(token), null);
      assert.equal(await a.getProgress(u.id), null);
      assert.deepEqual(await a.listSnapshots(u.id), []);
      const again = await a.createUser('leaver', 'password123');
      assert.equal(await a.getProgress(again.id), null);
      assert.deepEqual(await a.listSnapshots(again.id), []);
      assert.equal(await a.sessionUser(token), null);
      assert.deepEqual((await a.listUsers()).map((x) => x.username), ['leaver']);
      await store.close();
    });

    it('lists accounts with their progress', async () => {
      const { a, store, clock } = setup(b);
      const one = await a.createUser('one', 'password123');
      clock.t += 1000;
      await a.createUser('two', 'password123');
      await a.syncProgress(one.id, prog({ 'あ|read': card(clock.t) }));
      const rows = await a.listUsers();
      assert.deepEqual(rows.map((r) => r.username), ['one', 'two']);
      assert.equal(rows[0].updated, clock.t);
      assert.deepEqual(Object.keys(rows[0].progress.cards), ['あ|read']);
      assert.equal(rows[1].progress, null);
      assert.equal(rows[1].updated, null);
      await store.close();
    });
  });
}
