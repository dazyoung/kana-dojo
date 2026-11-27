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

  const D = window.Decks;
  const info = (u) => K.info[u];
  const scriptOf = (u) => (K.info[u] || {}).script;
  const romaji = (u) => K.info[u].romaji[0];
  const writeOn = () => S.settings.writeReviews;
  // Cards per unit: kana read/write, kanji meaning/reading/write, words meaning/reading.
  const skillsFor = (u) => {
    const sc = scriptOf(u);
    if (sc === 'kanji') return writeOn() ? ['meaning', 'reading', 'write'] : ['meaning', 'reading'];
    if (sc === 'vocab') return ['meaning', 'reading'];
    return info(u).write && writeOn() ? ['read', 'write'] : ['read'];
  };
  const reviewFilter = (u, skill) => !!K.info[u] && (skill !== 'write' || writeOn());
  const groupLearned = (g) => g.kana.every(S.isLearned);
  const groupOf = (u) => K.groups.find((g) => g.kana.includes(u));
  const SCRIPT_JA = { hiragana: 'ひらがな', katakana: 'カタカナ', kanji: '漢字', vocab: '単語' };
  const SCRIPT_EN = { hiragana: 'Hiragana', katakana: 'Katakana', kanji: 'Kanji', vocab: 'Words' };
  const isDeck = (sc) => sc === 'kanji' || sc === 'vocab';
  const levelKey = (sc) => (sc === 'kanji' ? 'kanjiLevel' : 'vocabLevel');
  const deckLevel = (sc) => Number(S.settings[levelKey(sc)]) || 5;
  const SKILL_NAME = { read: 'reading', write: 'writing', meaning: 'meaning', reading: 'reading' };
  const CREDIT = '<p class="credit">Kanji data: KANJIDIC (EDRDG) · stroke order: KanjiVG · JLPT levels: Jonathan Waller (unofficial) · <button class="btn link" data-act="sources">Sources</button></p>';
  const hasStrokes = (u) => !!(window.STROKES && window.STROKES[u]);

  if (!S.settings.answerMode) {
    S.set('answerMode', matchMedia('(hover: hover) and (pointer: fine)').matches ? 'type' : 'choose');
  }

  // ---------- speech ----------
  // Uses the device's own Japanese voices (Web Speech API). Settings → Voice picks one; by default
  // the best-sounding one available: Premium, then Enhanced, then the rest.
  let voice = null;
  const canSpeak = 'speechSynthesis' in window;
  // The quality is in the name ("Kyoko (Enhanced)") or only in the id ("com.apple.voice.enhanced.ja-JP.Kyoko").
  const voiceQuality = (v) => {
    const s = `${v.name} ${v.voiceURI}`;
    return /premium|プレミアム/i.test(s) ? 'Premium' : /enhanced|拡張/i.test(s) ? 'Enhanced' : '';
  };
  const voiceRank = (v) => ({ Premium: 0, Enhanced: 1 }[voiceQuality(v)] ??
    (/google/i.test(v.name) ? 2 : /kyoko|otoya|o-ren|hattori/i.test(v.name) ? 3 : 4));
  const voiceLabel = (v) => {
    const name = v.name.replace(/\s*\(Japanese \(Japan\)\)$/, '');
    const q = voiceQuality(v);
    return `${name}${q && !name.includes(q) ? ` (${q})` : ''}${v.localService ? '' : ' (online)'}`;
  };
  const jaVoices = () => (canSpeak ? speechSynthesis.getVoices() : [])
    .filter((v) => /^ja([-_]|$)/i.test(v.lang))
    .sort((a, b) => voiceRank(a) - voiceRank(b) || a.name.localeCompare(b.name));
  function pickVoice() {
    const vs = jaVoices();
    voice = vs.find((v) => v.voiceURI === S.settings.voice) || vs[0] || null;
    const sel = $('#voiceSel');
    if (sel) sel.outerHTML = voiceSelectHTML(); // voices can arrive after Settings opened
  }
  function voiceSelectHTML() {
    const vs = jaVoices();
    if (!vs.length) {
      return `<select id="voiceSel" disabled><option>${canSpeak ? 'No Japanese voice found' : 'Not supported here'}</option></select>`;
    }
    const cur = voice ? voice.voiceURI : '';
    return `<select id="voiceSel" data-set="voice">${vs.map((v) => `<option value="${esc(v.voiceURI)}" ${v.voiceURI === cur ? 'selected' : ''}>${esc(voiceLabel(v))}</option>`).join('')}</select>`;
  }
  // Where to get better voices on this device.
  function voiceTip() {
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) return 'For a better voice: Settings → Accessibility → Read & Speak (called Spoken Content on older versions) → Voices → Japanese, download an Enhanced voice (Kyoko, Otoya or O-Ren), then reload this page.';
    if (/Macintosh/.test(ua)) return 'For a better voice: System Settings → Accessibility → Read & Speak → the ⓘ next to “System voice” → Japanese → Voice, then download Kyoko, Otoya or O-Ren (Enhanced) with the cloud button, and reload this page. (Older macOS: Spoken Content → System voice → Manage Voices.) Your Mac’s own voice doesn’t need changing.';
    return 'Your system’s speech settings may offer more Japanese voices to download.';
  }
  if (canSpeak) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function speak(text, force) {
    if (!canSpeak || (!S.settings.sound && !force)) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = voice ? voice.lang : 'ja-JP';
    if (voice) u.voice = voice;
    u.rate = Number(S.settings.speechRate) || 0.85;
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
    const lv = Math.min(...skillsFor(u).map((sk) => S.level(u, sk) || 1));
    return Math.max(1, S.stageOf(lv));
  }

  function chartHTML(sc) {
    if (isDeck(sc)) {
      const sub = S.settings.chartRomaji;
      const cells = D.byLevel[sc][deckLevel(sc)].map((u) => (sc === 'kanji'
        ? `<button class="cell kcell t${tierOf(u)}" data-act="detail" data-u="${u}" title="${esc(D.meaningText(u))}" aria-label="${u}: ${esc(D.meaningText(u))}"><span class="k">${u}</span>${sub ? `<span class="r">${esc(D.shortMeaning(u))}</span>` : ''}</button>`
        : `<button class="cell wcell t${tierOf(u)}" data-act="detail" data-u="${esc(u)}" title="${esc(`${info(u).reading} · ${info(u).meaning}`)}"><span class="k">${esc(D.display(u))}</span>${sub && info(u).reading !== info(u).word ? `<span class="r">${esc(info(u).reading)}</span>` : ''}</button>`)).join('');
      return `<div class="grid ${sc}">${cells}</div>`;
    }
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
    const deck = isDeck(sc);
    const lv = deck ? deckLevel(sc) : null;
    const groups = K.groups.filter((g) => g.script === sc);
    const nextGroup = groups.find((g) => !groupLearned(g));
    const units = deck ? D.byLevel[sc][lv] : Object.keys(K.info).filter((u) => scriptOf(u) === sc);
    const learned = units.filter(S.isLearned).length;
    const nWords = deck ? 0 : availableWords(sc).length;
    const anyLearned = deck ? K.groups.some((g) => g.script === sc && g.kana.some(S.isLearned)) : learned > 0;
    const practiceBtns = (sc === 'kanji' ? [['meaning', 'Meaning'], ['reading', 'Reading'], ['write', 'Write']]
      : sc === 'vocab' ? [['meaning', 'Meaning'], ['reading', 'Reading']]
        : [['read', 'Read'], ['write', 'Write']])
      .map(([sk, name]) => `<button class="btn" data-act="practice" data-skill="${sk}" ${anyLearned && (sk !== 'write' || writeOn()) ? '' : 'disabled'}>${name}</button>`).join('');
    const doneSub = { hiragana: 'Time for katakana!', katakana: 'Time for kanji!', kanji: 'Every JLPT kanji learned. 見事！', vocab: 'Every JLPT word learned. 見事！' }[sc];
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
        ${['hiragana', 'katakana', 'kanji', 'vocab'].map((s) => `<button role="tab" data-act="script" data-s="${s}" class="${s === sc ? 'on' : ''}">
          <span class="kana">${SCRIPT_JA[s]}</span> <span class="seg-en">${SCRIPT_EN[s]}</span></button>`).join('')}
      </div>

      <section class="actions">
        <button class="action primary" data-act="review" ${due ? '' : 'disabled'}>
          <span class="a-title">Review</span><span class="a-sub">${reviewSub}</span>
        </button>
        ${nextGroup ? `
        <button class="action" data-act="learn-group" data-g="${nextGroup.id}">
          <span class="a-title">Learn next · <span class="muted">${nextGroup.label}</span></span>
          <span class="a-kana kana${sc === 'vocab' ? ' small' : ''}">${(sc === 'vocab' ? nextGroup.kana.slice(0, 4) : nextGroup.kana.slice(0, 9)).map(D.display).join(' ')}${nextGroup.kana.length > (sc === 'vocab' ? 4 : 9) ? ' …' : ''}</span>
        </button>` : `
        <div class="action done"><span class="a-title">All ${SCRIPT_EN[sc].toLowerCase()} lessons learned</span>
          <span class="a-sub">${doneSub}</span></div>`}
        <div class="action practice">
          <span class="a-title">Extra practice</span>
          <div class="a-row">
            ${practiceBtns}
            ${sc === 'vocab' ? '' : `<button class="btn" data-act="workout" ${writeOn() && writeCards(sc).length ? '' : 'disabled'}
              title="A writing drill on your ${WORKOUT_SIZE} weakest characters">Workout</button>`}
            ${deck ? '' : `<button class="btn" data-act="words" ${nWords ? '' : 'disabled'}>Words <small>${nWords}</small></button>`}
          </div>
        </div>
      </section>

      <div class="chart-head">
        <h2>${SCRIPT_JA[sc]}${deck ? ` N${lv}` : ''} <span class="muted">${learned} / ${units.length} learned</span></h2>
        <div class="chart-btns">
          <button class="btn ghost" data-act="stats">Stats</button>
          <button class="btn ghost" data-act="lessons">All lessons</button>
          ${deck ? '' : '<button class="btn ghost" data-act="custom" title="Pick your own characters for a lesson or a writing workout">Custom set</button>'}
        </div>
      </div>
      ${deck ? `<div class="lv-pills" role="group" aria-label="JLPT level">${D.LEVELS.map((l) => `<button class="pill btn-pill${l === lv ? ' on' : ''}" data-act="level" data-l="${l}">N${l} <small>${D.byLevel[sc][l].filter(S.isLearned).length}/${D.byLevel[sc][l].length}</small></button>`).join('')}</div>` : ''}
      <div class="legend">
        <span><i class="t0"></i>New</span><span><i class="t1"></i>Seen</span><span><i class="t2"></i>Learning</span>
        <span><i class="t3"></i>Familiar</span><span><i class="t4"></i>Mastered</span>
      </div>
      <div class="chart">${chartHTML(sc)}</div>
      <footer class="foot">${sc === 'kanji' ? 'Tap a kanji for its readings, example words and stroke order.'
        : sc === 'vocab' ? 'Tap a word for its reading, meaning and kanji.' : 'Tap any character for stroke order and writing practice.'}
        ${deck ? CREDIT : ''}</footer>
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
      if (input.value.trim()) resolve(checkTyped(sess.cur, input.value, true));
    });
    input.addEventListener('input', () => {
      if (sess && !sess.pending && checkTyped(sess.cur, input.value, false)) resolve(true);
    });
    nextCard();
  }

  // `final` = submitted (Enter), rather than checked while typing: small typos in meanings are forgiven then.
  const checkTyped = (it, v, final) => (it.type === 'word' ? R.checkWord(it.word, v)
    : it.type === 'meaning' ? D.checkMeaning(it.unit, v, final)
      : it.type === 'reading' ? D.checkReading(it.unit, v)
        : R.checkUnit(it.unit, v));

  function updateProgress() {
    $('.s-top .bar i').style.width = `${(100 * sess.done) / sess.total}%`;
    $('.s-top .count').textContent = `${sess.done} / ${sess.total}`;
  }

  function nextCard() {
    stopDrill();
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

    $('#ans').placeholder = it.type === 'meaning' ? 'type the meaning in English…'
      : it.type === 'reading' ? 'type the reading (romaji or kana)…' : 'type romaji…';
    if (it.type === 'read') {
      const typed = S.settings.answerMode === 'type';
      it.answer = romaji(it.unit);
      top.innerHTML = `
        <div class="tag">${it.unit.length > 1 ? 'combo' : scriptOf(it.unit)} · read</div>
        <div class="big kana" ${fontAttr()}>${it.unit}</div>
        ${typed ? '' : `<div class="choices">${choicesFor(it.unit).map((r, i) =>
          `<button class="choice" data-act="choose" data-val="${r}"><kbd>${i + 1}</kbd>${r}</button>`).join('')}</div>`}`;
      showInput(typed);
    } else if (it.type === 'word') {
      top.innerHTML = `<div class="tag">word · read</div><div class="big kana word" ${fontAttr()}>${it.word}</div>`;
      showInput(true);
    } else if (it.type === 'meaning' || it.type === 'reading') {
      // Kanji or word: give its meaning (in English) or its reading (romaji or kana).
      const typed = S.settings.answerMode === 'type';
      const word = scriptOf(it.unit) === 'vocab';
      const ch = it.type === 'meaning' ? D.meaningChoices(it.unit) : D.readingChoices(it.unit);
      it.answer = ch.answer;
      top.innerHTML = `
        <div class="tag">${word ? 'word' : 'kanji'} · ${it.type}</div>
        <div class="big kana${word ? ' word' : ''}" ${fontAttr()}>${esc(D.display(it.unit))}</div>
        ${typed ? '' : `<div class="choices${it.type === 'meaning' ? ' wide' : ''}">${ch.options.map((r, i) =>
          `<button class="choice" data-act="choose" data-val="${esc(r)}"><kbd>${i + 1}</kbd>${esc(r)}</button>`).join('')}</div>`}`;
      showInput(typed);
    } else {
      const i = info(it.unit);
      const kanji = i.script === 'kanji';
      const selfCheck = S.settings.leniency === 'off';
      top.innerHTML = `
        <div class="write-prompt">
          <span class="tag">${i.script} · write</span>
          ${kanji ? `<div class="romaji-big meaning-big">${esc(i.meanings.slice(0, 3).join(', '))}</div>
            <div class="note">${esc(D.readingsText(it.unit))}</div>`
    : `<div class="romaji-big">${romaji(it.unit)}</div>${i.note ? `<div class="note">${esc(i.note)}</div>` : ''}`}
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

  const strokeMsg = (r) => (r.kind === 'direction' ? 'Right shape, wrong direction — strokes run top→bottom, left→right'
    : r.kind === 'order' ? `That’s stroke ${r.other + 1} — stroke ${r.idx + 1} comes first`
      : 'Not quite — try that stroke again');
  function strokeFeedback(r) {
    if (r.free) return;
    if (r.ok) { setFb('', r.idx < r.n ? `<span class="muted">stroke ${r.idx} / ${r.n}</span>` : ''); return; }
    setFb('warn', strokeMsg(r));
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
    speak(it.word || D.speakText(it.unit));

    // highlight choices
    $$('.choice').forEach((b) => {
      b.disabled = true;
      if (b.dataset.val === it.answer) b.classList.add('right');
      else if (b.dataset.val === extra.chosen) b.classList.add('wrong');
    });

    if (it.type === 'word') {
      const r = R.kanaToRomaji(it.word);
      setFb(correct ? 'ok' : 'bad', `${correct ? '✓' : '✗'} <b>${r}</b> — ${esc(it.meaning)}`);
    } else if (it.type === 'read') {
      setFb(correct ? 'ok' : 'bad', correct ? `✓ ${romaji(it.unit)}` : `${it.unit} = <b>${info(it.unit).romaji.join(' / ')}</b>`);
    } else if (it.type === 'meaning' || it.type === 'reading') {
      const means = esc(D.meaningText(it.unit)), reads = esc(D.readingsText(it.unit));
      setFb(correct ? 'ok' : 'bad', `${correct ? '✓' : `${esc(D.display(it.unit))} =`} <b>${it.type === 'meaning' ? means : reads}</b>
        <div class="fb-sub">${it.type === 'meaning' ? reads : means}</div>`);
    } else if (extra.write) {
      const s = extra.write;
      setFb(correct ? 'ok' : 'bad', correct
        ? `✓ ${s.misses ? 'Good (one slip)' : 'Perfect strokes'}`
        : `✗ ${s.hints ? 'Needed a hint' : `${s.misses} missed strokes`} — watch the stroke order`);
    } else if (extra.revealed) {
      setFb('bad', `Here’s <b>${it.unit}</b> (${esc(D.label(it.unit))}) — study the stroke order`);
    } else if (extra.self && !correct) {
      setFb('bad', '✗ Watch the stroke order');
    }

    const override = !correct && !extra.revealed && !extra.chosen ? '<button class="btn link" data-act="override">I was right</button>' : '';
    if (!correct && it.type === 'write' && hasStrokes(it.unit)) {
      sess.pending.fixing = true;
      ctl.innerHTML = `<button class="btn link" data-act="continue">Skip</button>${override}`;
      fixAfterMiss(it, override, extra.shown);
      return;
    }
    ctl.innerHTML = `<button class="btn primary" data-act="continue">Continue <kbd>↵</kbd></button>${override}`;
    if (correct) {
      const delay = it.type === 'word' ? 1600 : it.type === 'meaning' || it.type === 'reading' ? 1400 : it.type === 'write' ? 900 : 550;
      sess.autoTimer = setTimeout(cont, delay);
    } else if (it.type !== 'word' && document.activeElement && document.activeElement.id !== 'ans') {
      $('[data-act="continue"]').focus({ preventScroll: true });
    }
  }

  // After a missed writing card: watch the stroke order, then trace it once and write it twice from memory
  // (FIX_ROUNDS). The card still counts as missed, and comes back later in the session.
  function fixAfterMiss(it, override, shown) {
    const s0 = sess, w = sess.writer;
    const live = () => sess === s0 && sess.cur === it && sess.writer === w && !!sess.pending && sess.pending.fixing;
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    (async () => {
      await (shown || wait(600));
      if (!live()) return;
      w.host.classList.remove('compare');
      w.load(it.unit, { mode: 'view', numbers: true });
      await w.animate();
      await wait(500);
      if (!live()) return;
      const head = $('.slot-top .write-prompt');
      head.classList.add('drill-head');
      head.innerHTML = DRILL_HEAD;
      $('.ctl').innerHTML = `<button class="btn ghost" data-act="dr-show">Show order</button><button class="btn ghost" data-act="hint">Hint <kbd>H</kbd></button><button class="btn link" data-act="continue">Skip</button>${override}`;
      startDrill(w, it.unit, FIX_ROUNDS, head, setFb, (r) => {
        if (!live()) return;
        sess.pending.fixing = false;
        setFb(r.clean ? 'ok' : 'warn', `${r.clean ? '✓ Fixed' : 'Done'} — it comes back later in this session`);
        $('.ctl').innerHTML = `<button class="btn primary" data-act="continue">Continue <kbd>↵</kbd></button>${override}`;
        sess.autoTimer = setTimeout(cont, 1400);
      });
    })();
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
      ${missed.length ? `<p class="missed">Missed: ${missed.map((m) => `<button class="kana chip" data-act="detail" data-u="${K.info[m] ? esc(m) : ''}">${esc(D.display(m))}</button>`).join('')}</p>` : ''}
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
    if (lesson && !sess && lesson.i > 0 && !confirm(lesson.workout ? 'Leave this workout?' : 'Leave this lesson?')) return;
    stopDrill();
    if (sess && sess.writer) sess.writer.destroy();
    if (lesson && lesson.writer) lesson.writer.destroy();
    renderHome();
  }

  // ---------- session starters ----------
  async function startReview() {
    const due = S.due(reviewFilter);
    await D.loadStrokes(due.filter((d) => d.skill === 'write').map((d) => d.unit));
    startSession({
      kind: 'review', title: 'Review',
      items: due.map((d) => ({ type: d.skill, unit: d.unit, skill: d.skill })),
      endNote: 'Misses come back sooner; correct answers wait longer each time.',
    });
  }

  async function startPractice(skill) {
    const sc = S.settings.script;
    const pool = S.all((u, sk) => scriptOf(u) === sc && sk === skill)
      .map((x) => ({ ...x, r: x.card.level + Math.random() * 2 }))
      .sort((a, b) => a.r - b.r)
      .slice(0, 20);
    if (skill === 'write') await D.loadStrokes(pool.map((d) => d.unit));
    startSession({
      kind: 'practice', title: `${SKILL_NAME[skill][0].toUpperCase() + SKILL_NAME[skill].slice(1)} practice`,
      items: pool.map((d) => ({ type: d.skill, unit: d.unit, skill: d.skill })),
      endNote: 'Extra practice focuses on your weakest characters and doesn’t change review timing.',
      again: () => startPractice(skill),
    });
  }

  // Writing workout: a drill on each of your weakest written characters (in the script shown), then each
  // once more from memory, mixed up. Like Extra practice, it doesn't change when they're next due.
  const WORKOUT_SIZE = 5;
  const writeCards = (sc) => S.all((u, sk) => sk === 'write' && scriptOf(u) === sc);
  // Weakest first: most often missed (smoothed, so 0 of 1 isn't worse than 1 of 5), then lowest level.
  const weakness = (c) => (c.bad + 0.5) / (c.ok + c.bad + 1) + (12 - c.level) / 60 + Math.random() * 0.08;
  const weakestWritten = (sc, n) => writeCards(sc).filter((x) => hasStrokes(x.unit))
    .map((x) => ({ u: x.unit, w: weakness(x.card) }))
    .sort((a, b) => b.w - a.w).slice(0, n).map((x) => x.u);
  // picked: the characters of a custom set (otherwise the weakest ones in the script shown).
  async function startWorkout(picked) {
    const sc = S.settings.script;
    if (sc === 'kanji') await D.loadStrokes(picked || writeCards(sc).map((x) => x.unit));
    const units = picked ? picked.filter(hasStrokes) : weakestWritten(sc, WORKOUT_SIZE);
    if (!units.length) return;
    closeModal(true);
    lesson = {
      g: { label: picked ? 'Custom workout' : 'Writing workout', kana: units, write: true },
      i: 0, step: 'write', writing: true, workout: true, again: () => startWorkout(picked),
    };
    renderLesson();
  }
  function finishWorkout(L) {
    lesson = null;
    startSession({
      kind: 'practice', title: L.g.label,
      items: shuffle(L.g.kana.slice()).map((u) => ({ type: 'write', unit: u, skill: 'write' })),
      endNote: 'Workouts count toward your stats but don’t change when characters are next due.',
      again: L.again,
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
  // Lessons: meet → writing drill, for each character, then a quiz
  // =====================================================================
  async function startLesson(g) {
    if (g.script === 'kanji') await D.loadStrokes(g.kana);
    closeModal(true);
    lesson = { g, i: 0, step: 'meet', writing: writeOn() && g.write };
    renderLesson();
  }

  function lessonNext() {
    const L = lesson;
    const u = L.g.kana[L.i];
    const canWrite = L.writing && hasStrokes(u);
    if (L.step === 'meet' && canWrite) L.step = 'write';
    else { L.i++; L.step = L.workout ? 'write' : 'meet'; }
    if (L.i >= L.g.kana.length) return L.workout ? finishWorkout(L) : startLessonQuiz();
    renderLesson();
  }

  function startLessonQuiz() {
    const g = lesson.g;
    const writing = lesson.writing;
    if (lesson.writer) lesson.writer.destroy();
    lesson = null;
    const items = [];
    g.kana.forEach((u) => {
      if (isDeck(scriptOf(u))) {
        items.push({ type: 'meaning', unit: u, skill: 'meaning' }, { type: 'reading', unit: u, skill: 'reading' });
        if (writing && scriptOf(u) === 'kanji' && hasStrokes(u)) items.push({ type: 'write', unit: u, skill: 'write' });
        return;
      }
      items.push({ type: 'read', unit: u, skill: 'read' });
      if (writing && info(u).write) items.push({ type: 'write', unit: u, skill: 'write' });
    });
    // A custom set can mix new characters with ones already in your reviews, whose timing stays as it is.
    const fresh = g.kana.filter((u) => !S.isLearned(u)).length;
    const soon = 'The first review comes up in about 15 minutes, then a few more today.';
    startSession({
      kind: 'quiz', title: `${g.label} lesson`, items,
      onEnd: () => g.kana.forEach((u) => S.learn(u, skillsFor(u))),
      endNote: fresh === g.kana.length ? `These characters are now in your reviews. ${soon}`
        : fresh ? `${fresh === 1 ? 'The new one is' : `The ${fresh} new ones are`} now in your reviews, and the others keep their timing. ${soon}`
          : 'You’d already learned all of these, so their review timing hasn’t changed.',
      again: g.custom ? () => startLesson(g) : null,
    });
  }

  function readingsHTML(u) {
    const i = info(u);
    return `<div class="readings">${i.on.length ? `<span><small>On</small> ${esc(i.on.join('、'))}</span>` : ''}${i.kun.length ? `<span><small>Kun</small> ${esc(i.kun.map((r) => r.replace(/\.(.+)$/, '($1)')).join('、'))}</span>` : ''}</div>`;
  }
  const wordRow = (id) => `<button class="ex" data-act="detail" data-u="${esc(id)}"><span class="kana">${esc(info(id).word)}</span> <span class="muted">${esc(info(id).reading)}</span> ${esc(info(id).meaning)}</button>`;
  const kanjiRow = (k) => `<button class="ex" data-act="detail" data-u="${k}"><span class="kana">${k}</span> ${esc(info(k).meanings.slice(0, 2).join(', '))} <span class="muted">${esc(D.readingsText(k))}</span></button>`;
  function meetDeckHTML(u) {
    const i = info(u);
    if (i.script === 'kanji') {
      const ex = D.examples(u, 4);
      return `
        <div class="meet">
          <div class="meet-info">
            <div class="big kana">${u}</div>
            <div class="meet-mean">${esc(i.meanings.join(', '))}</div>
            ${readingsHTML(u)}
            <div class="muted">N${i.level} · ${i.strokes} strokes</div>
            ${ex.length ? `<div class="exs">${ex.map(wordRow).join('')}</div>` : ''}
          </div>
          ${hasStrokes(u) ? '<div class="pad"></div>' : ''}
        </div>`;
    }
    const ks = D.kanjiIn(u);
    return `
      <div class="meet">
        <div class="meet-info">
          <div class="big kana word">${esc(i.word)}</div>
          <div class="meet-romaji kana">${esc(i.reading)} <button class="icon" data-act="speak" data-t="${esc(i.reading)}" aria-label="Play sound">🔊</button></div>
          <div class="meet-mean">${esc(i.meaning)}</div>
          <div class="muted">N${i.level} word</div>
          ${ks.length ? `<div class="exs">${ks.map(kanjiRow).join('')}</div>` : ''}
        </div>
      </div>`;
  }

  function renderLesson() {
    const L = lesson;
    const u = L.g.kana[L.i];
    const i = info(u);
    stopDrill();
    if (L.writer) { L.writer.destroy(); L.writer = null; }
    const shown = (j) => j < L.i || (!L.workout && !(j === L.i && L.step === 'write'));
    const dots = L.g.kana.map((k, j) => `<span class="${j < L.i ? 'done' : j === L.i ? 'cur' : ''}">${shown(j) ? esc(D.display(k)) : '・'}</span>`).join('');
    let body = '';

    if (L.step === 'meet' && isDeck(i.script)) {
      body = `${meetDeckHTML(u)}
        <div class="ctl">
          ${hasStrokes(u) ? '<button class="btn ghost" data-act="l-replay">↻ Replay strokes</button>' : ''}
          <button class="btn primary" data-act="l-next">${L.writing && hasStrokes(u) ? 'Write it →' : 'Next →'}</button>
        </div>`;
    } else if (L.step === 'meet') {
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
          <button class="btn primary" data-act="l-next">${L.writing && hasStrokes(u) ? 'Write it →' : 'Next →'}</button>
        </div>`;
    } else {
      body = `
        <div class="drill-head">${DRILL_HEAD}</div>
        <div class="pad"></div>
        <div class="fb" aria-live="polite"></div>
        <div class="ctl">
          <button class="btn ghost" data-act="dr-show">Show order</button>
          <button class="btn ghost" data-act="hint">Hint <kbd>H</kbd></button>
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
      speak(D.speakText(u));
      if (pad) {
        L.writer = new Writer(pad);
        L.writer.load(u, { mode: 'view', numbers: true });
        L.writer.animate(0.8);
      }
      return;
    }
    L.writer = new Writer(pad);
    startDrill(L.writer, u, drillRounds(), $('.drill-head'), setFb, (r) => {
      setFb(r.clean ? 'ok' : 'warn', r.clean ? '✓ Nice' : 'Done — this one needs more practice');
      speak(D.speakText(u));
      setTimeout(() => { if (lesson === L) lessonNext(); }, 900);
    }, { showOrder: !!L.workout });
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
    if (drill && drill.w === detailWriter) stopDrill();
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

  async function openDeckDetail(u) {
    const i = info(u);
    const g = groupOf(u);
    const kanji = i.script === 'kanji';
    if (kanji) await D.loadStrokes([u]);
    const strokes = kanji && hasStrokes(u);
    const ex = kanji ? D.examples(u, 8) : [];
    const ks = kanji ? [] : D.kanjiIn(u);
    modal(`
      <div class="detail">
        <div class="d-head">
          <div class="big kana${kanji ? '' : ' word'}">${esc(D.display(u))}</div>
          <div>
            ${kanji ? `<div class="d-mean">${esc(i.meanings.join(', '))}</div>${readingsHTML(u)}`
    : `<div class="d-romaji kana">${esc(i.reading)} <button class="icon" data-act="speak" data-t="${esc(i.reading)}" aria-label="Play sound">🔊</button></div><div class="d-mean">${esc(i.meaning)}</div>`}
            <div class="muted">JLPT N${i.level}${kanji ? ` · ${i.strokes} strokes` : ''}</div>
          </div>
        </div>
        ${strokes ? `
          <div class="drill-head" hidden>${DRILL_HEAD}</div>
          <div class="pad"></div>
          <div class="fb" aria-live="polite"></div>
          <div class="ctl">
            <button class="btn ghost" data-act="d-anim">▶ Stroke order</button>
            <button class="btn ghost" data-act="d-trace">Trace</button>
            <button class="btn ghost" data-act="d-recall">From memory</button>
            <button class="btn ghost" data-act="d-drill" title="Write it ${drillRounds().length} times, the guide fading each time">Drill ×${drillRounds().length}</button>
          </div>` : ''}
        ${ex.length ? `<h3>Words with ${u}</h3><div class="exs">${ex.map(wordRow).join('')}</div>` : ''}
        ${ks.length ? `<h3>Kanji in this word</h3><div class="exs">${ks.map(kanjiRow).join('')}</div>` : ''}
        <div class="d-stats">${skillsFor(u).map((sk) => statLine(SKILL_NAME[sk][0].toUpperCase() + SKILL_NAME[sk].slice(1), u, sk)).join('')}</div>
        ${g && !groupLearned(g) ? `<button class="btn primary wide" data-act="learn-group" data-g="${g.id}">Learn “${esc(g.label)}” lesson</button>` : ''}
        ${CREDIT}
      </div>`, 'detail-sheet');
    if (strokes) detailPad(u);
    else speak(D.speakText(u));
  }

  function openDetail(u) {
    if (!u || !K.info[u]) return;
    if (isDeck(scriptOf(u))) return openDeckDetail(u);
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
          <div class="drill-head" hidden>${DRILL_HEAD}</div>
          <div class="pad"></div>
          <div class="fb" aria-live="polite"></div>
          <div class="ctl">
            <button class="btn ghost" data-act="d-anim">▶ Stroke order</button>
            <button class="btn ghost" data-act="d-trace">Trace</button>
            <button class="btn ghost" data-act="d-recall">From memory</button>
            <button class="btn ghost" data-act="d-drill" title="Write it ${drillRounds().length} times, the guide fading each time">Drill ×${drillRounds().length}</button>
          </div>` : ''}
        <div class="d-stats">${statLine('Reading', u, 'read')}${i.write ? statLine('Writing', u, 'write') : ''}</div>
        ${g && !groupLearned(g) ? `<button class="btn primary wide" data-act="learn-group" data-g="${g.id}">Learn “${esc(g.label)}” lesson</button>` : ''}
      </div>`, 'detail-sheet');
    if (strokes) detailPad(u);
  }

  // The stroke-order pad on a detail screen: animation, then trace / write from memory on request.
  function detailPad(u) {
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
        setTimeout(() => { if (detailWriter && detailWriter.done && !drill) { detailWriter.load(u, detailMode(mode)); fb('', ''); } }, 1100);
      },
    });
    detailWriter.load(u, { mode: 'view', numbers: true });
    detailWriter.animate(0.8);
    speak(D.speakText(u));
  }
  const detailMode = (m) => (m === 'trace' ? { mode: 'trace', guide: true, numbers: true } : { mode: 'recall', guide: false });
  // Stop a drill on the detail pad (back to plain animation / trace / from memory).
  function detailPlain() {
    if (drill && drill.w === detailWriter) stopDrill();
    const head = $('#modal .drill-head');
    if (head) head.hidden = true;
  }
  function detailDrill() {
    const head = $('#modal .drill-head'), fbEl = $('#modal .fb');
    if (!head || !detailWriter) return;
    head.hidden = false;
    const fb = (cls, html) => { fbEl.className = 'fb ' + (cls || ''); fbEl.innerHTML = html || ''; };
    startDrill(detailWriter, detailWriter.ch, drillRounds(), head, fb, (r) => {
      fb(r.clean ? 'ok' : 'warn', `${r.clean ? '✓ Nice' : 'Done'} — <button class="btn link" data-act="d-drill">drill again</button>`);
    });
  }

  // =====================================================================
  // Writing drills: one character several times in a row, the guide fading each time
  // =====================================================================
  // trace: full guide and stroke numbers · faint: a faint guide · dots: only where each stroke starts
  // · memory: nothing. A memory round that isn't clean adds a dots round and another memory round (twice at most),
  // so a drill normally ends on a clean one.
  const DRILLS = {
    3: ['trace', 'dots', 'memory'],
    5: ['trace', 'faint', 'dots', 'memory', 'memory'],
    7: ['trace', 'faint', 'dots', 'memory', 'memory', 'memory', 'memory'],
  };
  const FIX_ROUNDS = ['trace', 'memory', 'memory']; // after a missed writing card
  const drillRounds = () => DRILLS[S.settings.drillLength] || DRILLS[5];
  const ROUND_LOAD = {
    trace: { mode: 'trace', guide: true, numbers: true },
    faint: { mode: 'trace', guide: 'faint' },
    dots: { mode: 'recall', guide: 'dots' },
    memory: { mode: 'recall', guide: false },
  };
  const ROUND_NAME = { trace: 'Trace', faint: 'Faint guide', dots: 'Start points only', memory: 'From memory' };
  const cleanWrite = (s) => s.hints === 0 && s.misses <= 1;
  const lenient = () => (S.settings.leniency === 'off' ? 'relaxed' : S.settings.leniency);
  const writePrompt = (u) => (scriptOf(u) === 'kanji' ? esc(info(u).meanings.slice(0, 2).join(', ')) : romaji(u));
  const DRILL_HEAD = '<div class="drill-title step-title"></div><div class="drill-row" role="img"></div>';
  function roundTitle(kind, u) {
    if (kind === 'trace') return `Trace <span class="kana">${esc(u)}</span> — follow the numbered strokes`;
    if (kind === 'faint') return 'Again, over the faint guide';
    if (kind === 'dots') return `Write <b>${writePrompt(u)}</b> — the dots show where each stroke starts`;
    return `From memory: write <b>${writePrompt(u)}</b>`;
  }

  let drill = null; // the drill in progress (one at a time)
  function stopDrill(d = drill) {
    if (!d) return;
    clearTimeout(d.timer);
    d.stopped = true;
    d.w.opts = d.prevOpts;
    if (drill === d) drill = null;
  }
  // Run a drill on an existing Writer, whose callbacks it borrows until it ends.
  // head: element holding DRILL_HEAD; fb(cls, html): feedback line; onDone({ clean, rounds }).
  function startDrill(w, u, rounds, head, fb, onDone, { showOrder = false } = {}) {
    stopDrill();
    const d = (drill = { w, u, rounds: rounds.slice(), results: [], i: 0, extra: 0, prevOpts: w.opts, stopped: false, timer: null });
    const title = $('.drill-title', head), row = $('.drill-row', head);
    const paintRow = (cur) => {
      row.innerHTML = d.rounds.map((k, j) => `<i class="${j < cur ? (d.results[j] ? 'ok' : 'shaky') : j === cur ? 'cur' : ''}" title="${ROUND_NAME[k]}"></i>`).join('');
      row.setAttribute('aria-label', `Round ${Math.min(cur + 1, d.rounds.length)} of ${d.rounds.length}`);
    };
    const round = () => {
      const kind = d.rounds[d.i];
      title.innerHTML = roundTitle(kind, u);
      paintRow(d.i);
      fb('', '');
      w.load(u, ROUND_LOAD[kind]);
      if (showOrder && d.i === 0) w.animate(1.1).then(() => { if (!d.stopped && d.i === 0 && !w.done) w.clearAnim(); });
    };
    w.opts = {
      leniency: lenient,
      onStroke: (r) => { if (!d.stopped) fb(r.ok ? '' : 'warn', r.ok ? '' : strokeMsg(r)); },
      onHint: (h) => { if (!d.stopped && h.auto) fb('warn', 'Follow the red stroke'); },
      // Putting the pen down during the pause after a round starts the next round straight away.
      onDownWhenDone: () => { if (d.advance) d.advance(); },
      onComplete: (s) => {
        if (d.stopped) return;
        const kind = d.rounds[d.i];
        const clean = cleanWrite(s);
        d.results[d.i] = clean;
        const retry = kind === 'memory' && !clean && d.extra < 2;
        if (retry) { d.rounds.splice(d.i + 1, 0, 'dots', 'memory'); d.extra++; }
        paintRow(d.i + 1);
        const last = d.i + 1 >= d.rounds.length;
        if (!last) fb(clean ? 'ok' : 'warn', retry ? 'Not quite — once more with the start points, then from memory' : clean ? '✓' : 'Done');
        const advance = () => {
          clearTimeout(d.timer);
          d.advance = null;
          if (d.stopped) return;
          if (last) { stopDrill(d); onDone({ clean, rounds: d.rounds.length }); return; }
          d.i++;
          round();
        };
        d.advance = last ? null : advance;
        d.timer = setTimeout(advance, retry ? 1300 : last ? 400 : 700);
      },
    };
    round();
    return d;
  }

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

  // Thin segmented bar of how many units are at each stage, plus the counts.
  function stageBar(us, noun) {
    const counts = [0, 0, 0, 0, 0];
    us.forEach((u) => counts[tierOf(u)]++);
    const segs = [1, 2, 3, 4].filter((t) => counts[t]).map((t) => {
      const tip = `${S.STAGES[t].name}: ${counts[t]} of ${us.length} ${noun}`;
      return `<i class="sseg t${t}" style="flex-grow:${counts[t]}" tabindex="0" data-tip="${tip}" aria-label="${tip}"></i>`;
    }).join('');
    const rest = counts[0] ? `<i class="sseg rest" style="flex-grow:${counts[0]}" tabindex="0" data-tip="New: ${counts[0]} ${noun} not learned yet" aria-label="New: ${counts[0]} ${noun} not learned yet"></i>` : '';
    return { bar: `<div class="sbar">${segs}${rest}</div>`, counts, learned: us.length - counts[0], known: counts[2] + counts[3] + counts[4] };
  }

  function openStats() {
    const now = Date.now();
    const all = Object.keys(K.info);
    const of = (...scs) => all.filter((u) => scs.includes(scriptOf(u)));
    const kana = of('hiragana', 'katakana'), kanji = of('kanji'), vocab = of('vocab');
    const learnedUnits = all.filter(S.isLearned);
    const mastered = learnedUnits.filter((u) => tierOf(u) === 4).length;
    const firstCard = (u) => S.card(u, 'read') || S.card(u, 'meaning');
    const isNew = (u) => S.isLearned(u) && (firstCard(u).at || 0) > now - 7 * DAY;
    const newOf = (us) => { const n = us.filter(isNew).length; return n ? ` · +${n} this week` : ''; };
    const nLearned = (us) => us.filter(S.isLearned).length;
    const days = S.days();
    let n7 = 0, ok7 = 0, total = 0, totalOk = 0;
    for (let i = 0; i < 7; i++) { const d = days[S.today(now - i * DAY)]; if (d) { n7 += d.n; ok7 += d.ok; } }
    for (const d of Object.values(days)) { total += d.n; totalOk += d.ok; }
    const streak = S.streak(), best = S.bestStreak();

    // Stage of everything, per script (thin segmented bars; the figures sit beside them).
    const stageRows = ['hiragana', 'katakana', 'kanji', 'vocab'].map((sc) => {
      const us = of(sc);
      const b = stageBar(us, SCRIPT_EN[sc].toLowerCase());
      return `<div class="srow2">
        <div class="s-name"><span class="kana">${SCRIPT_JA[sc]}</span> ${SCRIPT_EN[sc]}</div>
        ${b.bar}
        <div class="s-fig">${b.learned.toLocaleString()} / ${us.length.toLocaleString()} learned · ${b.counts[4]} mastered</div>
      </div>`;
    }).join('');

    // JLPT levels: kanji and words known per level. "Known" = past the first day (Learning or later).
    const kanaBar = stageBar(kana, 'kana');
    const lvRows = D.LEVELS.map((lv) => {
      const k = stageBar(D.byLevel.kanji[lv], `N${lv} kanji`), w = stageBar(D.byLevel.vocab[lv], `N${lv} words`);
      const nk = D.byLevel.kanji[lv].length, nw = D.byLevel.vocab[lv].length;
      return { lv, k, w, nk, nw, done: k.known >= 0.9 * nk && w.known >= 0.9 * nw };
    });
    const kanaDone = kanaBar.known >= 0.9 * kana.length;
    let reached = null;
    for (const r of lvRows) { if (kanaDone && r.done) reached = r.lv; else break; }
    const goal = lvRows.find((r) => r.lv === (reached ? reached - 1 : 5));
    const headline = reached
      ? `About <b>JLPT N${reached}</b> level · ≈ CEFR ${D.CEFR[reached]}${goal ? ` · working towards N${goal.lv}` : ''}`
      : `Working towards <b>JLPT N5</b> · ≈ CEFR A1${kanaDone ? '' : ' · kana first'}`;
    const levelTable = `
      <div class="lv-table">
        <div class="lv-row lv-kana"><div class="lv-name">Kana <small class="muted">before N5</small></div>
          <div class="lv-cell">${kanaBar.bar}<span class="s-fig">${kanaBar.known} / ${kana.length} known</span></div><div></div></div>
        ${lvRows.map((r) => `<div class="lv-row${goal && r.lv === goal.lv ? ' goal' : ''}">
          <div class="lv-name">N${r.lv} <small class="muted">≈ ${D.CEFR[r.lv]}</small></div>
          <div class="lv-cell">${r.k.bar}<span class="s-fig">kanji ${r.k.known} / ${r.nk}</span></div>
          <div class="lv-cell">${r.w.bar}<span class="s-fig">words ${r.w.known.toLocaleString()} / ${r.nw.toLocaleString()}</span></div>
        </div>`).join('')}
      </div>`;

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
    const weak = cards.filter((x) => x.card.ok + x.card.bad >= 3 && x.card.bad > 0 && K.info[x.unit])
      .sort((a, b) => a.card.ok / (a.card.ok + a.card.bad) - b.card.ok / (b.card.ok + b.card.bad) || b.card.bad - a.card.bad)
      .slice(0, 8);

    modal(`
      <h2>Stats</h2>
      <div class="tiles">
        ${tile('Kana learned', nLearned(kana), `of ${kana.length}${newOf(kana)}`)}
        ${tile('Kanji learned', nLearned(kanji), `of ${kanji.length.toLocaleString()} JLPT kanji${newOf(kanji)}`)}
        ${tile('Words learned', nLearned(vocab), `of ${vocab.length.toLocaleString()} JLPT words${newOf(vocab)}`)}
        ${tile('Mastered', mastered, 'kana, kanji and words')}
        ${tile('Streak', `${streak} day${streak === 1 ? '' : 's'}`, `best ${best}`)}
        ${tile('Accuracy, 7 days', pct(ok7, n7), `${n7} answers · ${total} all time`)}
      </div>

      <h3>Language level</h3>
      <p class="lv-head">${headline}</p>
      ${levelTable}
      <p class="muted small-note">Known = past the first day of reviews (Learning or later); a level counts once you know 90% of its kanji and words.
        Approximate: JLPT word and kanji lists are unofficial (Jonathan Waller's), and the official CEFR reference levels
        (<a href="https://www.jlpt.jp/e/about/cefr_reference.html" target="_blank" rel="noopener">jlpt.jp</a>) come from test scores:
        N3 can be A2 or B1, N2 B1 or B2, N1 B2 or C1. No JLPT level matches C2. Speaking and writing aren't covered.</p>

      <h3>By stage</h3>
      <div class="stage-rows">${stageRows}</div>
      <div class="legend">${[1, 2, 3, 4].map((t) => `<span><i class="t${t}"></i>${S.STAGES[t].name}</span>`).join('')}<span><i class="rest"></i>New</span></div>
      <p class="muted small-note">Seen: first day (reviews after 15 min, 1 h, 4 h, 8 h) · Learning: days · Familiar: weeks · Mastered: months.
        Each counts at the stage of its weakest card (e.g. reading, meaning, writing).</p>

      <h3>Answers per day <span class="muted">· last 30 days · ${pct(totalOk, total)} correct overall</span></h3>
      ${columns(act, { title: 'Answers per day, last 30 days', axisLabels: [act[0].label, act[15].label, 'Today'], tableHead: ['Day', 'Answers'] })}

      <h3>Reviews coming up <span class="muted">· ${dueNow} due now · ${nextHour} more in the next hour</span></h3>
      ${columns(fc, { title: 'Reviews coming up, next 7 days', axisLabels: fc.map((c) => c.label), tableHead: ['Day', 'Reviews'] })}

      <h3>To work on</h3>
      ${weak.length ? `<table class="weak"><thead><tr><th></th><th>Card</th><th>Correct</th><th>Stage</th></tr></thead><tbody>
        ${weak.map((x) => `<tr>
          <td><button class="chip kana" data-act="detail" data-u="${esc(x.unit)}">${esc(D.display(x.unit))}</button></td>
          <td>${esc(D.label(x.unit))} · ${SKILL_NAME[x.skill] || x.skill}</td>
          <td>${pct(x.card.ok, x.card.ok + x.card.bad)} <span class="muted">(${x.card.bad} missed)</span></td>
          <td>${S.STAGES[S.stageOf(x.card.level)].name}</td></tr>`).join('')}
      </tbody></table>` : '<p class="muted">Nothing yet: cards you miss often will show up here.</p>'}
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
    const deck = isDeck(sc);
    const groups = K.groups.filter((g) => g.script === sc && (!deck || g.level === deckLevel(sc)));
    const intro = sc === 'kanji'
      ? 'Five kanji per lesson, most common first: meet each one (meanings, readings, example words, stroke order), trace and write it, then a quiz.'
      : sc === 'vocab' ? 'Ten words per lesson, ordered so words with the kanji you learn first come first. Meet each word, then a quiz on meanings and readings.'
        : 'Work through them in order. Each lesson introduces a few characters, has you trace and write them, then quizzes you.';
    modal(`
      <h2>${SCRIPT_JA[sc]}${deck ? ` N${deckLevel(sc)}` : ''} lessons</h2>
      <p class="muted">${intro} You can re-run any lesson as a refresher.${deck ? ' Change level with the N5–N1 buttons above the chart.' : ''}</p>
      <ol class="lessons">${groups.map((g) => {
        const n = g.kana.filter(S.isLearned).length;
        const st = n === g.kana.length ? '<span class="ok">✓</span>' : n ? `${n}/${g.kana.length}` : '';
        return `<li><button data-act="learn-group" data-g="${g.id}" class="${n === g.kana.length ? 'is-done' : ''}">
          <span class="l-label">${esc(g.label)}${g.write ? '' : ' <small class="muted">(reading)</small>'}</span>
          <span class="kana l-kana">${esc(g.kana.map(D.display).join(' '))}</span><span class="l-st">${st}</span></button></li>`;
      }).join('')}</ol>`);
  }

  // =====================================================================
  // Custom set: pick any kana, then learn them as a lesson or drill them in a workout.
  // The pick is kept per script (in this device's settings) for next time.
  // =====================================================================
  let customSel = null; // characters picked, while the picker is open
  const teachOrder = (sc) => K.groups.filter((g) => g.script === sc).flatMap((g) => g.kana);
  const customPick = (sc) => teachOrder(sc).filter((u) => customSel.has(u));
  function openCustom() {
    const sc = S.settings.script;
    customSel = new Set(((S.settings.customSet || {})[sc] || []).filter((u) => info(u)));
    const groups = K.groups.filter((g) => g.script === sc);
    const chart = K.chart[sc].map((sec) => {
      const cells = sec.rows.map((row) => row.map((u) => (u
        ? `<button class="cell t${tierOf(u)}" data-act="cs-cell" data-u="${u}" aria-pressed="false"><span class="k">${u}</span><span class="r">${romaji(u)}</span></button>`
        : '<span class="cell empty"></span>')).join('')).join('');
      return `<section class="chart-sec"><h3>${sec.label}</h3><div class="grid ${sec.cols === 3 ? 'combo' : ''}">${cells}</div></section>`;
    }).join('');
    modal(`
      <h2>Custom set <span class="kana muted">${SCRIPT_JA[sc]}</span></h2>
      <p class="muted">Pick the characters you want to work on. <b>Lesson</b> goes through them like Learn next: meet each one,
        a writing drill, then a quiz. <b>Workout</b> is just the writing drills, then each one once more from memory.</p>
      <div class="cs-picks" role="group" aria-label="Quick picks">
        ${groups.map((g) => `<button class="pill btn-pill" data-act="cs-group" data-g="${g.id}" aria-pressed="false">${esc(g.label)}</button>`).join('')}
        <button class="pill btn-pill" data-act="cs-weak" ${writeCards(sc).length ? '' : 'disabled'}
          title="Your ${WORKOUT_SIZE} most-missed characters when writing">Weakest ${WORKOUT_SIZE} to write</button>
      </div>
      ${chart}
      <div class="cs-bar">
        <span class="cs-count"></span>
        <button class="btn link" data-act="cs-clear">Clear</button>
        <span class="cs-go">
          <button class="btn" data-act="cs-workout">Workout</button>
          <button class="btn primary" data-act="cs-lesson">Lesson</button>
        </span>
      </div>`, 'custom-sheet');
    paintCustom();
  }
  function paintCustom() {
    const sc = S.settings.script;
    const pick = customPick(sc);
    S.set('customSet', { ...S.settings.customSet, [sc]: pick });
    $$('#modal [data-act="cs-cell"]').forEach((b) => {
      const on = customSel.has(b.dataset.u);
      b.classList.toggle('sel', on);
      b.setAttribute('aria-pressed', on);
    });
    $$('#modal [data-act="cs-group"]').forEach((b) => {
      const g = K.groups.find((x) => x.id === b.dataset.g);
      const n = g.kana.filter((u) => customSel.has(u)).length;
      b.classList.toggle('on', n === g.kana.length);
      b.classList.toggle('some', n > 0 && n < g.kana.length);
      b.setAttribute('aria-pressed', n === g.kana.length);
    });
    const writable = pick.filter(hasStrokes).length;
    $('#modal .cs-count').innerHTML = pick.length ? `<b>${pick.length}</b> picked` : 'Nothing picked yet';
    $('#modal [data-act="cs-clear"]').hidden = !pick.length;
    $('#modal [data-act="cs-lesson"]').disabled = !pick.length;
    const wo = $('#modal [data-act="cs-workout"]');
    wo.disabled = !writeOn() || !writable;
    wo.title = !writeOn() ? 'Writing is turned off in Settings'
      : pick.length && !writable ? 'Combinations are written as two characters, so they aren’t drilled' : '';
  }
  function customAction(b) {
    const sc = S.settings.script;
    const act = b.dataset.act;
    if (act === 'cs-cell') {
      const u = b.dataset.u;
      if (customSel.has(u)) customSel.delete(u); else customSel.add(u);
    } else if (act === 'cs-group') {
      const g = K.groups.find((x) => x.id === b.dataset.g);
      const all = g.kana.every((u) => customSel.has(u));
      g.kana.forEach((u) => { if (all) customSel.delete(u); else customSel.add(u); });
    } else if (act === 'cs-weak') {
      customSel = new Set(weakestWritten(sc, WORKOUT_SIZE));
    } else if (act === 'cs-clear') {
      customSel.clear();
    } else if (act === 'cs-lesson') {
      return startLesson({ id: 'custom', script: sc, label: 'Custom set', kana: customPick(sc), write: true, custom: true });
    } else if (act === 'cs-workout') {
      return startWorkout(customPick(sc));
    }
    paintCustom();
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
        <label class="srow"><span>Voice<small>Best voices on this device first</small></span>${voiceSelectHTML()}</label>
        <label class="srow"><span>Speaking speed</span>
          <select data-set="speechRate">${opt('speechRate', '0.7', 'Slow')}${opt('speechRate', '0.85', 'Normal')}${opt('speechRate', '1', 'Natural')}</select></label>
        <div class="srow voice-row"><small>${voiceTip()}</small><button class="btn ghost" data-act="voice-test">▶ Test</button></div>
        <label class="srow"><span>Writing practice<small>Trace &amp; write in lessons, and add writing cards to reviews</small></span>${chk('writeReviews')}</label>
        <label class="srow"><span>Writing drill<small>How many times you write each character in lessons, workouts and drills, the guide fading each time</small></span>
          <select data-set="drillLength">${opt('drillLength', '3', '3 times')}${opt('drillLength', '5', '5 times')}${opt('drillLength', '7', '7 times')}</select></label>
        <label class="srow"><span>Reading answers<small>Type romaji, or tap one of four choices (handy on iPad)</small></span>
          <select data-set="answerMode">${opt('answerMode', 'type', 'Type')}${opt('answerMode', 'choose', 'Choose')}</select></label>
        <label class="srow"><span>Stroke checking<small>How closely each stroke must match. “Off” = draw freely, then compare and grade yourself</small></span>
          <select data-set="leniency">${opt('leniency', 'strict', 'Strict')}${opt('leniency', 'normal', 'Normal')}${opt('leniency', 'relaxed', 'Relaxed')}${opt('leniency', 'off', 'Off (self-check)')}</select></label>
        <label class="srow"><span>Vary fonts when reading<small>Mincho, rounded, handwritten… builds real-world recognition</small></span>${chk('varyFont')}</label>
        <label class="srow"><span>Show romaji, meanings and readings on charts</span>${chk('chartRomaji')}</label>
      </div>
      <p class="muted small-note">Settings apply to this device only. Progress is shared between devices when you’re signed in.</p>
      <div class="btns left"><button class="btn ghost" data-act="sources">About &amp; data sources</button></div>
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

  const VOICE_SAMPLE = 'こんにちは。日本語を勉強しています。';

  function openSources() {
    modal(`
      <h2>About &amp; data sources</h2>
      <p>Kana Dojo is a small app for learning to read and write Japanese. It uses these open datasets:</p>
      <ul class="sources">
        <li><b>Stroke order</b> (kana and kanji): <a href="https://kanjivg.tagaini.net" target="_blank" rel="noopener">KanjiVG</a>
          © 2009–2026 Ulrich Apel, <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener">CC BY-SA 3.0</a>.</li>
        <li><b>Kanji meanings and readings</b>: this app uses the
          <a href="https://www.edrdg.org/wiki/index.php/KANJIDIC_Project" target="_blank" rel="noopener">KANJIDIC</a> dictionary file.
          These files are the property of the <a href="https://www.edrdg.org/" target="_blank" rel="noopener">Electronic Dictionary Research and Development Group</a>,
          and are used in conformance with the Group's <a href="https://www.edrdg.org/edrdg/licence.html" target="_blank" rel="noopener">licence</a> (CC BY-SA 4.0).</li>
        <li><b>JLPT levels and vocabulary</b>: Jonathan Waller's JLPT lists (CC BY), via
          <a href="https://github.com/Bluskyo/JLPT_Vocabulary" target="_blank" rel="noopener">Bluskyo/JLPT_Vocabulary</a> (kanji levels) and
          <a href="https://github.com/jamsinclair/open-anki-jlpt-decks" target="_blank" rel="noopener">jamsinclair/open-anki-jlpt-decks</a> (words). Unofficial:
          the JLPT has not published lists since 2010.</li>
        <li><b>JLPT ↔ CEFR</b>: approximate, based on the official
          <a href="https://www.jlpt.jp/e/about/cefr_reference.html" target="_blank" rel="noopener">CEFR reference levels</a> (jlpt.jp).</li>
      </ul>`);
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
      case 'level': S.set(levelKey(S.settings.script), Number(b.dataset.l)); renderHome(); break;
      case 'sources': openSources(); break;
      case 'voice-test': speak(VOICE_SAMPLE, true); break;
      case 'review': startReview(); break;
      case 'practice': startPractice(b.dataset.skill); break;
      case 'workout': startWorkout(); break;
      case 'words': startWords(); break;
      case 'learn-group': startLesson(K.groups.find((g) => g.id === b.dataset.g)); break;
      case 'lessons': openLessons(); break;
      case 'custom': openCustom(); break;
      case 'cs-cell': case 'cs-group': case 'cs-weak': case 'cs-clear': case 'cs-lesson': case 'cs-workout': customAction(b); break;
      case 'stats': openStats(); break;
      case 'settings': openSettings(); break;
      case 'detail': openDetail(b.dataset.u); break;
      case 'm-close': closeModal(); break;
      case 'home': renderHome(); break;
      case 'again': if (lastAgain) lastAgain(); break;
      case 'exit': exitSession(); break;
      case 'speak': speak(b.dataset.t, true); break;
      // session
      case 'choose': resolve(b.dataset.val === sess.cur.answer, { chosen: b.dataset.val }); break;
      case 'continue': cont(); break;
      case 'override': if (sess && sess.pending) { sess.pending.correct = true; cont(); } break;
      case 'hint': (drill ? drill.w : sess ? sess.writer : lesson && lesson.writer)?.hint(); break;
      case 'dr-show':
        if (drill) {
          const d = drill;
          d.w.animate(1).then(() => setTimeout(() => { if (!d.stopped) d.w.clearAnim(); }, 400));
        }
        break;
      case 'reveal': if (sess && sess.writer && !sess.pending) resolve(false, { revealed: true, shown: sess.writer.reveal() }); break;
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
      // detail
      case 'd-anim': detailPlain(); detailWriter.load(detailWriter.ch, { mode: 'view', numbers: true }); detailWriter.animate(0.8); break;
      case 'd-trace': detailPlain(); detailWriter.load(detailWriter.ch, detailMode('trace')); $('#modal .fb').textContent = 'Trace over the guide'; break;
      case 'd-recall': detailPlain(); detailWriter.load(detailWriter.ch, detailMode('recall')); $('#modal .fb').textContent = 'Write it from memory'; break;
      case 'd-drill': detailDrill(); break;
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
    if (k === 'voice' || k === 'speechRate') { pickVoice(); speak(VOICE_SAMPLE, true); }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!modalRoot.hidden) closeModal();
      else if (sess || lesson) exitSession();
      return;
    }
    if (!modalRoot.hidden || e.metaKey || e.ctrlKey) return;
    const inInput = e.target.tagName === 'INPUT';
    if (sess && sess.pending && !sess.pending.fixing && !inInput && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); cont(); return; }
    if (sess && !sess.pending && /^[1-4]$/.test(e.key) && !inInput && $$('.choice').length) {
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
  window.KanaDojo = { renderHome, startLesson, startReview, startPractice, startWords, startWorkout, openDetail, get drill() { return drill; }, get sess() { return sess; }, get lesson() { return lesson; } };
})();
