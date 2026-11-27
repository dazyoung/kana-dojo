// Anonymous usage counts: totals like "12 hiragana answers, 3 kanji learned", whether or not anyone is
// signed in, so the site's owner can see how it's used (node server/admin.js metrics).
//
// Nothing is stored on the device for this and nothing identifies anyone: counts are kept in memory and
// sent to this site's own server about once a minute (and when the app is hidden or closed). Settings →
// "Share anonymous usage counts" turns it off; it starts off if the browser asks not to be tracked.
(function () {
  const S = window.SRS, Y = window.Sync;
  const SCRIPTS = ['hiragana', 'katakana', 'kanji', 'vocab'];
  const EVERY = 60e3;
  const canSend = location.protocol === 'http:' || location.protocol === 'https:';
  let counts = {};
  let timer = null;

  const on = () => canSend && S.settings.shareUsage !== false;
  const script = (s) => (SCRIPTS.includes(s) ? s : (SCRIPTS.includes(S.settings.script) ? S.settings.script : 'hiragana'));

  function send() {
    clearTimeout(timer);
    timer = null;
    const body = counts;
    counts = {};
    if (!on() || !Object.keys(body).length) return;
    fetch('api/metrics', {
      method: 'POST', keepalive: true, cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ v: 1, signedIn: !!(Y && Y.signedIn), counts: body }),
    }).catch(() => {}); // best effort: a lost minute of counts doesn't matter
  }

  function count(name, n = 1) {
    if (!on()) return;
    counts[name] = (counts[name] || 0) + n;
    if (!timer) timer = setTimeout(send, EVERY);
  }

  if (canSend) {
    document.addEventListener('visibilitychange', () => { if (document.hidden) send(); });
    window.addEventListener('pagehide', send);
  }

  window.Usage = {
    visit: () => count('visits'),
    // An answer in a review, lesson quiz or practice; `written` for writing cards.
    answer(unitScript, correct, written) {
      const s = script(unitScript);
      count(`answers_${s}`);
      if (correct) count(`correct_${s}`);
      if (written) count(`written_${s}`);
    },
    learned: (unitScript, n = 1) => count(`learned_${script(unitScript)}`, n),
    drill: (unitScript) => count(`drills_${script(unitScript)}`),
    lesson: () => count('lessons'),
    workout: () => count('workouts'),
    flush: send,
  };
})();
