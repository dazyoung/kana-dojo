// Kana Dojo — screens and flow.
(function () {
  const K = window.KANA, S = window.SRS, R = window.Romaji;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const app = $('#app');
  const modalRoot = $('#modal');

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const uniq = (a) => [...new Set(a)];

  const info = (u) => K.info[u];
  const scriptOf = (u) => (K.info[u] || {}).script;
  const romaji = (u) => K.info[u].romaji[0];
  const writeOn = () => S.settings.writeReviews;
  const skillsFor = (u) => (info(u).write && writeOn() ? ['read', 'write'] : ['read']);
  const reviewFilter = (u, skill) => !!K.info[u] && (skill === 'read' || writeOn());
  const groupLearned = (g) => g.kana.every(S.isLearned);
  const groupOf = (u) => K.groups.find((g) => g.kana.includes(u));
  const SCRIPT_JA = { hiragana: 'ひらがな', katakana: 'カタカナ' };
  const hasStrokes = (u) => !!(window.STROKES && window.STROKES[u]);

  if (!S.settings.answerMode) {
    S.set('answerMode', matchMedia('(hover: hover) and (pointer: fine)').matches ? 'type' : 'choose');
  }

  // ---------- speech ----------
  let voice = null;
  const canSpeak = 'speechSynthesis' in window;
  function pickVoice() {
    const vs = speechSynthesis.getVoices();
    voice = vs.find((v) => /^ja/i.test(v.lang) && /kyoko|otoya|o-ren|hattori/i.test(v.name)) ||
      vs.find((v) => /^ja/i.test(v.lang)) || null;
  }
  if (canSpeak) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, force) {
    if (!canSpeak || (!S.settings.sound && !force)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ja-JP';
    if (voice) u.voice = voice;
    u.rate = 0.8;
    speechSynthesis.speak(u);
  }

  // ---------- fonts ----------
  const FONTS = [
    "'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif",
    "'Hiragino Maru Gothic ProN','Hiragino Sans',sans-serif",
    "'Klee','Klee One','Hiragino Sans',sans-serif",
    "'Hiragino Sans','Hiragino Kaku Gothic ProN',sans-serif",
  ];
  const fontAttr = () => (S.settings.varyFont ? `style="font-family:${pick(FONTS)}"` : '');

  // ---------- multiple-choice distractors ----------
  const CONFUSE = [
    'あおめぬ', 'ねれわ', 'さちきら', 'るろ', 'はほけ', 'いりこ', 'うつら', 'しつくへ', 'まもほよ', 'なたに', 'そてる',
    'ぬめのね', 'すおむ', 'んそ', 'かやが', 'ゆよ', 'ふみ', 'ひい', 'えこ', 'わね',
    'シツソンノ', 'クケタワウフヌス', 'チテナ', 'コユヨロ', 'マアム', 'ヒセ', 'エユ', 'ラヲヨフ', 'メナヌ', 'キモチ',
    'ルレ', 'トイ', 'カヤ', 'ミシ', 'オホ', 'ハル', 'リソ', 'ネホ',
  ];
  function lookalikes(u) {
    const s = new Set();
    for (const g of CONFUSE) if (g.includes(u)) for (const c of g) if (c !== u) s.add(c);
    if (u.length === 1) {
      const base = u.normalize('NFD')[0];
      [base, base + '゙', base + '゚'].forEach((c) => { c = c.normalize('NFC'); if (c.length === 1 && c !== u) s.add(c); });
    } else {
      const smalls = scriptOf(u) === 'hiragana' ? 'ゃゅょ' : 'ャュョ';
      for (const sm of smalls) s.add(u[0] + sm);
      Object.keys(K.info).filter((c) => c.length === 2 && c[1] === u[1]).forEach((c) => s.add(c));
    }
    s.delete(u);
    return [...s].filter((c) => K.info[c]);
  }
  function choicesFor(u) {
    const sc = scriptOf(u);
    const out = [romaji(u)];
    const seen = new Set(out);
    const add = (c) => {
      if (out.length >= 4 || !K.info[c] || scriptOf(c) !== sc) return;
      const r = romaji(c);
      if (!seen.has(r)) { seen.add(r); out.push(r); }
    };
    const look = shuffle(lookalikes(u));
    look.filter(S.isLearned).forEach(add);
    const same = Object.keys(K.info).filter((c) => c.length === u.length && scriptOf(c) === sc);
    shuffle(same.filter(S.isLearned)).forEach(add);
    look.forEach(add);
    shuffle(same).forEach(add);
    return shuffle(out);
  }

  // ---------- words ----------
  const wordScript = (w) => (/[ァ-ヺ]/.test(w) ? 'katakana' : 'hiragana');
  function wordKnown(w) {
    return R.units(w).every((u) => {
      if (u === 'ー') return true;
      if (u === 'っ') return S.isLearned('つ');
      if (u === 'ッ') return S.isLearned('ツ');
      return S.isLearned(u);
    });
  }
  const availableWords = (sc) => K.words.filter(([w]) => wordScript(w) === sc && wordKnown(w));

  // ---------- time formatting ----------
  function fmtWait(ms) {
    if (ms <= 0) return 'now';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    if (h < 36) return `${h} h`;
    return `${Math.round(h / 24)} days`;
  }
  const fmtAgo = (ms) => (ms < 45e3 ? 'just now' : `${fmtWait(ms)} ago`);

  // =====================================================================
  // Home
  // =====================================================================
  let sess = null;    // active quiz/review session
  let lesson = null;  // active lesson walkthrough
  let detailWriter = null;

  // Chart colour = stage (Seen, Learning, Familiar, Mastered) of the weaker of the character's cards.
  function tierOf(u) {
    if (!S.isLearned(u)) return 0;
    const lv = info(u).write && writeOn() ? Math.min(S.level(u, 'read'), S.level(u, 'write') || 1) : S.level(u, 'read');
    return Math.max(1, S.stageOf(lv));
  }

  function chartHTML(sc) {
    return K.chart[sc].map((sec) => {
      const cells = sec.rows.map((row) => row.map((u) => (u
        ? `<button class="cell t${tierOf(u)}" data-act="detail" data-u="${u}"><span class="k">${u}</span>${S.settings.chartRomaji ? `<span class="r">${romaji(u)}</span>` : ''}</button>`
        : '<span class="cell empty"></span>')).join('')).join('');
      return `<section class="chart-sec"><h3>${sec.label}</h3><div class="grid ${sec.cols === 3 ? 'combo' : ''}">${cells}</div></section>`;
    }).join('');
  }

  const reviewText = (due, nextDue) => (due
    ? `<b>${due}</b> due now`
    : nextDue < Infinity ? `All caught up · next in ${fmtWait(nextDue - Date.now())}` : 'Learn a lesson to start');

  // Keep the Review button current while the home screen is open: with the short first-day steps,
  // cards come due every few minutes.
  let homeSig = '';
  setInterval(() => {
    if (sess || lesson || document.hidden || !modalRoot.hidden || !$('.home')) return;
    if (reviewText(S.due(reviewFilter).length, S.nextDue(reviewFilter)) !== homeSig) renderHome();
  }, 20e3);

  function renderHome() {
    sess = null;
    lesson = null;
    const sc = S.settings.script;
    const due = S.due(reviewFilter).length;
    const nextDue = S.nextDue(reviewFilter);
    const groups = K.groups.filter((g) => g.script === sc);
    const nextGroup = groups.find((g) => !groupLearned(g));
    const units = Object.keys(K.info).filter((u) => scriptOf(u) === sc);
    const learned = units.filter(S.isLearned).length;
    const nWords = availableWords(sc).length;
    const anyLearned = learned > 0;
    const streak = S.streak();

    const reviewSub = reviewText(due, nextDue);
    homeSig = reviewSub;

    app.innerHTML = `
    <div class="home">
      <header class="top">
        <div class="brand"><span class="logo">かな</span><span>Kana Dojo</span></div>
        <div class="top-right">
          <span class="sync-slot">${syncPillHTML()}</span>
          ${streak ? `<button class="pill btn-pill" data-act="stats" title="Days in a row · open stats">${streak}-day streak</button>` : ''}
          <button class="pill btn-pill muted" data-act="stats" title="Answers today · open stats">${S.todayCount()} today</button>
          <button class="icon" data-act="settings" aria-label="Settings">⚙︎</button>
        </div>
      </header>

      <div class="seg" role="tablist">
        ${['hiragana', 'katakana'].map((s) => `<button role="tab" data-act="script" data-s="${s}" class="${s === sc ? 'on' : ''}">
          <span class="kana">${SCRIPT_JA[s]}</span> <span>${s[0].toUpperCase() + s.slice(1)}</span></button>`).join('')}
      </div>

      <section class="actions">
        <button class="action primary" data-act="review" ${due ? '' : 'disabled'}>
          <span class="a-title">Review</span><span class="a-sub">${reviewSub}</span>
        </button>
        ${nextGroup ? `
        <button class="action" data-act="learn-group" data-g="${nextGroup.id}">
          <span class="a-title">Learn next · <span class="muted">${nextGroup.label}</span></span>
          <span class="a-kana kana">${nextGroup.kana.slice(0, 9).join(' ')}${nextGroup.kana.length > 9 ? ' …' : ''}</span>
        </button>` : `
        <div class="action done"><span class="a-title">All ${sc} lessons learned</span>
          <span class="a-sub">${sc === 'hiragana' ? 'Time for katakana!' : 'Keep up the reviews.'}</span></div>`}
        <div class="action practice">
          <span class="a-title">Extra practice</span>
          <div class="a-row">
            <button class="btn" data-act="practice" data-skill="read" ${anyLearned ? '' : 'disabled'}>Read</button>
            <button class="btn" data-act="practice" data-skill="write" ${anyLearned && writeOn() ? '' : 'disabled'}>Write</button>
            <button class="btn" data-act="words" ${nWords ? '' : 'disabled'}>Words <small>${nWords}</small></button>
          </div>
        </div>
      </section>

      <div class="chart-head">
        <h2>${SCRIPT_JA[sc]} <span class="muted">${learned} / ${units.length} learned</span></h2>
        <div class="chart-btns">
          <button class="btn ghost" data-act="stats">Stats</button>
          <button class="btn ghost" data-act="lessons">All lessons</button>
        </div>
      </div>
      <div class="legend">
        <span><i class="t0"></i>New</span><span><i class="t1"></i>Seen</span><span><i class="t2"></i>Learning</span>
        <span><i class="t3"></i>Familiar</span><span><i class="t4"></i>Mastered</span>
      </div>
      <div class="chart">${chartHTML(sc)}</div>
      <footer class="foot">Tap any character for stroke order and writing practice.</footer>
    </div>`;
  }

  // =====================================================================
  // Sessions (review / practice / lesson quiz / words)
  // =====================================================================
  function startSession(opts) {
    if (!opts.items.length) return;
    sess = { ...opts, queue: shuffle(opts.items.map((x) => ({ ...x }))), total: opts.items.length, done: 0, firstOk: 0, missed: [] };
    // avoid read+write of the same character back to back
    for (let i = 1; i < sess.queue.length; i++) {
      if (sess.queue[i].unit && sess.queue[i].unit === sess.queue[i - 1].unit) {
        const j = (i + 2 + Math.floor(Math.random() * 3)) % sess.queue.length;
        [sess.queue[i], sess.queue[j]] = [sess.queue[j], sess.queue[i]];
      }
    }
    app.innerHTML = `
    <div class="session">
      <div class="s-top">
        <button class="icon" data-act="exit" aria-label="Exit">✕</button>
        <div class="bar"><i></i></div>
        <span class="count"></span>
      </div>
      <div class="s-body">
        <div class="slot-top"></div>
        <form class="s-answer" hidden>
          <input id="ans" type="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"
                 enterkeyhint="go" placeholder="type romaji…" aria-label="Answer in romaji">
        </form>
        <div class="slot-bottom"></div>
      </div>
    </div>`;
    const form = $('.s-answer');
    const input = $('#ans');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!sess) return;
      if (sess.pending) return cont();
      if (input.value.trim()) resolve(checkTyped(sess.cur, input.value));
    });
    input.addEventListener('input', () => {
      if (sess && !sess.pending && checkTyped(sess.cur, input.value)) resolve(true);
    });
    nextCard();
  }

  const checkTyped = (it, v) => (it.type === 'word' ? R.checkWord(it.word, v) : R.checkUnit(it.unit, v));

  function updateProgress() {
    $('.s-top .bar i').style.width = `${(100 * sess.done) / sess.total}%`;
    $('.s-top .count').textContent = `${sess.done} / ${sess.total}`;
  }

  function nextCard() {
    if (sess.writer) { sess.writer.destroy(); sess.writer = null; }
    clearTimeout(sess.autoTimer);
    updateProgress();
    if (!sess.queue.length) return endSession();
    sess.cur = sess.queue.shift();
    sess.pending = null;
    renderCard();
  }

  function showInput(on) {
    const form = $('.s-answer');
    const input = $('#ans');
    form.hidden = !on;
    form.classList.remove('ok', 'bad');
    input.value = '';
    if (on) input.focus({ preventScroll: true });
    else if (document.activeElement === input) input.blur();
  }

  function renderCard() {
    const it = sess.cur;
    const top = $('.slot-top');
    const bot = $('.slot-bottom');
    bot.innerHTML = '<div class="fb" aria-live="polite"></div><div class="ctl"></div>';

    if (it.type === 'read') {
      const typed = S.settings.answerMode === 'type';
      top.innerHTML = `
        <div class="tag">${it.unit.length > 1 ? 'combo' : scriptOf(it.unit)} · read</div>
        <div class="big kana" ${fontAttr()}>${it.unit}</div>
        ${typed ? '' : `<div class="choices">${choicesFor(it.unit).map((r, i) =>
          `<button class="choice" data-act="choose" data-val="${r}"><kbd>${i + 1}</kbd>${r}</button>`).join('')}</div>`}`;
      showInput(typed);
    } else if (it.type === 'word') {
      top.innerHTML = `<div class="tag">word · read</div><div class="big kana word" ${fontAttr()}>${it.word}</div>`;
      showInput(true);
    } else {
      const i = info(it.unit);
      const selfCheck = S.settings.leniency === 'off';
      top.innerHTML = `
        <div class="write-prompt">
          <span class="tag">${i.script} · write</span>
          <div class="romaji-big">${romaji(it.unit)}</div>
          ${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}
        </div>
        <div class="pad"></div>`;
      showInput(false);
      $('.ctl').innerHTML = selfCheck
        ? '<button class="btn ghost" data-act="w-clear">Clear</button><button class="btn primary" data-act="w-check">Check</button>'
        : '<button class="btn ghost" data-act="hint">Hint <kbd>H</kbd></button><button class="btn ghost" data-act="reveal">Show answer</button>';
      sess.writer = new Writer($('.pad', top), {
        leniency: () => S.settings.leniency,
        onStroke: strokeFeedback,
        onHint: (h) => { if (h.auto) setFb('warn', 'Here’s how that stroke goes — follow the red line'); },
        onComplete: writeDone,
      });
      sess.writer.load(it.unit, { mode: selfCheck ? 'free' : 'recall', guide: false });
    }
  }

  function setFb(cls, html) {
    const fb = $('.fb');
    if (!fb) return;
    fb.className = 'fb ' + (cls || '');
    fb.innerHTML = html || '';
  }

  function strokeFeedback(r) {
    if (r.free) return;
    if (r.ok) { setFb('', r.idx < r.n ? `<span class="muted">stroke ${r.idx} / ${r.n}</span>` : ''); return; }
    const msg = r.kind === 'direction' ? 'Right shape, wrong direction — strokes run top→bottom, left→right'
      : r.kind === 'order' ? `That’s stroke ${r.other + 1} — stroke ${r.idx + 1} comes first`
        : 'Not quite — try that stroke again';
    setFb('warn', msg);
  }

  function writeDone(s) {
    const ok = s.hints === 0 && s.misses <= 1;
    resolve(ok, { write: s });
  }

  // Show result for the current card; recording happens on continue (so "I was right" can override).
  function resolve(correct, extra = {}) {
    if (!sess || sess.pending) return;
    const it = sess.cur;
    sess.pending = { correct };
    const ctl = $('.ctl');
    const form = $('.s-answer');
    form.classList.add(correct ? 'ok' : 'bad');
    speak(it.word || it.unit);

    // highlight choices
    $$('.choice').forEach((b) => {
      b.disabled = true;
      if (b.dataset.val === romaji(it.unit)) b.classList.add('right');
      else if (b.dataset.val === extra.chosen) b.classList.add('wrong');
    });

    if (it.type === 'word') {
      const r = R.kanaToRomaji(it.word);
      setFb(correct ? 'ok' : 'bad', `${correct ? '✓' : '✗'} <b>${r}</b> — ${esc(it.meaning)}`);
    } else if (it.type === 'read') {
      setFb(correct ? 'ok' : 'bad', correct ? `✓ ${romaji(it.unit)}` : `${it.unit} = <b>${info(it.unit).romaji.join(' / ')}</b>`);
    } else if (extra.write) {
      const s = extra.write;
      setFb(correct ? 'ok' : 'bad', correct
        ? `✓ ${s.misses ? 'Good (one slip)' : 'Perfect strokes'}`
        : `✗ ${s.hints ? 'Needed a hint' : `${s.misses} missed strokes`} — watch the stroke order`);
      if (!correct) {
        const w = sess.writer;
        setTimeout(() => { if (sess && sess.writer === w) { w.load(it.unit, { mode: 'view', numbers: true }); w.animate(); } }, 600);
      }
    } else if (extra.revealed) {
      setFb('bad', `Here’s <b>${it.unit}</b> (${romaji(it.unit)}) — study the stroke order`);
    } else if (extra.self) {
      // self-graded write card
    }

    const override = !correct && !extra.revealed && !extra.chosen ?'<button class="btn link" data-act="override">I was right</button>' : '';
    ctl.innerHTML = `<button class="btn primary" data-act="continue">Continue <kbd>↵</kbd></button>${override}`;
    if (correct) {
      const delay = it.type === 'word' ? 1600 : it.type === 'write' ? 900 : 550;
      sess.autoTimer = setTimeout(cont, delay);
    } else if (it.type !== 'word' && document.activeElement && document.activeElement.id !== 'ans') {
      $('[data-act="continue"]').focus({ preventScroll: true });
    }
  }

  function cont() {
    if (!sess || !sess.pending) return;
    clearTimeout(sess.autoTimer);
    const it = sess.cur;
    const { correct } = sess.pending;
    record(it, correct);
    if (correct) sess.done++;
    else sess.queue.splice(Math.min(sess.queue.length, 2 + Math.floor(Math.random() * 3)), 0, it);
    nextCard();
  }

  function record(it, correct) {
    if (it.tried) return;
    it.tried = true;
    if (correct) sess.firstOk++;
    else sess.missed.push(it);
    if (sess.kind === 'review') S.grade(it.unit, it.skill, correct);
    else if (sess.kind === 'practice') S.practice(it.unit, it.skill, correct);
    else S.practice(it.word || it.unit, 'x', correct); // lesson quiz / words: activity log only
  }

  function endSession() {
    const s = sess;
    sess = null;
    if (s.onEnd) s.onEnd(s);
    const missed = uniq(s.missed.map((m) => m.word || m.unit));
    const pct = s.total ? s.firstOk / s.total : 1;
    app.innerHTML = `
    <div class="summary">
      <div class="sum-mark kana">${pct === 1 ? '完璧' : pct >= 0.8 ? 'よし' : 'がんばれ'}</div>
      <h2>${esc(s.title)} done</h2>
      <p class="score"><b>${s.firstOk}</b> / ${s.total} right first time</p>
      ${missed.length ? `<p class="missed">Missed: ${missed.map((m) => `<button class="kana chip" data-act="detail" data-u="${K.info[m] ? m : ''}">${m}</button>`).join('')}</p>` : ''}
      ${s.endNote ? `<p class="muted">${s.endNote}</p>` : ''}
      <div class="btns">
        <button class="btn primary" data-act="home">Done</button>
        ${s.again ? '<button class="btn" data-act="again">Go again</button>' : ''}
      </div>
    </div>`;
    lastAgain = s.again || null;
  }
  let lastAgain = null;

  function exitSession() {
    if (sess && sess.kind === 'quiz' && !confirm('Leave this lesson? It won’t be marked as learned.')) return;
    if (lesson && !sess && lesson.i > 0 && !confirm('Leave this lesson?')) return;
    if (sess && sess.writer) sess.writer.destroy();
    if (lesson && lesson.writer) lesson.writer.destroy();
    renderHome();
  }

  // ---------- session starters ----------
  function startReview() {
    const due = S.due(reviewFilter);
    startSession({
      kind: 'review', title: 'Review',
      items: due.map((d) => ({ type: d.skill, unit: d.unit, skill: d.skill })),
      endNote: 'Misses come back sooner; correct answers wait longer each time.',
    });
  }

  function startPractice(skill) {
    const sc = S.settings.script;
    const pool = S.all((u, sk) => scriptOf(u) === sc && sk === skill)
      .map((x) => ({ ...x, r: x.card.level + Math.random() * 2 }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 20);
    startSession({
      kind: 'practice', title: skill === 'read' ? 'Reading practice' : 'Writing practice',
      items: pool.map((d) => ({ type: d.skill, unit: d.unit, skill: d.skill })),
      endNote: 'Extra practice focuses on your weakest characters and doesn’t change review timing.',
      again: () => startPractice(skill),
    });
  }

  function startWords() {
    const sc = S.settings.script;
    const words = shuffle(availableWords(sc)).slice(0, 10);
    startSession({
      kind: 'words', title: 'Word reading',
      items: words.map(([word, meaning]) => ({ type: 'word', word, meaning })),
      endNote: 'Tip: っ doubles the next consonant (きって = kitte); ー stretches the vowel (コーヒー = koohii).',
      again: startWords,
    });
  }

  // =====================================================================
  // Lessons: meet → trace → from memory, for each character, then a quiz
  // =====================================================================
  function startLesson(g) {
    closeModal(true);
    lesson = { g, i: 0, step: 'meet', writing: writeOn() && g.write };
    renderLesson();
  }

  function lessonNext() {
    const L = lesson;
    const u = L.g.kana[L.i];
    const canWrite = L.writing && hasStrokes(u);
    if (L.step === 'meet' && canWrite) L.step = 'trace';
    else if (L.step === 'trace') L.step = 'recall';
    else { L.i++; L.step = 'meet'; }
    if (L.i >= L.g.kana.length) return startLessonQuiz();
    renderLesson();
  }

  function startLessonQuiz() {
    const g = lesson.g;
    const writing = lesson.writing;
    if (lesson.writer) lesson.writer.destroy();
    lesson = null;
    const items = [];
    g.kana.forEach((u) => {
      items.push({ type: 'read', unit: u, skill: 'read' });
      if (writing && info(u).write) items.push({ type: 'write', unit: u, skill: 'write' });
    });
    startSession({
      kind: 'quiz', title: `${g.label} lesson`, items,
      onEnd: () => g.kana.forEach((u) => S.learn(u, skillsFor(u))),
      endNote: 'These characters are now in your reviews. The first review comes up in about 15 minutes, then a few more today.',
    });
  }

  function renderLesson() {
    const L = lesson;
    const u = L.g.kana[L.i];
    const i = info(u);
    if (L.writer) { L.writer.destroy(); L.writer = null; }
    const dots = L.g.kana.map((k, j) => `<span class="${j < L.i ? 'done' : j === L.i ? 'cur' : ''}">${k}</span>`).join('');
    let body = '';

    if (L.step === 'meet') {
      let extra = '';
      if (u.length === 2) {
        extra = `<p class="explain"><span class="kana">${u[0]}</span> ${romaji(u[0])} + small <span class="kana">${u[1]}</span> → <b>${romaji(u)}</b><br><span class="muted">The small ゃ ゅ ょ merge with the sound before them.</span></p>`;
      }
      const alts = i.romaji.slice(1);
      body = `
        <div class="meet">
          <div class="meet-info">
            <div class="big kana">${u}</div>
            <div class="meet-romaji">${romaji(u)} <button class="icon" data-act="speak" data-t="${u}" aria-label="Play sound">🔊</button></div>
            ${alts.length ? `<div class="muted">also typed: ${alts.join(', ')}</div>` : ''}
            ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}
            ${extra}
          </div>
          ${hasStrokes(u) && u.length === 1 ? '<div class="pad"></div>' : ''}
        </div>
        <div class="ctl">
          ${hasStrokes(u) && u.length === 1 ? '<button class="btn ghost" data-act="l-replay">↻ Replay strokes</button>' : ''}
          <button class="btn primary" data-act="l-next">${L.writing && hasStrokes(u) ? 'Trace it →' : 'Next →'}</button>
        </div>`;
    } else {
      const trace = L.step === 'trace';
      body = `
        <div class="step-title">${trace
          ? `Trace <span class="kana">${u}</span> — follow the numbered strokes`
          : `Now from memory: write <b>${romaji(u)}</b>`}</div>
        <div class="pad"></div>
        <div class="fb" aria-live="polite"></div>
        <div class="ctl">
          ${trace ? '<button class="btn ghost" data-act="l-show">Show order</button>' : '<button class="btn ghost" data-act="hint">Hint <kbd>H</kbd></button>'}
          <button class="btn link" data-act="l-next">Skip</button>
        </div>`;
    }

    app.innerHTML = `
    <div class="session lesson">
      <div class="s-top">
        <button class="icon" data-act="exit" aria-label="Exit">✕</button>
        <div class="lesson-dots kana">${dots}</div>
        <span class="count">${esc(L.g.label)}</span>
      </div>
      <div class="s-body">${body}</div>
    </div>`;

    const pad = $('.pad');
    if (L.step === 'meet') {
      speak(u);
      if (pad) {
        L.writer = new Writer(pad);
        L.writer.load(u, { mode: 'view', numbers: true });
        L.writer.animate(0.8);
      }
      return;
    }
    L.writer = new Writer(pad, {
      leniency: () => (S.settings.leniency === 'off' ? 'relaxed' : S.settings.leniency),
      onStroke: (r) => {
        if (r.ok) setFb('', '');
        else strokeFeedback(r);
      },
      onHint: (h) => { if (h.auto) setFb('warn', 'Follow the red stroke'); },
      onComplete: (s) => {
        const clean = s.hints === 0 && s.misses <= 1;
        if (L.step === 'trace' || clean) {
          setFb('ok', L.step === 'trace' ? '✓ Nice — now try it without the guide' : '✓ Great!');
          speak(u);
          setTimeout(() => { if (lesson === L) lessonNext(); }, 900);
        } else {
          setFb('warn', 'Almost — once more for practice');
          $('.ctl').innerHTML = '<button class="btn" data-act="l-retry">Try again</button><button class="btn primary" data-act="l-next">Next →</button>';
        }
      },
    });
    L.writer.load(u, L.step === 'trace' ? { mode: 'trace', guide: true, numbers: true } : { mode: 'recall', guide: false });
  }

  // =====================================================================
  // Modals: character detail, lessons list, settings
  // =====================================================================
  function modal(html, cls = '') {
    modalRoot.innerHTML = `<div class="m-back" data-act="m-close"></div>
      <div class="m-sheet ${cls}" role="dialog" aria-modal="true"><button class="icon m-x" data-act="m-close" aria-label="Close">✕</button>${html}</div>`;
    modalRoot.hidden = false;
  }
  function closeModal(silent) {
    if (detailWriter) { detailWriter.destroy(); detailWriter = null; }
    modalRoot.hidden = true;
    modalRoot.innerHTML = '';
    hideTip();
    if (!silent && !sess && !lesson && $('.home')) renderHome();
  }

  function statLine(label, u, skill) {
    const c = S.card(u, skill);
    if (!c) return `<div><span>${label}</span><span class="muted">not learned yet</span></div>`;
    return `<div><span>${label}</span><span>${S.STAGES[S.stageOf(c.level)].name} · level ${c.level}/${S.MAX} · ${c.ok}✓ ${c.bad}✗ · review ${c.due <= Date.now() ? 'due now' : 'in ' + fmtWait(c.due - Date.now())}</span></div>`;
  }

  function openDetail(u) {
    if (!u || !K.info[u]) return;
    const i = info(u);
    const strokes = hasStrokes(u) && u.length === 1;
    const g = groupOf(u);
    modal(`
      <div class="detail">
        <div class="d-head">
          <div class="big kana">${u}</div>
          <div>
            <div class="d-romaji">${i.romaji[0]} <button class="icon" data-act="speak" data-t="${u}" aria-label="Play sound">🔊</button></div>
            ${i.romaji.length > 1 ? `<div class="muted">also typed: ${i.romaji.slice(1).join(', ')}</div>` : ''}
            ${i.note ? `<div class="muted">${esc(i.note)}</div>` : ''}
            ${strokes ? `<div class="muted">${window.STROKES[u].length} stroke${window.STROKES[u].length > 1 ? 's' : ''}</div>` : ''}
          </div>
        </div>
        ${strokes ? `
          <div class="pad"></div>
          <div class="fb" aria-live="polite"></div>
          <div class="ctl">
            <button class="btn ghost" data-act="d-anim">▶ Stroke order</button>
            <button class="btn ghost" data-act="d-trace">Trace</button>
            <button class="btn ghost" data-act="d-recall">From memory</button>
          </div>` : ''}
        <div class="d-stats">${statLine('Reading', u, 'read')}${i.write ? statLine('Writing', u, 'write') : ''}</div>
        ${g && !groupLearned(g) ? `<button class="btn primary wide" data-act="learn-group" data-g="${g.id}">Learn “${esc(g.label)}” lesson</button>` : ''}
      </div>`, 'detail-sheet');
    if (!strokes) return;
    const fbEl = $('#modal .fb');
    const fb = (cls, t) => { fbEl.className = 'fb ' + cls; fbEl.textContent = t; };
    detailWriter = new Writer($('#modal .pad'), {
      leniency: () => (S.settings.leniency === 'off' ? 'relaxed' : S.settings.leniency),
      onStroke: (r) => {
        if (r.ok) return fb('', '');
        fb('warn', r.kind === 'direction' ? 'Wrong direction' : r.kind === 'order' ? `That’s stroke ${r.other + 1} — do stroke ${r.idx + 1} first` : 'Try that stroke again');
      },
      onComplete: (s) => {
        fb(s.hints || s.misses > 1 ? 'warn' : 'ok', s.hints || s.misses > 1 ? 'Done — go again?' : '✓ Nice! Go again…');
        const mode = detailWriter.mode;
        setTimeout(() => { if (detailWriter && detailWriter.done) { detailWriter.load(u, detailMode(mode)); fb('', ''); } }, 1100);
      },
    });
    detailWriter.load(u, { mode: 'view', numbers: true });
    detailWriter.animate(0.8);
    speak(u);
  }
  const detailMode = (m) => (m === 'trace' ? { mode: 'trace', guide: true, numbers: true } : { mode: 'recall', guide: false });

  // =====================================================================
  // Stats
  // =====================================================================
  const DAY = 864e5;
  const pct = (ok, n) => (n ? `${Math.round((100 * ok) / n)}%` : '–');
  const niceMax = (v) => { // a round number at or above v, for the top of a y-axis
    if (v <= 5) return 5;
    const p = 10 ** Math.floor(Math.log10(v));
    return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
  };
  const dayLabel = (t, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(t).toLocaleDateString(undefined, opts);

  function tile(label, value, sub) {
    return `<div class="tile"><div class="t-label">${label}</div><div class="t-value">${value}</div>${sub ? `<div class="t-sub">${sub}</div>` : ''}</div>`;
  }

  // Column chart, one series. cols: [{ v, label, tip, cap }]. Every column carries a tooltip and an
  // accessible name; `cap` prints the value above the column.
  function columns(cols, { title, axisLabels, tableHead }) {
    const max = niceMax(Math.max(1, ...cols.map((c) => c.v)));
    const bars = cols.map((c) => `
      <div class="col${c.now ? ' now' : ''}" tabindex="0" data-tip="${esc(c.tip)}" aria-label="${esc(c.tip)}">
        ${c.cap && c.v ? `<span class="cap">${c.v}</span>` : ''}
        <i style="height:${(100 * c.v) / max}%"></i>
      </div>`).join('');
    const rows = cols.map((c) => `<tr><td>${esc(c.label)}</td><td>${c.v}</td></tr>`).join('');
    return `
      <div class="cchart" role="group" aria-label="${esc(title)}">
        <div class="c-y"><span>${max}</span><span>${max / 2}</span><span>0</span></div>
        <div class="c-plot"><div class="c-grid"><i></i><i></i><i></i></div><div class="c-bars">${bars}</div></div>
        <span></span>
        <div class="c-x${axisLabels.length === cols.length ? ' even' : ''}" style="--n:${axisLabels.length}">${axisLabels.map((l) => `<span>${esc(l)}</span>`).join('')}</div>
      </div>
      <details class="c-table"><summary>Show as table</summary><table><thead><tr><th>${tableHead[0]}</th><th>${tableHead[1]}</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }

  function openStats() {
    const now = Date.now();
    const units = Object.keys(K.info);
    const learnedUnits = units.filter(S.isLearned);
    const mastered = learnedUnits.filter((u) => tierOf(u) === 4).length;
    const readCard = (u) => S.card(u, 'read');
    const newThisWeek = learnedUnits.filter((u) => (readCard(u).at || 0) > now - 7 * DAY).length;
    const readable = K.words.filter(([w]) => wordKnown(w)).length;
    const days = S.days();
    let n7 = 0, ok7 = 0, total = 0, totalOk = 0;
    for (let i = 0; i < 7; i++) { const d = days[S.today(now - i * DAY)]; if (d) { n7 += d.n; ok7 += d.ok; } }
    for (const d of Object.values(days)) { total += d.n; totalOk += d.ok; }
    const streak = S.streak(), best = S.bestStreak();

    // Characters by stage, per script (thin segmented bars; the figures sit beside them).
    const stageRows = ['hiragana', 'katakana'].map((sc) => {
      const us = units.filter((u) => scriptOf(u) === sc);
      const counts = [0, 0, 0, 0, 0];
      us.forEach((u) => counts[tierOf(u)]++);
      const segs = [1, 2, 3, 4].filter((t) => counts[t]).map((t) => {
        const tip = `${S.STAGES[t].name}: ${counts[t]} of ${us.length} ${sc}`;
        return `<i class="seg t${t}" style="flex-grow:${counts[t]}" tabindex="0" data-tip="${tip}" aria-label="${tip}"></i>`;
      }).join('');
      const rest = counts[0] ? `<i class="seg rest" style="flex-grow:${counts[0]}" tabindex="0" data-tip="New: ${counts[0]} not learned yet" aria-label="New: ${counts[0]} not learned yet"></i>` : '';
      const learned = us.length - counts[0];
      return `<div class="srow2">
        <div class="s-name"><span class="kana">${SCRIPT_JA[sc]}</span> ${sc[0].toUpperCase() + sc.slice(1)}</div>
        <div class="sbar">${segs}${rest}</div>
        <div class="s-fig">${learned} / ${us.length} learned · ${counts[4]} mastered</div>
      </div>`;
    }).join('');

    // Answers per day, last 30 days.
    const act = [];
    for (let i = 29; i >= 0; i--) {
      const t = now - i * DAY;
      const d = days[S.today(t)] || { n: 0, ok: 0 };
      const label = i === 0 ? 'Today' : dayLabel(t);
      act.push({ v: d.n, label, now: i === 0, tip: `${label}: ${d.n} answer${d.n === 1 ? '' : 's'}${d.n ? `, ${pct(d.ok, d.n)} correct` : ''}` });
    }

    // Reviews coming up: today (including any due now), then each of the next 6 days.
    const cards = S.all(reviewFilter);
    const endOfToday = new Date(new Date(now).setHours(24, 0, 0, 0)).getTime();
    const fc = [];
    for (let i = 0; i < 7; i++) {
      const from = i === 0 ? -Infinity : endOfToday + (i - 1) * DAY, to = endOfToday + i * DAY;
      const v = cards.filter((x) => x.card.due >= from && x.card.due < to).length;
      const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : dayLabel(from + 1, { weekday: 'short' });
      fc.push({ v, label, cap: true, now: i === 0, tip: `${label}: ${v} review${v === 1 ? '' : 's'}` });
    }
    const dueNow = cards.filter((x) => x.card.due <= now).length;
    const nextHour = cards.filter((x) => x.card.due > now && x.card.due <= now + 3600e3).length;

    // Characters to work on: lowest accuracy, at least 3 answers.
    const weak = cards.filter((x) => x.card.ok + x.card.bad >= 3 && x.card.bad > 0)
      .sort((a, b) => a.card.ok / (a.card.ok + a.card.bad) - b.card.ok / (b.card.ok + b.card.bad) || b.card.bad - a.card.bad)
      .slice(0, 8);

    modal(`
      <h2>Stats</h2>
      <div class="tiles">
        ${tile('Characters known', learnedUnits.length, `of ${units.length} kana${newThisWeek ? ` · +${newThisWeek} this week` : ''}`)}
        ${tile('Words you can read', readable, `of ${K.words.length} practice words`)}
        ${tile('Mastered', mastered, 'characters')}
        ${tile('Streak', `${streak} day${streak === 1 ? '' : 's'}`, `best ${best}`)}
        ${tile('Accuracy, 7 days', pct(ok7, n7), `${n7} answers · ${total} all time`)}
      </div>

      <h3>Characters by stage</h3>
      <div class="stage-rows">${stageRows}</div>
      <div class="legend">${[1, 2, 3, 4].map((t) => `<span><i class="t${t}"></i>${S.STAGES[t].name}</span>`).join('')}<span><i class="rest"></i>New</span></div>
      <p class="muted small-note">Seen: first day (reviews after 15 min, 1 h, 4 h, 8 h) · Learning: days · Familiar: weeks · Mastered: months.
        A character counts at the stage of its weaker card (reading or writing).</p>

      <h3>Answers per day <span class="muted">· last 30 days · ${pct(totalOk, total)} correct overall</span></h3>
      ${columns(act, { title: 'Answers per day, last 30 days', axisLabels: [act[0].label, act[15].label, 'Today'], tableHead: ['Day', 'Answers'] })}

      <h3>Reviews coming up <span class="muted">· ${dueNow} due now · ${nextHour} more in the next hour</span></h3>
      ${columns(fc, { title: 'Reviews coming up, next 7 days', axisLabels: fc.map((c) => c.label), tableHead: ['Day', 'Reviews'] })}

      <h3>Characters to work on</h3>
      ${weak.length ? `<table class="weak"><thead><tr><th></th><th>Card</th><th>Correct</th><th>Stage</th></tr></thead><tbody>
        ${weak.map((x) => `<tr>
          <td><button class="chip kana" data-act="detail" data-u="${x.unit}">${x.unit}</button></td>
          <td>${romaji(x.unit)} · ${x.skill === 'read' ? 'reading' : 'writing'}</td>
          <td>${pct(x.card.ok, x.card.ok + x.card.bad)} <span class="muted">(${x.card.bad} missed)</span></td>
          <td>${S.STAGES[S.stageOf(x.card.level)].name}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Nothing yet: characters you miss often will show up here.</p>'}
    `, 'stats-sheet');
  }

  // Tooltips for chart marks ([data-tip]): on hover and on keyboard focus.
  const tip = document.createElement('div');
  tip.className = 'tip';
  tip.setAttribute('role', 'tooltip');
  tip.hidden = true;
  document.body.appendChild(tip);
  function showTip(el) {
    tip.textContent = el.dataset.tip;
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = `${Math.min(innerWidth - w - 6, Math.max(6, r.left + r.width / 2 - w / 2))}px`;
    tip.style.top = `${r.top - h - 8 < 6 ? r.bottom + 8 : r.top - h - 8}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  document.addEventListener('pointerover', (e) => { const el = e.target.closest('[data-tip]'); el ? showTip(el) : hideTip(); });
  document.addEventListener('focusin', (e) => { const el = e.target.closest('[data-tip]'); el ? showTip(el) : hideTip(); });
  document.addEventListener('focusout', hideTip);
  document.addEventListener('scroll', hideTip, true);

  function openLessons() {
    const sc = S.settings.script;
    const groups = K.groups.filter((g) => g.script === sc);
    modal(`
      <h2>${SCRIPT_JA[sc]} lessons</h2>
      <p class="muted">Work through them in order. Each lesson introduces a few characters, has you trace and write them, then quizzes you. You can re-run any lesson as a refresher.</p>
      <ol class="lessons">${groups.map((g) => {
        const n = g.kana.filter(S.isLearned).length;
        const st = n === g.kana.length ? '<span class="ok">✓</span>' : n ? `${n}/${g.kana.length}` : '';
        return `<li><button data-act="learn-group" data-g="${g.id}" class="${n === g.kana.length ? 'is-done' : ''}">
          <span class="l-label">${esc(g.label)}${g.write ? '' : ' <small class="muted">(reading)</small>'}</span>
          <span class="kana l-kana">${g.kana.join(' ')}</span><span class="l-st">${st}</span></button></li>`;
      }).join('')}</ol>`);
  }

  // =====================================================================
  // Account + sync
  // =====================================================================
  const Y = window.Sync;

  function syncPillHTML() {
    if (!Y) return '';
    if (!Y.signedIn) {
      if (Y.username) return '<button class="pill btn-pill sync-signed-out" data-act="account">Sign in again</button>';
      return Y.state.server === 'yes' ? '<button class="pill btn-pill" data-act="account">Sign in to sync</button>' : '';
    }
    const st = Y.state.status;
    const label = { syncing: 'Syncing…', offline: 'Offline', error: 'Sync problem' }[st] || 'Synced';
    const title = Y.state.message || `Signed in as ${Y.username}`;
    return `<button class="pill btn-pill sync-${st}" data-act="settings" title="${esc(title)}">☁︎ ${label}</button>`;
  }

  function accountHTML() {
    if (!Y || (Y.state.server === 'no' && !Y.username)) {
      return `<h3>Sync</h3><p class="muted">Syncing between devices needs the Kana Dojo server (see the README).
        For now, progress is kept in this browser only.</p>`;
    }
    if (Y.signedIn) {
      const st = Y.state.status;
      const detail = st === 'offline' || st === 'error' ? esc(Y.state.message)
        : st === 'syncing' ? 'syncing…' : Y.lastSync ? `synced ${fmtAgo(Date.now() - Y.lastSync)}` : 'not synced yet';
      return `<h3>Account</h3>
        <div><b>${esc(Y.username)}</b> <span class="muted">· ${detail}</span></div>
        <div class="btns left">
          <button class="btn" data-act="sync-now">Sync now</button>
          <button class="btn" data-act="change-password">Password…</button>
          <button class="btn" data-act="sign-out">Sign out</button>
        </div>`;
    }
    return `<h3>Account</h3>
      <p class="muted">${Y.username
        ? `You were signed out of <b>${esc(Y.username)}</b>. Sign in again to keep syncing.`
        : 'Sign in to keep your progress in sync on all your devices.'}</p>
      <div class="btns left"><button class="btn primary" data-act="account">${Y.username ? 'Sign in' : 'Sign in or create an account'}</button></div>`;
  }

  function openAccount(mode) {
    if (!Y) return;
    const create = mode === 'create';
    const n = S.stats().cards;
    const carry = !Y.username && n
      ? `<p class="note">The progress on this device (${n} cards) will be ${create ? 'saved to your new account' : 'added to your account'}.</p>` : '';
    modal(`
      <h2>${create ? 'Create an account' : 'Sign in'}</h2>
      <p class="muted">${create
        ? 'Your progress is saved to your account and kept in sync on every device you sign in on.'
        : 'Sign in to sync your progress with your other devices.'}</p>
      <form class="auth" data-form="${create ? 'signup' : 'login'}">
        <label>Username<input name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false"
          required minlength="3" maxlength="24" value="${esc(Y.username || '')}"></label>
        <label>Password<input name="password" type="password" autocomplete="${create ? 'new-password' : 'current-password'}"
          required ${create ? 'minlength="8"' : ''} maxlength="200"></label>
        ${create ? '<small class="muted">At least 8 characters. There’s no email reset, so use one you’ll remember (or a password manager).</small>' : ''}
        ${carry}
        <div class="auth-err" aria-live="polite"></div>
        <button class="btn primary wide" type="submit">${create ? 'Create account' : 'Sign in'}</button>
      </form>
      <p class="muted center">${create
        ? 'Already have an account? <button class="btn link" data-act="account" data-mode="login">Sign in</button>'
        : Y.state.signups ? 'New here? <button class="btn link" data-act="account" data-mode="create">Create an account</button>' : ''}</p>`);
    $(`#modal input[name=${Y.username ? 'password' : 'username'}]`).focus();
  }

  function openPassword() {
    modal(`
      <h2>Password</h2>
      <form class="auth" data-form="password">
        <label>Current password<input name="current" type="password" autocomplete="current-password" required></label>
        <label>New password<input name="next" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label>
        <label>New password again<input name="next2" type="password" autocomplete="new-password" required minlength="8" maxlength="200"></label>
        <div class="auth-err" aria-live="polite"></div>
        <button class="btn primary wide" type="submit">Change password</button>
      </form>
      <h3>Delete account</h3>
      <p class="muted">Removes your account and its progress from the server. This device keeps its copy.</p>
      <form class="auth" data-form="delete">
        <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
        <div class="auth-err" aria-live="polite"></div>
        <button class="btn danger wide" type="submit">Delete my account</button>
      </form>`);
  }

  document.addEventListener('submit', async (e) => {
    const f = e.target.closest('form[data-form]');
    if (!f || !Y) return;
    e.preventDefault();
    const err = $('.auth-err', f);
    const btn = $('button[type=submit]', f);
    const v = Object.fromEntries(new FormData(f));
    err.textContent = '';
    btn.disabled = true;
    try {
      switch (f.dataset.form) {
        case 'login':
        case 'signup':
          await Y.signIn(v.username.trim(), v.password, f.dataset.form === 'signup');
          closeModal();
          break;
        case 'password':
          if (v.next !== v.next2) throw new Error('The new passwords don’t match');
          await Y.changePassword(v.current, v.next);
          modal('<h2>Password changed</h2><p class="muted">Your other devices have been signed out. Sign in there with the new password.</p>');
          break;
        case 'delete':
          if (!confirm('Delete your account and its progress from the server? This can’t be undone.')) { btn.disabled = false; return; }
          await Y.deleteAccount(v.password);
          modal('<h2>Account deleted</h2><p class="muted">Your account and its progress are gone from the server. This device still has its copy of your progress.</p>');
          break;
        default: break;
      }
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
    }
  });

  if (Y) {
    Y.on((what) => {
      const pill = $('.sync-slot');
      if (pill) pill.innerHTML = syncPillHTML();
      const acct = $('#modal .acct-slot');
      if (acct) acct.innerHTML = accountHTML();
      if ((what === 'progress' || what === 'account') && !sess && !lesson && modalRoot.hidden && $('.home')) renderHome();
    });
  }

  function openSettings() {
    const s = S.settings;
    const opt = (k, v, label) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${label}</option>`;
    const chk = (k) => `<input type="checkbox" data-set="${k}" ${s[k] ? 'checked' : ''}>`;
    const synced = Y && Y.signedIn;
    modal(`
      <h2>Settings</h2>
      <div class="acct-slot">${accountHTML()}</div>
      <h3>Practice</h3>
      <div class="settings">
        <label class="srow"><span>Speak characters aloud<small>Uses your device’s Japanese voice</small></span>${chk('sound')}</label>
        <label class="srow"><span>Writing practice<small>Trace &amp; write in lessons, and add writing cards to reviews</small></span>${chk('writeReviews')}</label>
        <label class="srow"><span>Reading answers<small>Type romaji, or tap one of four choices (handy on iPad)</small></span>
          <select data-set="answerMode">${opt('answerMode', 'type', 'Type')}${opt('answerMode', 'choose', 'Choose')}</select></label>
        <label class="srow"><span>Stroke checking<small>How closely each stroke must match. “Off” = draw freely, then compare and grade yourself</small></span>
          <select data-set="leniency">${opt('leniency', 'strict', 'Strict')}${opt('leniency', 'normal', 'Normal')}${opt('leniency', 'relaxed', 'Relaxed')}${opt('leniency', 'off', 'Off (self-check)')}</select></label>
        <label class="srow"><span>Vary fonts when reading<small>Mincho, rounded, handwritten… builds real-world recognition</small></span>${chk('varyFont')}</label>
        <label class="srow"><span>Show romaji on chart</span>${chk('chartRomaji')}</label>
      </div>
      <p class="muted small-note">Settings apply to this device only. Progress is shared between devices when you’re signed in.</p>
      <h3>Backup</h3>
      <p class="muted">${synced
        ? 'Your progress is saved in your account. You can also keep a copy as a file.'
        : 'Progress is saved in this browser. Export a copy to keep as a backup.'}</p>
      <div class="btns">
        <button class="btn" data-act="export">Export progress</button>
        <label class="btn">Import…<input type="file" accept=".json,application/json" id="importFile" hidden></label>
        <button class="btn danger" data-act="reset">Reset</button>
      </div>
      <p class="credit">Stroke-order data from <a href="https://kanjivg.tagaini.net" target="_blank" rel="noopener">KanjiVG</a> © Ulrich Apel, CC BY-SA 3.0.</p>`);
    $('#importFile').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const text = await f.text();
      e.target.value = '';
      if (Y && Y.signedIn && !confirm('Importing replaces your progress on all your devices. Continue?')) return;
      try {
        S.importJSON(text);
        alert('Progress imported.');
        closeModal();
      } catch (err) { alert('Could not import: ' + err.message); }
    });
  }

  function exportProgress() {
    const blob = new Blob([S.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `kana-dojo-progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // =====================================================================
  // Events
  // =====================================================================
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b || b.disabled) return;
    const act = b.dataset.act;
    switch (act) {
      case 'script': S.set('script', b.dataset.s); renderHome(); break;
      case 'review': startReview(); break;
      case 'practice': startPractice(b.dataset.skill); break;
      case 'words': startWords(); break;
      case 'learn-group': startLesson(K.groups.find((g) => g.id === b.dataset.g)); break;
      case 'lessons': openLessons(); break;
      case 'stats': openStats(); break;
      case 'settings': openSettings(); break;
      case 'detail': openDetail(b.dataset.u); break;
      case 'm-close': closeModal(); break;
      case 'home': renderHome(); break;
      case 'again': if (lastAgain) lastAgain(); break;
      case 'exit': exitSession(); break;
      case 'speak': speak(b.dataset.t, true); break;
      // session
      case 'choose': resolve(b.dataset.val === romaji(sess.cur.unit), { chosen: b.dataset.val }); break;
      case 'continue': cont(); break;
      case 'override': if (sess && sess.pending) { sess.pending.correct = true; cont(); } break;
      case 'hint': (sess ? sess.writer : lesson && lesson.writer)?.hint(); break;
      case 'reveal': if (sess && sess.writer && !sess.pending) { sess.writer.reveal(); resolve(false, { revealed: true }); } break;
      case 'w-clear': sess.writer.clearUser(); break;
      case 'w-check':
        sess.writer.host.classList.add('compare');
        sess.writer.setGuide(true);
        setFb('', 'Compare with the red guide. How did you do?');
        $('.ctl').innerHTML = '<button class="btn" data-act="w-self" data-ok="0">✗ Missed it</button><button class="btn primary" data-act="w-self" data-ok="1">✓ Got it</button>';
        break;
      case 'w-self':
        resolve(b.dataset.ok === '1', { self: true });
        if (b.dataset.ok === '1') cont();
        break;
      // lesson
      case 'l-next': lessonNext(); break;
      case 'l-replay': lesson.writer.load(lesson.g.kana[lesson.i], { mode: 'view', numbers: true }); lesson.writer.animate(0.8); break;
      case 'l-show': lesson.writer.animate(1).then(() => lesson && lesson.writer && setTimeout(() => lesson.writer.clearAnim(), 500)); break;
      case 'l-retry': renderLesson(); break;
      // detail
      case 'd-anim': detailWriter.load(detailWriter.ch, { mode: 'view', numbers: true }); detailWriter.animate(0.8); break;
      case 'd-trace': detailWriter.load(detailWriter.ch, detailMode('trace')); $('#modal .fb').textContent = 'Trace over the guide'; break;
      case 'd-recall': detailWriter.load(detailWriter.ch, detailMode('recall')); $('#modal .fb').textContent = 'Write it from memory'; break;
      // settings
      case 'export': exportProgress(); break;
      case 'reset':
        if (confirm(`Reset ALL progress${Y && Y.signedIn ? ' on all your devices' : ''}? Export a backup first if you’re unsure.`)) { S.reset(); closeModal(); }
        break;
      // account
      case 'account': openAccount(b.dataset.mode); break;
      case 'sync-now': Y.sync(); break;
      case 'change-password': openPassword(); break;
      case 'sign-out': Y.signOut().then((done) => { if (done) closeModal(); }); break;
      default: break;
    }
  });

  document.addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.set;
    if (!k) return;
    S.set(k, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalRoot.hidden) closeModal();
      else if (sess || lesson) exitSession();
      return;
    }
    if (!modalRoot.hidden || e.metaKey || e.ctrlKey) return;
    const inInput = e.target.tagName === 'INPUT';
    if (sess && sess.pending && !inInput && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cont(); return; }
    if (sess && !sess.pending && sess.cur.type === 'read' && /^[1-4]$/.test(e.key) && !inInput) {
      const b = $$('.choice')[+e.key - 1];
      if (b) b.click();
      return;
    }
    if (!inInput && (e.key === 'h' || e.key === 'H')) {
      const w = sess ? sess.writer : lesson && lesson.writer;
      if (w && !w.done && w.mode === 'recall') w.hint();
    }
    if (lesson && !sess && !inInput && e.key === 'Enter' && lesson.step === 'meet') lessonNext();
  });

  // Refresh due counts when coming back to the tab/app.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !sess && !lesson && modalRoot.hidden && $('.home')) renderHome();
  });

  renderHome();

  // Expose for debugging/tests.
  window.KanaDojo = { renderHome, startLesson, startReview, startPractice, startWords, openDetail, get sess() { return sess; }, get lesson() { return lesson; } };
})();
