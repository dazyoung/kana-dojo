// Progress storage + spaced-repetition scheduling (Leitner-style levels).
//
// Stored in this browser (localStorage):
//   kana-dojo-progress  cards + answer log, in the format described in merge.js (this is what syncs)
//   kana-dojo-settings  settings for this device (not synced: e.g. typing on a Mac, tapping on an iPad)
//   kana-dojo-device    a random id for this browser, so answer counts from several devices add up
//   kana-dojo-v1        progress saved by the first version of the app. Copied into the keys above
//                       on first run and otherwise never changed, so it stays as a backup.
(function () {
  const M = window.KanaMerge;
  const OLD_KEY = 'kana-dojo-v1', PROG_KEY = 'kana-dojo-progress', SET_KEY = 'kana-dojo-settings', DEV_KEY = 'kana-dojo-device';
  const M_ = 60e3, H = 3600e3, D = 24 * H;
  // Wait before the next review after reaching each level (level 0 = not learned yet).
  // Several short steps on the first day, then days, weeks and months.
  const INTERVALS = [0,
    15 * M_, 1 * H, 4 * H, 8 * H, //  1–4  Seen: same day
    1 * D, 2 * D, 4 * D, //           5–7  Learning: days
    7 * D, 14 * D, //                 8–9  Familiar: weeks
    30 * D, 60 * D, 120 * D, //       10–12 Mastered: months
  ];
  const MAX = INTERVALS.length - 1;
  // Stages group the levels; the chart colours and stats use them.
  const STAGES = [
    { name: 'New', from: 0, to: 0 },
    { name: 'Seen', from: 1, to: 4 },
    { name: 'Learning', from: 5, to: 7 },
    { name: 'Familiar', from: 8, to: 9 },
    { name: 'Mastered', from: 10, to: MAX },
  ];
  const stageOf = (level) => STAGES.findIndex((st) => level >= st.from && level <= st.to);
  const MISS_WAIT = 1 * H; // after a miss, the card comes back within the hour
  const DEFAULTS = {
    script: 'hiragana', sound: true, writeReviews: true, leniency: 'normal', varyFont: false, chartRomaji: true,
  };
  const SETTING_KEYS = [...Object.keys(DEFAULTS), 'answerMode'];

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const pickSettings = (s) => Object.fromEntries(SETTING_KEYS.filter((k) => s && s[k] !== undefined).map((k) => [k, s[k]]));

  let device = localStorage.getItem(DEV_KEY);
  if (!M.DEVICE.test(device || '')) {
    device = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join('');
    localStorage.setItem(DEV_KEY, device);
  }

  // Progress from the old format (if any) is merged in on every start. The old record itself is
  // never changed. Merging it again is harmless (newer changes win, and once progress has been
  // reset or replaced it's ignored), and it catches answers given in a tab still running the old version.
  const old = read(OLD_KEY);
  const storedProg = read(PROG_KEY);
  let prog = M.clean(storedProg, device);
  if (old && old.cards) {
    const merged = M.merge(prog, M.clean(old, device));
    if (!storedProg || !M.same(merged, prog)) { prog = merged; write(PROG_KEY, prog); }
  }
  let settings = { ...DEFAULTS, ...pickSettings(read(SET_KEY) || (old && old.settings)) };
  if (!localStorage.getItem(SET_KEY)) write(SET_KEY, settings);

  const save = () => { write(PROG_KEY, prog); if (SRS.onChange) SRS.onChange(); };
  const today = (t = Date.now()) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const dayTotal = (day) => Object.values(prog.log[day] || {}).reduce((n, e) => n + e.n, 0);
  const key = (unit, skill) => unit + '|' + skill;
  const fuzz = () => 0.9 + Math.random() * 0.2;

  const SRS = {
    INTERVALS, MAX, STAGES, stageOf,
    device,
    onChange: null, // set by sync.js: called after every progress change
    get settings() { return settings; },
    set(k, v) { settings[k] = v; write(SET_KEY, settings); },
    key,
    card: (unit, skill) => prog.cards[key(unit, skill)] || null,
    level: (unit, skill) => (prog.cards[key(unit, skill)] || {}).level || 0,
    isLearned: (unit) => !!prog.cards[key(unit, 'read')],

    learn(unit, skills) {
      const now = Date.now();
      let changed = false;
      for (const s of skills) {
        const k = key(unit, s);
        if (!prog.cards[k]) { prog.cards[k] = { level: 1, due: now + INTERVALS[1], ok: 0, bad: 0, last: now, t: now, at: now }; changed = true; }
      }
      if (changed) save();
    },

    // Record a scheduled review answer.
    grade(unit, skill, correct) {
      const c = prog.cards[key(unit, skill)];
      if (!c) return;
      const now = Date.now();
      if (correct) {
        c.level = Math.min(MAX, c.level + 1);
        c.due = now + INTERVALS[c.level] * fuzz();
        c.ok++;
      } else {
        // Drop further the higher it was: 1 level while Seen, 2 while Learning/Familiar, 3 when Mastered.
        c.level = Math.max(1, c.level - (c.level <= 4 ? 1 : c.level <= 9 ? 2 : 3));
        c.due = now + Math.min(INTERVALS[c.level], MISS_WAIT);
        c.bad++;
      }
      c.last = c.t = now;
      this.logAnswer(correct);
      save();
    },

    // Extra practice: counts toward stats, doesn't move the schedule (except pulling misses forward).
    practice(unit, skill, correct) {
      const c = prog.cards[key(unit, skill)];
      if (c) {
        correct ? c.ok++ : c.bad++;
        if (!correct) c.due = Math.min(c.due, Date.now() + INTERVALS[1]);
        c.t = Date.now();
      }
      this.logAnswer(correct);
      save();
    },

    logAnswer(correct) {
      const day = (prog.log[today()] ||= {});
      const e = (day[device] ||= { n: 0, ok: 0 });
      e.n++;
      if (correct) e.ok++;
    },

    // Cards due now (optionally limited to a script / skills).
    due(filter = () => true) {
      const now = Date.now();
      const out = [];
      for (const [k, c] of Object.entries(prog.cards)) {
        const [unit, skill] = k.split('|');
        if (c.due <= now && filter(unit, skill)) out.push({ unit, skill, card: c });
      }
      return out;
    },
    nextDue(filter = () => true) {
      let t = Infinity;
      for (const [k, c] of Object.entries(prog.cards)) {
        const [unit, skill] = k.split('|');
        if (filter(unit, skill)) t = Math.min(t, c.due);
      }
      return t;
    },
    all(filter = () => true) {
      return Object.entries(prog.cards)
        .map(([k, c]) => { const [unit, skill] = k.split('|'); return { unit, skill, card: c }; })
        .filter((x) => filter(x.unit, x.skill));
    },

    todayCount: () => dayTotal(today()),
    today,
    // Answers per day, all devices added up: { "2026-11-24": { n, ok } }.
    days() {
      const out = {};
      for (const [day, devs] of Object.entries(prog.log)) {
        const e = (out[day] = { n: 0, ok: 0 });
        for (const d of Object.values(devs)) { e.n += d.n; e.ok += d.ok; }
      }
      return out;
    },
    bestStreak() {
      const days = Object.keys(prog.log).filter((d) => dayTotal(d)).sort();
      let best = 0, run = 0, prev = null;
      for (const d of days) {
        const t = new Date(d + 'T12:00:00').getTime();
        run = prev !== null && Math.round((t - prev) / D) === 1 ? run + 1 : 1;
        best = Math.max(best, run);
        prev = t;
      }
      return best;
    },
    streak() {
      let n = 0;
      let t = Date.now();
      if (!dayTotal(today(t))) t -= D; // today not done yet: streak still alive from yesterday
      while (dayTotal(today(t))) { n++; t -= D; }
      return n;
    },
    stats: () => M.stats(prog),

    exportJSON: () => JSON.stringify({ app: 'kana-dojo', version: 2, exported: new Date().toISOString(), ...prog, settings }, null, 1),
    // Importing replaces progress (on every synced device too: it starts a new generation).
    importJSON(text) {
      const raw = JSON.parse(text);
      if (!raw || !raw.cards) throw new Error('Not a Kana Dojo progress file');
      prog = { ...M.clean(raw, device), gen: Date.now() };
      if (raw.settings) { settings = { ...settings, ...pickSettings(raw.settings) }; write(SET_KEY, settings); }
      save();
    },
    reset() { prog = M.empty(Date.now()); save(); },

    // For sync.js.
    progress: () => M.copy(prog),
    replaceProgress(p) { prog = M.clean(p, device); write(PROG_KEY, prog); },
  };

  window.SRS = SRS;
})();
