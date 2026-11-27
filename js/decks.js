// Kanji and vocabulary decks (JLPT N5–N1).
// Adds every kanji in data/kanji.js and every word in data/vocab.js to KANA.info and KANA.groups,
// and provides answer checking, multiple-choice options and display text for their cards.
//
// Units and their cards:
//   kana  "あ"              read, write
//   kanji "日"              meaning, reading, write
//   word  "w:今日:きょう"   meaning, reading
(function () {
  const K = window.KANA, R = window.Romaji;
  const KJ = window.KANJI, V = window.VOCAB;
  const LEVELS = [5, 4, 3, 2, 1];
  const DATA_VERSION = 6; // matches the ?v= in index.html, so stroke files are re-fetched after updates
  // JLPT → CEFR, approximate. Official reference levels (jlpt.jp, from Dec 2025) depend on the test
  // score: N5 A1, N4 A2, N3 A2/B1, N2 B1/B2, N1 B2/C1. No JLPT level corresponds to C2.
  const CEFR = { 5: 'A1', 4: 'A2', 3: 'A2–B1', 2: 'B1–B2', 1: 'B2–C1' };
  const KANJI_LESSON = 5, WORD_LESSON = 10;

  const info = (u) => K.info[u];
  const isKanji = (u) => !!info(u) && info(u).script === 'kanji';
  const isWord = (u) => !!info(u) && info(u).script === 'vocab';
  const wordId = (word, reading) => `w:${word}:${reading}`;
  const unique = (a) => [...new Set(a)];
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- build the decks ----------
  const byLevel = { kanji: {}, vocab: {} };
  for (const lv of LEVELS) {
    const ks = KJ ? [...KJ.levels[lv]] : [];
    byLevel.kanji[lv] = ks;
    for (const k of ks) {
      const [level, strokes, freq, meanings, on, kun] = KJ.info[k];
      K.info[k] = { script: 'kanji', level, strokes, freq, meanings, on, kun, write: true };
    }
    for (let i = 0; i < ks.length; i += KANJI_LESSON) {
      const n = i / KANJI_LESSON + 1;
      K.groups.push({ id: `k${lv}-${n}`, script: 'kanji', level: lv, label: `N${lv} kanji ${n}`, kana: ks.slice(i, i + KANJI_LESSON), write: true });
    }

    const ids = [];
    for (const [word, reading, meaning] of (V && V[lv]) || []) {
      const id = wordId(word, reading);
      if (K.info[id]) continue;
      K.info[id] = { script: 'vocab', level: lv, word, reading, meaning };
      ids.push(id);
    }
    byLevel.vocab[lv] = ids;
    for (let i = 0; i < ids.length; i += WORD_LESSON) {
      const n = i / WORD_LESSON + 1;
      K.groups.push({ id: `v${lv}-${n}`, script: 'vocab', level: lv, label: `N${lv} words ${n}`, kana: ids.slice(i, i + WORD_LESSON), write: false });
    }
  }

  // ---------- display ----------
  // The text a unit is shown as (a word id shows its word).
  const display = (u) => (isWord(u) ? info(u).word : u);
  const kunText = (r) => r.replace(/^-|-$/g, '').replace(/\.(.+)$/, '($1)'); // まな.ぶ → まな(ぶ)
  function readingsText(u) {
    const i = info(u);
    if (isWord(u)) return i.reading;
    return [i.on.join('、'), i.kun.map(kunText).join('、')].filter(Boolean).join(' · ');
  }
  const meaningsOf = (u) => (isWord(u)
    ? info(u).meaning.split(/[;,]\s*/).map((m) => m.trim()).filter(Boolean)
    : info(u).meanings);
  const meaningText = (u) => (isWord(u) ? info(u).meaning : info(u).meanings.join(', '));
  // Short label: romaji for kana, the main meaning for kanji, "word (reading)" for words.
  function label(u) {
    const i = info(u);
    if (!i) return u;
    if (i.script === 'kanji') return i.meanings[0] || '';
    if (i.script === 'vocab') return `${i.reading} · ${meaningsOf(u)[0] || ''}`;
    return i.romaji[0];
  }
  // A short meaning for chart cells: the first meaning if it's short, otherwise the shortest of the
  // first few, without notes in brackets ("put up (a notice)" → "put up").
  function shortMeaning(u) {
    const ms = (info(u).meanings || []).map((m) => m.replace(/\s*\([^)]*\)/g, '').trim()).filter(Boolean);
    if (!ms.length) return '';
    if (ms[0].length <= 12) return ms[0];
    return ms.slice(0, 4).filter((m) => m.length <= 12).sort((a, b) => a.length - b.length)[0] || ms[0];
  }
  // What to say aloud: the word's reading, or a kanji's main reading.
  function speakText(u) {
    const i = info(u);
    if (!i) return u;
    if (i.script === 'vocab') return i.reading;
    if (i.script === 'kanji') return R.toHiragana((i.kun[0] || i.on[0] || u).replace(/[.-]/g, ''));
    return u;
  }

  // ---------- answer checking ----------
  // All accepted readings, in hiragana. Kun readings count with or without their okurigana.
  function readingsOf(u) {
    const i = info(u);
    if (isWord(u)) return [i.reading.replace(/～/g, '')];
    const out = i.on.map(R.toHiragana);
    for (const k of i.kun) {
      const r = k.replace(/-/g, '');
      out.push(r.replace('.', ''));
      if (r.includes('.')) out.push(r.split('.')[0]);
    }
    return unique(out.filter(Boolean));
  }
  const checkReading = (u, input) => {
    const v = input.replace(/[~～\s]/g, '');
    return !!v && readingsOf(u).some((r) => R.checkWord(r, v));
  };

  const normMeaning = (s) => s.toLowerCase().normalize('NFKC')
    .replace(/\([^)]*\)/g, ' ').replace(/^\s*(to|a|an|the)\s+/, '').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[b.length];
  }
  // Any listed meaning counts. On submit (`final`) small typos are forgiven too.
  function checkMeaning(u, input, final) {
    const a = normMeaning(input);
    if (!a) return false;
    return meaningsOf(u).map(normMeaning).some((m) => m === a ||
      (final && a.length >= 4 && editDistance(a, m) <= (a.length >= 8 ? 2 : 1)));
  }

  // ---------- multiple choice ----------
  // Distractors come from the same deck, nearby levels first, never sharing an answer.
  function pool(u) {
    const i = info(u);
    const same = (byLevel[i.script][i.level] || []).filter((x) => x !== u);
    const near = LEVELS.filter((lv) => Math.abs(lv - i.level) === 1).flatMap((lv) => byLevel[i.script][lv] || []);
    return [...shuffle(same.slice()), ...shuffle(near)];
  }
  function choices(u, answer, valuesOf) {
    const taken = new Set(valuesOf(u).map((v) => v.toLowerCase()));
    const out = [answer];
    for (const x of pool(u)) {
      if (out.length >= 4) break;
      const v = valuesOf(x)[0];
      if (v && !taken.has(v.toLowerCase())) { taken.add(v.toLowerCase()); out.push(v); }
    }
    return { answer, options: shuffle(out) };
  }
  const meaningChoices = (u) => choices(u, meaningsOf(u)[0], meaningsOf);
  const readingChoices = (u) => {
    const rs = readingsOf(u);
    const main = isWord(u) ? rs[0] : (info(u).on[0] ? R.toHiragana(info(u).on[0]) : rs[0]);
    return choices(u, main, readingsOf);
  };

  // ---------- example words for a kanji ----------
  let wordsByKanji = null;
  function examples(k, n = 6) {
    if (!wordsByKanji) {
      wordsByKanji = {};
      for (const lv of LEVELS) for (const id of byLevel.vocab[lv]) {
        for (const c of unique([...info(id).word])) (wordsByKanji[c] || (wordsByKanji[c] = [])).push(id);
      }
    }
    return (wordsByKanji[k] || []).slice(0, n);
  }
  const kanjiIn = (u) => unique([...display(u)].filter((c) => isKanji(c)));

  // ---------- stroke data, loaded per JLPT level when first needed ----------
  const loading = {};
  function loadStrokes(units) {
    const lvs = unique(units.filter((u) => isKanji(u) && !(window.STROKES && window.STROKES[u])).map((u) => info(u).level));
    return Promise.all(lvs.map((lv) => loading[lv] || (loading[lv] = new Promise((done) => {
      const s = document.createElement('script');
      s.src = `data/strokes-n${lv}.js?v=${DATA_VERSION}`;
      s.onload = done;
      s.onerror = () => { delete loading[lv]; done(); };
      document.head.appendChild(s);
    }))));
  }

  window.Decks = {
    LEVELS, CEFR, byLevel, isKanji, isWord, wordId, display, label, shortMeaning, speakText,
    readingsOf, readingsText, meaningsOf, meaningText, checkReading, checkMeaning,
    meaningChoices, readingChoices, examples, kanjiIn, loadStrokes,
  };
})();
