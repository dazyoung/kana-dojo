# Kana Dojo かな道場

A small web app for learning hiragana and katakana: flashcards with spaced repetition, plus
handwriting practice with stroke-order checking (Apple Pencil, Wacom, mouse or finger).

## Run it

Needs [Node](https://nodejs.org) 22 or newer and nothing else (no packages to install).

```bash
node server/server.js        # then open http://localhost:8000
./serve.sh [port]            # same, and prints the address to use from other devices on your network
```

Other devices on the same network can open `http://<this computer's name or IP>:8000`. On an iPad or
iPhone, Share → **Add to Home Screen** makes it open full-screen like an app.

Edits to the app's files (html/css/js) show up on the next page reload; edits to `server/` need a
restart. You can also open `index.html` straight from disk: everything works except accounts and
syncing, and progress stays in that browser.

Server options (each can also be set with the environment variable shown):

| Flag | Env | Default | |
| --- | --- | --- | --- |
| `--port` | `PORT` | `8000` | |
| `--host` | `HOST` | all interfaces | e.g. `127.0.0.1` to accept only local connections |
| `--db` | `KANA_DB` | `var/kana-dojo.db` | the database (created on first run) |
| `--base` | `KANA_BASE` | none | also serve the app under a path, e.g. `/kana` when a reverse proxy publishes it at `https://example.com/kana` |
| `--signups` | `KANA_SIGNUPS` | `open` | `closed` stops new accounts |
| `--trust-proxy` | `TRUST_PROXY` | off | `1` = take the client address from `X-Forwarded-For` (a proxy on the same machine is trusted automatically) |

## Accounts and syncing

Open Settings → **Sign in or create an account**. Progress already on the device is added to the
account. Sign in with the same account on each device (computer, tablet, phone) and they share progress.

- Progress is kept in the browser first, so the app works offline and without an account. When you're
  signed in, each answer is sent to the server a couple of seconds later, and other devices pick it up
  when they're opened or every few minutes (Settings → Sync now forces it).
- If two devices change the same card, the newer change wins. Daily answer counts and streaks add up
  across devices.
- **Reset** and **Import** apply to every device on the account.
- Settings (typing vs. choosing, stroke checking, sound…) are per device, since what suits a computer
  with a keyboard differs from a tablet with a pen.
- Signing out removes the progress from that device. It stays in the account.
- Without an account, progress stays in that one browser. Each address counts separately
  (e.g. `localhost:8000` vs. the computer's network address, and a Home Screen app vs. a browser tab).

Accounts and progress are stored in the database (SQLite). The server also keeps up to 40 earlier
copies of each person's progress: one from the start of each day it changed, plus one from just before
every reset or import.

```bash
node server/admin.js users                       # list accounts
node server/admin.js snapshots <user>            # earlier copies of someone's progress
node server/admin.js restore <user> <snapshot>   # put one back (devices pick it up on their next sync)
node server/admin.js reset-password <user>       # there's no email reset, so this is how
node server/admin.js delete <user>
node server/admin.js backup ~/kana-backup.db     # copy the whole database
```

(Add `--db <file>` if the database isn't at `var/kana-dojo.db`.)

### Running it for other people

- Host it anywhere that runs Node 22+ (a small VPS, Fly.io, Render, Railway…), with `--db` on a
  persistent disk that you back up (`node server/admin.js backup`).
- Put it behind HTTPS (the host's, or a reverse proxy such as Caddy or nginx). Passwords must never
  travel over plain HTTP on the open internet. Use `--base` if it lives under a path, and
  `--trust-proxy 1` if the proxy runs on another machine.
- `--signups closed` makes it invite-only: create the accounts, then close sign-ups.
- Already in place: scrypt password hashing, rate limiting and lockout after repeated wrong passwords,
  revocable sessions, strict security headers (CSP), and only the app's own files are ever served
  (never the database or the server code).
- Still to add before opening it to the public: email (for password resets), a privacy note, and
  scheduled database backups.

## How to use it (the method)

1. **Learn a lesson** (about 5 characters, in the traditional あいうえお order). For each character you:
   - **meet** it: see it, hear it, and watch the numbered stroke-order animation
   - **trace** it over a guide, one stroke at a time
   - **write it from memory**
   - then do a short quiz on the whole set.
2. **Do your reviews** whenever the Review button shows cards due. This is spaced repetition: each
   correct answer moves a card up a level and pushes its next review further out. New cards get several
   short reviews on their first day, then the gaps grow to days, weeks and months:

   | Stage | Levels | Next review after |
   | --- | --- | --- |
   | Seen | 1–4 | 15 min → 1 h → 4 h → 8 h |
   | Learning | 5–7 | 1 day → 2 days → 4 days |
   | Familiar | 8–9 | 1 week → 2 weeks |
   | Mastered | 10–12 | 1 month → 2 months → 4 months |

   A miss drops the card back (1 level while Seen, 2 while Learning or Familiar, 3 when Mastered) and
   brings it back within the hour. Each wait varies by ±10% so cards spread out. The waits are set in
   `INTERVALS` in `js/srs.js`.
3. **Add the next lesson when reviews are done.** A good pace is one lesson a day. That covers the 46
   basic hiragana in about 10 days, and all hiragana (with ゛/゜ and the きゃ-type combos) in about 2 weeks.
   Then switch the tab to カタカナ and do the same.
4. **Read words.** Once you know a few characters, *Extra practice → Words* shows real words
   made only of kana you've learned. This is where reading starts to feel natural, so use it often.
5. **Check your progress** with *Stats* (or tap the streak): characters known and mastered, words you
   can read, streak and accuracy, characters by stage, answers per day, reviews coming up over the next
   week, and the characters you miss most.

Each character has two separate cards, **reading** (kana → romaji) and **writing** (romaji → you
write it), because recognising a character and producing it are different skills.

### Writing practice

- Strokes are checked one at a time against [KanjiVG](https://kanjivg.tagaini.net) stroke data.
  An accepted stroke snaps to a clean version. A rejected stroke flashes red with a reason
  (wrong direction, wrong order, or wrong shape). After two misses on the same stroke you get a hint.
- A writing card counts as correct with no hints and at most one missed stroke.
- Too strict or too loose? Settings → Stroke checking (Strict / Normal / Relaxed / Off). *Off* lets you
  draw freely, compare against the answer, and grade yourself.
- Palm rejection: once the app has seen your Pencil or pen, touches from your hand are ignored.
- Tap any character on the chart to watch its stroke order and practise it as much as you like.

### Tips

- On a computer, type romaji answers; on a tablet, *Settings → Reading answers → Choose* (the default on
  touch devices) lets you tap instead. The wrong choices are deliberately look-alikes (ぬ/め, シ/ツ…).
- Keyboard: `Enter` continues, `1`–`4` picks a choice, `H` gives a writing hint, `Esc` exits.
- Turn on *Vary fonts* once the basics are solid. Real text uses many typefaces.
- Make up your own little picture stories for characters you keep missing. They stick better than
  borrowed ones.

## Files

```
index.html          app shell
css/style.css       styles (light + dark)
js/app.js           screens: home, lessons, reviews, words, settings
js/writer.js        handwriting pad: pointer/pen input, stroke animation, stroke matching
js/srs.js           progress storage (in the browser) + spaced-repetition scheduling
js/sync.js          accounts + syncing progress with the server
js/merge.js         progress format and merging (shared by the browser and the server)
js/romaji.js        answer checking (accepts shi/si, tsu/tu, っ doubling, ー long vowels…)
data/kana.js        kana tables, lesson order, practice words
data/strokes.js     stroke paths for all kana (generated from KanjiVG)
server/server.js    web server: serves the app + the accounts/sync API
server/db.js        database (SQLite) + password hashing
server/admin.js     admin commands (list users, restore snapshots, reset passwords, backups)
var/                the database (created on first run; not in git)
tools/build_strokes.py  regenerates data/strokes.js from KanjiVG SVG files
serve.sh            runs the server and prints the addresses for other devices
```

### Later: kanji

KanjiVG covers thousands of kanji (all the common ones) in the same format, so the writing pad and
stroke checker work for kanji unchanged. Adding kanji means adding stroke files to `data/strokes.js` (via
`tools/build_strokes.py`) plus a kanji deck with meanings and readings.

## Credits

Stroke-order data: KanjiVG © Ulrich Apel, licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
