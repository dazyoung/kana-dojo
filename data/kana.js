// Kana tables, lesson groups and practice words.
(function () {
  // [hiragana, katakana, romaji answers (first = shown), write-prompt note]
  const ROWS = {
    a: [['あ', 'ア', ['a']], ['い', 'イ', ['i']], ['う', 'ウ', ['u']], ['え', 'エ', ['e']], ['お', 'オ', ['o']]],
    k: [['か', 'カ', ['ka']], ['き', 'キ', ['ki']], ['く', 'ク', ['ku']], ['け', 'ケ', ['ke']], ['こ', 'コ', ['ko']]],
    s: [['さ', 'サ', ['sa']], ['し', 'シ', ['shi', 'si']], ['す', 'ス', ['su']], ['せ', 'セ', ['se']], ['そ', 'ソ', ['so']]],
    t: [['た', 'タ', ['ta']], ['ち', 'チ', ['chi', 'ti']], ['つ', 'ツ', ['tsu', 'tu']], ['て', 'テ', ['te']], ['と', 'ト', ['to']]],
    n: [['な', 'ナ', ['na']], ['に', 'ニ', ['ni']], ['ぬ', 'ヌ', ['nu']], ['ね', 'ネ', ['ne']], ['の', 'ノ', ['no']]],
    h: [['は', 'ハ', ['ha']], ['ひ', 'ヒ', ['hi']], ['ふ', 'フ', ['fu', 'hu']], ['へ', 'ヘ', ['he']], ['ほ', 'ホ', ['ho']]],
    m: [['ま', 'マ', ['ma']], ['み', 'ミ', ['mi']], ['む', 'ム', ['mu']], ['め', 'メ', ['me']], ['も', 'モ', ['mo']]],
    y: [['や', 'ヤ', ['ya']], null, ['ゆ', 'ユ', ['yu']], null, ['よ', 'ヨ', ['yo']]],
    r: [['ら', 'ラ', ['ra']], ['り', 'リ', ['ri']], ['る', 'ル', ['ru']], ['れ', 'レ', ['re']], ['ろ', 'ロ', ['ro']]],
    w: [['わ', 'ワ', ['wa']], null, null, null, ['を', 'ヲ', ['wo', 'o'], 'the particle "o"']],
    nn: [['ん', 'ン', ['n', 'nn']], null, null, null, null],
    g: [['が', 'ガ', ['ga']], ['ぎ', 'ギ', ['gi']], ['ぐ', 'グ', ['gu']], ['げ', 'ゲ', ['ge']], ['ご', 'ゴ', ['go']]],
    z: [['ざ', 'ザ', ['za']], ['じ', 'ジ', ['ji', 'zi'], 'shi + ゛'], ['ず', 'ズ', ['zu'], 'su + ゛'], ['ぜ', 'ゼ', ['ze']], ['ぞ', 'ゾ', ['zo']]],
    d: [['だ', 'ダ', ['da']], ['ぢ', 'ヂ', ['ji', 'di', 'zi'], 'chi + ゛ (rare)'], ['づ', 'ヅ', ['zu', 'du'], 'tsu + ゛ (rare)'], ['で', 'デ', ['de']], ['ど', 'ド', ['do']]],
    b: [['ば', 'バ', ['ba']], ['び', 'ビ', ['bi']], ['ぶ', 'ブ', ['bu']], ['べ', 'ベ', ['be']], ['ぼ', 'ボ', ['bo']]],
    p: [['ぱ', 'パ', ['pa']], ['ぴ', 'ピ', ['pi']], ['ぷ', 'プ', ['pu']], ['ぺ', 'ペ', ['pe']], ['ぽ', 'ポ', ['po']]],
  };

  // Yoon (combined) sounds: [hira base, kata base, romaji for ya/yu/yo]
  const YOON = {
    ky: ['き', 'キ', [['kya'], ['kyu'], ['kyo']]],
    sh: ['し', 'シ', [['sha', 'sya'], ['shu', 'syu'], ['sho', 'syo']]],
    ch: ['ち', 'チ', [['cha', 'tya', 'cya'], ['chu', 'tyu', 'cyu'], ['cho', 'tyo', 'cyo']]],
    ny: ['に', 'ニ', [['nya'], ['nyu'], ['nyo']]],
    hy: ['ひ', 'ヒ', [['hya'], ['hyu'], ['hyo']]],
    my: ['み', 'ミ', [['mya'], ['myu'], ['myo']]],
    ry: ['り', 'リ', [['rya'], ['ryu'], ['ryo']]],
    gy: ['ぎ', 'ギ', [['gya'], ['gyu'], ['gyo']]],
    j: ['じ', 'ジ', [['ja', 'jya', 'zya'], ['ju', 'jyu', 'zyu'], ['jo', 'jyo', 'zyo']]],
    by: ['び', 'ビ', [['bya'], ['byu'], ['byo']]],
    py: ['ぴ', 'ピ', [['pya'], ['pyu'], ['pyo']]],
  };
  const SMALL = { h: ['ゃ', 'ゅ', 'ょ'], k: ['ャ', 'ュ', 'ョ'] };

  const info = {};   // char -> { romaji: [...], note, script, write }
  const groups = []; // lesson groups in teaching order
  const chart = { hiragana: [], katakana: [] }; // rows of 5 cells (char or null) with section labels

  const LESSONS = [
    ['a', 'Vowels', ['a']], ['k', 'K row', ['k']], ['s', 'S row', ['s']], ['t', 'T row', ['t']],
    ['n', 'N row', ['n']], ['h', 'H row', ['h']], ['m', 'M row', ['m']], ['y', 'Y row', ['y']],
    ['r', 'R row', ['r']], ['w', 'W row + n', ['w', 'nn']],
    ['gz', 'Dakuten G · Z', ['g', 'z']], ['db', 'Dakuten D · B', ['d', 'b']], ['p', 'Handakuten P', ['p']],
  ];
  const YOON_LESSONS = [
    ['y1', 'Combos K · S · CH', ['ky', 'sh', 'ch']],
    ['y2', 'Combos N · H · M · R', ['ny', 'hy', 'my', 'ry']],
    ['y3', 'Combos G · J · B · P', ['gy', 'j', 'by', 'py']],
  ];

  ['hiragana', 'katakana'].forEach((script, si) => {
    const pre = script[0];
    LESSONS.forEach(([id, label, rows]) => {
      const kana = [];
      rows.forEach((r) => ROWS[r].forEach((cell) => {
        if (!cell) return;
        const ch = cell[si];
        info[ch] = { romaji: cell[2], note: cell[3] || '', script, write: true };
        kana.push(ch);
      }));
      groups.push({ id: pre + '-' + id, script, label, kana, write: true });
    });
    YOON_LESSONS.forEach(([id, label, keys]) => {
      const kana = [];
      keys.forEach((k) => {
        const [hb, kb, rs] = YOON[k];
        const base = si === 0 ? hb : kb;
        SMALL[pre].forEach((sm, i) => {
          const ch = base + sm;
          info[ch] = { romaji: rs[i], note: '', script, write: false };
          kana.push(ch);
        });
      });
      groups.push({ id: pre + '-' + id, script, label, kana, write: false });
    });

    const rowsOf = (keys) => keys.map((k) => ROWS[k].map((c) => (c ? c[si] : null)));
    chart[script] = [
      { label: 'Basic', rows: rowsOf(['a', 'k', 's', 't', 'n', 'h', 'm', 'y', 'r', 'w', 'nn']) },
      { label: 'Dakuten ゛ and handakuten ゜', rows: rowsOf(['g', 'z', 'd', 'b', 'p']) },
      {
        label: 'Combinations (yōon)', cols: 3,
        rows: Object.values(YOON).map(([hb, kb]) => SMALL[pre].map((sm) => (si === 0 ? hb : kb) + sm)),
      },
    ];
  });

  // Practice words. Only shown once every kana in the word has been learned.
  const WORDS = [
    ['あい', 'love'], ['あお', 'blue'], ['あおい', 'blue (adj.)'], ['あか', 'red'], ['あかい', 'red (adj.)'],
    ['あき', 'autumn'], ['あさ', 'morning'], ['あし', 'leg, foot'], ['あたま', 'head'], ['あめ', 'rain; candy'],
    ['いえ', 'house'], ['いぬ', 'dog'], ['いけ', 'pond'], ['いす', 'chair'], ['いち', 'one'], ['いま', 'now'],
    ['いろ', 'colour'], ['うえ', 'above'], ['うし', 'cow'], ['うた', 'song'], ['うみ', 'sea'], ['え', 'picture'],
    ['えき', 'station'], ['おか', 'hill'], ['かお', 'face'], ['かさ', 'umbrella'], ['かぜ', 'wind; a cold'],
    ['かみ', 'paper; hair'], ['かわ', 'river'], ['き', 'tree'], ['きた', 'north'], ['きのう', 'yesterday'],
    ['きもの', 'kimono'], ['くち', 'mouth'], ['くつ', 'shoes'], ['くも', 'cloud; spider'], ['くるま', 'car'],
    ['けさ', 'this morning'], ['こえ', 'voice'], ['ここ', 'here'], ['こころ', 'heart, mind'], ['ことり', 'little bird'],
    ['さかな', 'fish'], ['さくら', 'cherry blossom'], ['さけ', 'sake; salmon'], ['した', 'below'], ['しお', 'salt'],
    ['しろ', 'white; castle'], ['すし', 'sushi'], ['すき', 'liked'], ['せかい', 'world'], ['せなか', 'back (body)'],
    ['そこ', 'there'], ['そら', 'sky'], ['たべもの', 'food'], ['たまご', 'egg'], ['ちかてつ', 'subway'],
    ['ちず', 'map'], ['つき', 'moon'], ['つくえ', 'desk'], ['て', 'hand'], ['てがみ', 'letter'], ['とけい', 'clock'],
    ['となり', 'next to'], ['とり', 'bird'], ['なつ', 'summer'], ['なに', 'what'], ['なまえ', 'name'],
    ['にく', 'meat'], ['にし', 'west'], ['ねこ', 'cat'], ['ねる', 'to sleep'], ['のむ', 'to drink'],
    ['はな', 'flower; nose'], ['はなし', 'story'], ['はし', 'chopsticks; bridge'], ['ひと', 'person'],
    ['ひる', 'noon'], ['ふね', 'boat'], ['ふゆ', 'winter'], ['へや', 'room'], ['ほし', 'star'], ['ほん', 'book'],
    ['まど', 'window'], ['みず', 'water'], ['みせ', 'shop'], ['みち', 'road'], ['みみ', 'ear'], ['むし', 'insect'],
    ['むら', 'village'], ['め', 'eye'], ['めがね', 'glasses'], ['もの', 'thing'], ['もり', 'forest'],
    ['やま', 'mountain'], ['やさい', 'vegetables'], ['ゆき', 'snow'], ['ゆめ', 'dream'], ['よる', 'night'],
    ['りんご', 'apple'], ['れきし', 'history'], ['ろく', 'six'], ['わたし', 'I, me'], ['わに', 'crocodile'],
    ['えいが', 'movie'], ['がっこう', 'school'], ['ぎんこう', 'bank'], ['ごはん', 'rice; meal'], ['ざっし', 'magazine'],
    ['じかん', 'time'], ['ぞう', 'elephant'], ['だいがく', 'university'], ['でんしゃ', 'train'], ['どこ', 'where'],
    ['ぶた', 'pig'], ['ぼうし', 'hat'], ['きっぷ', 'ticket'], ['しゃしん', 'photo'], ['じゅう', 'ten'],
    ['きょう', 'today'], ['ちょっと', 'a little'], ['りょこう', 'travel'], ['いっしょ', 'together'],
    ['びょういん', 'hospital'], ['べんきょう', 'study'], ['おいしい', 'delicious'], ['ありがとう', 'thank you'],
    ['さようなら', 'goodbye'], ['おはよう', 'good morning'], ['すみません', 'excuse me'], ['にほん', 'Japan'],
    ['にほんご', 'Japanese language'], ['ひらがな', 'hiragana'], ['かたかな', 'katakana'], ['せんせい', 'teacher'],
    ['がくせい', 'student'], ['ともだち', 'friend'], ['おかあさん', 'mother'], ['おとうさん', 'father'],
    ['いもうと', 'younger sister'], ['おとうと', 'younger brother'], ['ほんや', 'bookshop'], ['でんわ', 'telephone'],
    ['アイス', 'ice cream'], ['カメラ', 'camera'], ['コーヒー', 'coffee'], ['テレビ', 'TV'], ['パン', 'bread'],
    ['バス', 'bus'], ['タクシー', 'taxi'], ['ホテル', 'hotel'], ['メニュー', 'menu'], ['ラーメン', 'ramen'],
    ['ケーキ', 'cake'], ['ノート', 'notebook'], ['ペン', 'pen'], ['ドア', 'door'], ['トイレ', 'toilet'],
    ['シャツ', 'shirt'], ['スーパー', 'supermarket'], ['ゲーム', 'game'], ['ピアノ', 'piano'], ['ギター', 'guitar'],
    ['テニス', 'tennis'], ['サッカー', 'football'], ['ニュース', 'news'], ['ミルク', 'milk'], ['ジュース', 'juice'],
    ['ビール', 'beer'], ['ワイン', 'wine'], ['アメリカ', 'America'], ['イギリス', 'UK'], ['カナダ', 'Canada'],
    ['フランス', 'France'], ['ドイツ', 'Germany'], ['ロンドン', 'London'], ['トマト', 'tomato'], ['バナナ', 'banana'],
    ['レモン', 'lemon'], ['チーズ', 'cheese'], ['ハンバーガー', 'hamburger'], ['パソコン', 'PC'], ['カレー', 'curry'],
    ['メール', 'email'], ['クラス', 'class'], ['ネクタイ', 'necktie'], ['セーター', 'sweater'], ['スキー', 'skiing'],
    ['マンガ', 'manga'], ['ゼロ', 'zero'], ['ホーム', 'platform'], ['キロ', 'kilo'], ['ガム', 'chewing gum'],
  ];

  window.KANA = { info, groups, chart, words: WORDS };
})();
