// Progress format + merging. Shared by the browser (window.KanaMerge) and the server (require).
//
// Progress (format 3):
//   { v: 3, gen, cards: { "あ|read": { level, due, ok, bad, last, t, at } }, log: { "2026-11-24": { <device>: { n, ok } } } }
//
// - cards: one per character+skill. `level` is 1–12 (see INTERVALS in srs.js), `at` is when it was
//   learned (0 if learned before that was recorded), `t` is when the card last changed; when two
//   devices both changed a card, the newer change wins.
// - log: answers per day, counted separately per device so totals from several devices add up
//   correctly no matter how often they sync (each device's count only ever grows).
// - gen: bumped (set to the current time) by "Reset" and "Import". Progress from an older
//   generation is replaced, not merged, so a reset doesn't get undone by another device.
//
// Older formats are converted when cleaned: format 1 (one answer count per day) and formats 1–2,
// whose levels were 1–8 on a slower timeline (4h, 1d, 2d, 4d, 8d, 16d, 35d, 90d). Each old level
// moves to the new level with the nearest wait.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.KanaMerge = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CARD_KEY = /^[^|\s]{1,24}\|[a-z]{1,16}$/;
  const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
  const DEVICE = /^[a-z0-9]{3,32}$/;
  const LIMITS = { cards: 50000, days: 20000, devicesPerDay: 50 };
  const FORMAT = 3;
  const OLD_LEVELS = [0, 3, 5, 6, 7, 8, 9, 10, 11]; // format 1–2 level → format 3 level

  const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
  const num = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
  const int = (x, lo, hi) => Math.min(hi, Math.max(lo, Math.round(num(x))));

  const empty = (gen = 0) => ({ v: FORMAT, gen, cards: {}, log: {} });

  function cleanCard(c, oldLevels) {
    if (!isObj(c)) return null;
    const last = num(c.last);
    let level = int(c.level, 0, 99);
    if (oldLevels) level = OLD_LEVELS[Math.min(level, OLD_LEVELS.length - 1)];
    return {
      level, due: num(c.due), ok: int(c.ok, 0, 1e9), bad: int(c.bad, 0, 1e9),
      last, t: num(c.t, last), at: num(c.at),
    };
  }

  // Validate and normalise. Also accepts the old v1 format (a log entry per day: { n, ok }),
  // crediting those day totals to `device`. Unknown or malformed entries are dropped.
  function clean(p, device = 'old') {
    const out = empty(isObj(p) ? num(p.gen) : 0);
    if (!isObj(p)) return out;
    const oldLevels = num(p.v, 1) < FORMAT;
    if (isObj(p.cards)) {
      let n = 0;
      for (const k of Object.keys(p.cards)) {
        if (n >= LIMITS.cards) break;
        if (!CARD_KEY.test(k)) continue;
        const c = cleanCard(p.cards[k], oldLevels);
        if (c) { out.cards[k] = c; n++; }
      }
    }
    if (isObj(p.log)) {
      let n = 0;
      for (const day of Object.keys(p.log)) {
        if (n >= LIMITS.days) break;
        const e = p.log[day];
        if (!DAY_KEY.test(day) || !isObj(e)) continue;
        const devs = {};
        if (typeof e.n === 'number') {
          devs[DEVICE.test(device) ? device : 'old'] = { n: int(e.n, 0, 1e9), ok: int(e.ok, 0, 1e9) };
        } else {
          let m = 0;
          for (const d of Object.keys(e)) {
            if (m >= LIMITS.devicesPerDay) break;
            if (!DEVICE.test(d) || !isObj(e[d])) continue;
            devs[d] = { n: int(e[d].n, 0, 1e9), ok: int(e[d].ok, 0, 1e9) };
            m++;
          }
        }
        if (Object.keys(devs).length) { out.log[day] = devs; n++; }
      }
    }
    return out;
  }

  // Which of two versions of the same card to keep. Deterministic, so every device and the
  // server end up with the same answer whichever order they merge in.
  function pickCard(a, b) {
    if (a.t !== b.t) return a.t > b.t ? a : b;
    if (a.ok + a.bad !== b.ok + b.bad) return a.ok + a.bad > b.ok + b.bad ? a : b;
    if (a.level !== b.level) return a.level > b.level ? a : b;
    return a.due >= b.due ? a : b;
  }

  // Merge two cleaned progress objects. Returns a new object (inputs aren't modified).
  function merge(a, b) {
    if (a.gen !== b.gen) return copy(a.gen > b.gen ? a : b);
    const out = empty(a.gen);
    for (const [k, c] of Object.entries(a.cards)) out.cards[k] = c;
    for (const [k, c] of Object.entries(b.cards)) out.cards[k] = out.cards[k] ? pickCard(out.cards[k], c) : c;
    for (const src of [a.log, b.log]) {
      for (const [day, devs] of Object.entries(src)) {
        const o = out.log[day] || (out.log[day] = {});
        for (const [d, e] of Object.entries(devs)) {
          const cur = o[d];
          if (!cur || e.n > cur.n || (e.n === cur.n && e.ok > cur.ok)) o[d] = e;
        }
      }
    }
    return copy(out);
  }

  // True if two cleaned progress objects hold the same data.
  function same(a, b) {
    if (a.gen !== b.gen) return false;
    const ka = Object.keys(a.cards), kb = Object.keys(b.cards);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      const x = a.cards[k], y = b.cards[k];
      if (!y || x.t !== y.t || x.level !== y.level || x.due !== y.due || x.ok !== y.ok || x.bad !== y.bad || x.at !== y.at) return false;
    }
    const da = Object.keys(a.log), db = Object.keys(b.log);
    if (da.length !== db.length) return false;
    for (const day of da) {
      const x = a.log[day], y = b.log[day];
      if (!y || Object.keys(x).length !== Object.keys(y).length) return false;
      for (const d of Object.keys(x)) if (!y[d] || x[d].n !== y[d].n || x[d].ok !== y[d].ok) return false;
    }
    return true;
  }

  const copy = (p) => JSON.parse(JSON.stringify(p));
  const stats = (p) => ({
    cards: Object.keys(p.cards).length,
    answers: Object.values(p.log).reduce((s, devs) => s + Object.values(devs).reduce((t, e) => t + e.n, 0), 0),
  });

  return { empty, clean, merge, same, copy, stats, DEVICE, FORMAT };
});
