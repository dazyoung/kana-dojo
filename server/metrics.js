// Usage metrics: daily totals (visits, answers, sign-ups…) gathered in memory and added to the store
// about once a minute, so busy minutes cost one write rather than one per request.
//
// Unique visitors and active accounts are counted with one-way codes: sha256 of a random secret kept in the
// store, the day, and the visitor's address + browser (or the account id), cut to 16 characters. The code
// changes every day, so nobody can be followed across days, and a day's codes are deleted after two days;
// only the totals stay. Counts are best effort: a crash loses at most the last minute.
'use strict';
const crypto = require('node:crypto');

const FLUSH_EVERY = 60e3;
const KEEP_SEEN_DAYS = 2;

function metrics(store, opts = {}) {
  const now = opts.now || Date.now;
  const today = () => new Date(now()).toISOString().slice(0, 10);
  const fresh = () => ({ day: today(), counters: {}, seen: { visitors: new Set(), accounts: new Set() } });
  let buf = fresh();
  let lastFlush = now();
  let forgotOn = null;
  let flushing = Promise.resolve();
  let secret = null;
  const ready = store.secret('metrics').then((s) => { secret = s; }).catch((e) => {
    console.error(new Date().toISOString(), 'metrics: no secret:', e.message);
  });

  const code = (day, what) => crypto.createHash('sha256').update(`${secret}|${day}|${what}`).digest('base64url').slice(0, 16);

  // A new day starts a new set of totals; the old day's are written straight away.
  function roll() {
    if (buf.day === today()) return;
    write(buf);
    buf = fresh();
  }

  function write(b) {
    const counters = b.counters;
    const seen = { visitors: [...b.seen.visitors], accounts: [...b.seen.accounts] };
    if (!Object.keys(counters).length && !seen.visitors.length && !seen.accounts.length) return flushing;
    const day = b.day;
    flushing = flushing.then(async () => {
      try {
        await store.addMetrics(day, counters, seen);
        if (forgotOn !== today()) {
          forgotOn = today();
          const cutoff = new Date(Date.parse(today() + 'T00:00:00Z') - (KEEP_SEEN_DAYS - 1) * 864e5).toISOString().slice(0, 10);
          await store.forgetSeen(cutoff);
        }
      } catch (e) {
        console.error(new Date().toISOString(), 'metrics: not saved:', e.message);
      }
    });
    return flushing;
  }

  function maybeFlush() {
    if (now() - lastFlush < FLUSH_EVERY) return;
    lastFlush = now();
    const b = buf;
    buf = fresh();
    write(b);
  }

  return {
    // Add to today's totals, e.g. add({ logins: 1 }).
    add(counters) {
      roll();
      for (const [k, n] of Object.entries(counters)) buf.counters[k] = (buf.counters[k] || 0) + n;
      maybeFlush();
    },
    // Count a visitor (address + browser) or an account once per day.
    async seen(kind, what) {
      await ready;
      if (!secret) return;
      roll();
      buf.seen[kind].add(code(buf.day, what));
      maybeFlush();
    },
    // Write whatever is waiting (e.g. before the server stops).
    flush() {
      lastFlush = now();
      const b = buf;
      buf = fresh();
      return write(b);
    },
  };
}

module.exports = { metrics };
