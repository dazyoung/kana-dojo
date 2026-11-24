// Romaji <-> kana helpers used to check typed answers.
(function () {
  const info = () => window.KANA.info;
  const SMALL_Y = 'ゃゅょャュョ';
  const VOWEL_KANA = { a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お' };

  const clean = (s) => s.toLowerCase().normalize('NFKC').replace(/[\s'’.]/g, '');

  // Split a kana word into units, keeping combos like きゃ together.
  function units(word) {
    const out = [];
    for (const ch of word) {
      if (SMALL_Y.includes(ch) && out.length) out[out.length - 1] += ch;
      else out.push(ch);
    }
    return out;
  }

  function toHiragana(s) {
    return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  }

  // Kana word -> Hepburn romaji (ん as "n", っ doubles, ー repeats the vowel).
  function kanaToRomaji(word) {
    let out = '';
    let dbl = false;
    for (const u of units(word)) {
      if (u === 'っ' || u === 'ッ') { dbl = true; continue; }
      if (u === 'ー') { out += out.slice(-1); continue; }
      const r = info()[u] ? info()[u].romaji[0] : u;
      out += dbl ? (r.startsWith('ch') ? 't' : r[0]) + r : r;
      dbl = false;
    }
    return out;
  }

  // Romaji -> hiragana, IME style (greedy, handles nn / double consonants).
  let table = null;
  function buildTable() {
    table = {};
    for (const [ch, v] of Object.entries(info())) {
      if (v.script !== 'hiragana') continue;
      for (const r of v.romaji) if (!(r in table) && ch !== 'ん' && ch !== 'を') table[r] = ch;
    }
    table.wo = 'を';
  }
  function romajiToKana(s) {
    if (!table) buildTable();
    let out = '';
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const next = s[i + 1];
      if (c === '-') { out += 'ー'; i++; continue; }
      if (c === 'n') {
        if (next === 'n') { out += 'ん'; i += 2; continue; }
        if (!next || !'aiueoy'.includes(next)) { out += 'ん'; i++; continue; }
      }
      if (c === next && /[bcdfghjkmpqrstvwxz]/.test(c)) { out += 'っ'; i++; continue; }
      if (c === 't' && s.startsWith('ch', i + 1)) { out += 'っ'; i++; continue; }
      let hit = false;
      for (let len = 3; len >= 1; len--) {
        const k = s.substr(i, len);
        if (table[k]) { out += table[k]; i += len; hit = true; break; }
      }
      if (!hit) { out += c; i++; }
    }
    return out;
  }

  function normKana(word) {
    let h = toHiragana(word).replace(/ぢ/g, 'じ').replace(/づ/g, 'ず').replace(/を/g, 'お');
    let out = '';
    for (const ch of h) {
      if (ch === 'ー' && out) {
        const prev = units(out).pop();
        const r = info()[prev] ? info()[prev].romaji[0] : 'a';
        out += VOWEL_KANA[r.slice(-1)] || '';
      } else out += ch;
    }
    return out;
  }

  // Single kana / combo card.
  function checkUnit(unit, input) {
    const a = clean(input);
    return info()[unit].romaji.includes(a);
  }

  // Whole word.
  function checkWord(word, input) {
    const a = clean(input);
    if (!a) return false;
    const hep = kanaToRomaji(word);
    if (a === hep || a.replace(/-/g, '') === hep) return true;
    return normKana(romajiToKana(a)) === normKana(word);
  }

  window.Romaji = { units, kanaToRomaji, romajiToKana, checkUnit, checkWord, clean };
})();
