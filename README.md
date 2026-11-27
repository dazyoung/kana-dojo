# Kana Dojo かな道場

A small web app for learning to read and write Japanese: hiragana, katakana, the 2,211 JLPT kanji and
about 8,000 JLPT words. Flashcards with spaced repetition, handwriting practice with stroke-order
checking (Apple Pencil, Wacom, mouse or finger), and progress tracked against JLPT N5–N1 and
(approximately) CEFR A1–C1.

## Run it

Needs [Node](https://nodejs.org) 22 or newer and nothing else (no packages to install).

```bash
node server/server.js        # then open http://localhost:8000   (or: npm start)
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
| `--trust-proxy` | `TRUST_PROXY` | `0` | how many proxies in front of the server add to `X-Forwarded-For` (e.g. `1`); the client's address is taken that many entries from the end. A proxy on the same machine counts as one automatically |
| `--contact` | `KANA_CONTACT` | none | an email address for questions, shown in the privacy note |
| `--log-days` | `KANA_LOG_DAYS` | none | how long the server's logs are kept, shown in the privacy note (set it to match your log rotation) |
| | `KANA_SIGNUPS_PER_DAY` | `200` | new accounts allowed per day in all (and 5 per network address) |
| `--store` | `KANA_STORE` | `sqlite` | `firestore` keeps accounts in Firestore instead of `--db` (see Hosting on Google Cloud) |
| `--project` | `GOOGLE_CLOUD_PROJECT` | none | the Google Cloud project, with `--store firestore` (found automatically on Cloud Run) |
| `--database` | `KANA_FIRESTORE_DB` | `(default)` | which Firestore database in that project |

## Accounts and syncing

Open Settings → **Sign in or create an account**. Progress already on the device is added to the
account. Sign in with the same account on each device (computer, tablet, phone) and they share progress.

- Progress is kept in the browser first, so the app works offline and without an account. When you're
  signed in, your answers are sent to the server within about 20 seconds (and straight away when you
  switch away from the app or close it), and other devices pick them up when they're opened or every few
  minutes (Settings → Sync now forces it).
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
  limits on new accounts (5 per network address and `KANA_SIGNUPS_PER_DAY` in all, each day) and on how
  much progress an account can store, revocable sessions, strict security headers (CSP), a privacy note
  (Settings → Privacy; set `--contact` and `--log-days` for it), and only the app's own files are ever
  served (never the database or the server code).
- Not included: email (so no password-reset emails; `node server/admin.js reset-password` instead).
  Schedule database backups yourself.

## How to use it (the method)

1. **Learn a lesson** (about 5 characters, in the traditional あいうえお order). For each character you:
   - **meet** it: see it, hear it, and watch the numbered stroke-order animation
   - **write it several times in a row** (a drill), the guide fading each time: trace it over the
     numbered guide, then over a faint guide, then with only dots where each stroke starts, then twice
     from memory
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
   Then switch the tab to カタカナ and do the same, then on to 漢字 (kanji) and 単語 (words).
4. **Read words.** Once you know a few characters, *Extra practice → Words* shows real words
   made only of kana you've learned. This is where reading starts to feel natural, so use it often.
5. **Check your progress** with *Stats* (or tap the streak): kana, kanji and words learned, your
   level against JLPT N5–N1 (≈ CEFR), streak and accuracy, everything by stage, answers per day,
   reviews coming up over the next week, and the cards you miss most.

Each character has two separate cards, **reading** (kana → romaji) and **writing** (romaji → you
write it), because recognising a character and producing it are different skills.

### Kanji and words

- **Kanji** (the 漢字 tab) are grouped by JLPT level, N5 to N1, five per lesson, most common first.
  Each lesson shows a kanji's meanings, on and kun readings, words that use it and its stroke order,
  has you write it in a drill (trace, faint guide, start points, from memory), then quizzes you. Each kanji has three cards: **meaning**
  (kanji → English), **reading** (kanji → any of its readings, typed in romaji or kana) and **writing**.
- **Words** (the 単語 tab) come ten per lesson per JLPT level, ordered so words that use the kanji you
  learn first come first. Each word has a **meaning** and a **reading** card.
- Typed meanings accept any listed meaning and forgive a small typo when you press Enter; readings accept
  any listed reading. "I was right" is there for the rest. With *Reading answers → Choose*, you pick
  from four instead.
- The N5–N1 buttons above the chart switch level; tap a kanji or word for its details.
- *Stats → Language level* counts a kanji or word as known once it's past its first day of reviews,
  and a JLPT level as reached at 90% of its kanji and words. The CEFR equivalents are approximate: the
  official ones (jlpt.jp) come from test scores, and N3/N2/N1 each span two CEFR levels.

### Writing practice

- Strokes are checked one at a time against [KanjiVG](https://kanjivg.tagaini.net) stroke data.
  An accepted stroke snaps to a clean version. A rejected stroke flashes red with a reason
  (wrong direction, wrong order, or wrong shape). After two misses on the same stroke you get a hint.
- A writing card counts as correct with no hints and at most one missed stroke.
- **Drills.** Lessons, workouts and the *Drill* button on a character's page have you write the
  character 5 times in a row: over the numbered guide, over a faint guide, with only the start points,
  then twice from memory. A from-memory round that isn't clean adds another start-points round and another
  from-memory round (twice at most). Settings → Writing drill sets 3, 5 or 7 times.
- **Fix it after a miss.** When you miss a writing card, you watch the stroke order, trace it once and
  write it twice from memory before moving on. The card still counts as missed and comes back later in
  the session.
- **Writing workout** (*Extra practice → Workout*) picks the 5 characters you miss most when writing
  (in the tab you're on), drills each one, then has you write all 5 once more from memory in a mixed
  order. Like the rest of *Extra practice*, it counts toward your stats but doesn't change when cards are
  next due.
- **Custom set** (the button above the hiragana or katakana chart): pick any characters, by tapping them
  or a whole row at a time, or *Weakest 5 to write*. Then choose **Lesson** (like *Learn next*: meet each one, a
  drill, then a quiz) or **Workout** (the drills, then each once more from memory). New characters in a
  custom lesson join your reviews; ones you'd already learned keep their timing. The pick is remembered
  on that device, so the next time you open it you can go again.
- Too strict or too loose? Settings → Stroke checking (Strict / Normal / Relaxed / Off). *Off* lets you
  draw freely, compare against the answer, and grade yourself.
- Palm rejection: once the app has seen your Pencil or pen, touches from your hand are ignored.
- In a drill you don't have to wait for the next round: putting the pen down starts it straight away.
- Tap any character on the chart to watch its stroke order and practise it as much as you like.

### Tips

- On a computer, type romaji answers; on a tablet, *Settings → Reading answers → Choose* (the default on
  touch devices) lets you tap instead. The wrong choices are deliberately look-alikes (ぬ/め, シ/ツ…).
- Keyboard: `Enter` continues, `1`–`4` picks a choice, `H` gives a writing hint, `Esc` exits.
- Turn on *Vary fonts* once the basics are solid. Real text uses many typefaces.
- The writing pad accepts strokes that run off its edge; the stroke is checked as drawn.
- Make up your own little picture stories for characters you keep missing. They stick better than
  borrowed ones.

## Hosting on Google Cloud

A public copy can run on Cloud Run, with accounts and progress in Firestore (`--store firestore`). It sleeps
when nobody's using it, so small sites cost next to nothing. Each release goes to **staging** first, and the
same image is then promoted to the **public** site. Both live in one Google Cloud project but share nothing
else: each has its own Cloud Run service, Firestore database and service account (which can only reach its
own database).

1. Create a Google Cloud project and link it to a billing account.
2. Copy `tools/gcp.env.example` to `local/gcp.env` (never committed) and fill it in.
3. Sign in (`gcloud auth login`), then run `tools/gcp-setup.sh` once. It sets up the two Firestore databases
   in your region (expired sign-ins deleted automatically, the public one backed up daily and kept a week),
   the two service accounts, the image registry, a backup bucket and a budget alert.
4. Make a release (below), then `tools/deploy.sh v1.0.0`. That runs the tests against SQLite and the staging
   database, builds the image from the tag, and deploys it to staging. It then checks the version it reports
   and makes, syncs and deletes a throwaway account there. Try it at the address it prints.
5. `tools/deploy.sh --promote v1.0.0` exports the public database to the backup bucket (kept 60 days), then
   deploys the same image to the public site. To roll back, promote an earlier tag.

Admin commands work there too: `node server/admin.js users --firestore <project>`. To restore a whole
backup, `gcloud firestore import gs://<project>-backups/<folder>`.

## Versions and releases

Kana Dojo uses [semantic versioning](https://semver.org): MAJOR for anything that breaks compatibility
with older pages or saved progress, MINOR for new features, PATCH for fixes. The version is `version` in
`package.json`, and each release is a git tag (`v0.4.0`). [CHANGELOG.md](CHANGELOG.md) says what's in each.

The version shows at the bottom of the home page, in Settings and at `/api/health`. When the server runs
from a git checkout that has changes since the release, it says so: `0.4.0+dev.1a2b3c4` means 0.4.0 plus
unreleased changes (hover it for details). The server also puts the version in the `?v=` on the page's
files, so browsers fetch fresh copies after an update.

To make a release:

1. List the changes under **Unreleased** in `CHANGELOG.md` as you go, and commit everything.
2. Run `npm version patch`, `npm version minor` or `npm version major`. It bumps `package.json`, turns
   "Unreleased" into the new version and today's date, commits that as "Kana Dojo 0.5.0" and tags
   `v0.5.0`. It refuses if there are uncommitted changes or nothing under "Unreleased".
3. `git push --follow-tags` when you want it on GitHub.

## Files

```
index.html          app shell (the server stamps the version into it)
package.json        name and version (no dependencies); `npm start`, `npm version`
CHANGELOG.md        what changed in each release
css/style.css       styles (light + dark)
js/app.js           screens: home, lessons, reviews, words, settings
js/writer.js        handwriting pad: pointer/pen input, stroke animation, stroke matching
js/srs.js           progress storage (in the browser) + spaced-repetition scheduling
js/sync.js          accounts + syncing progress with the server
js/merge.js         progress format and merging (shared by the browser and the server)
js/romaji.js        answer checking (accepts shi/si, tsu/tu, っ doubling, ー long vowels…)
js/decks.js         kanji + word decks: lessons, answer checking, choices, loading stroke data
data/kana.js        kana tables, lesson order, practice words
data/strokes.js     stroke paths for all kana (generated from KanjiVG)
data/kanji.js       JLPT kanji: level, meanings, readings, stroke count (generated)
data/vocab.js       JLPT words: word, reading, meaning (generated)
data/strokes-n5.js … strokes-n1.js   kanji stroke paths per level, loaded when first needed (generated)
server/server.js    web server: serves the app + the accounts/sync API
server/accounts.js  accounts, sign-ins and progress: every rule (expiry, snapshots, merging, limits)
server/store/       where they're kept: sqlite.js (a database file) or firestore.js (Google Cloud);
                    both have the same methods and pass the same tests (server/test/store.test.js)
server/passwords.js password hashing (scrypt)
server/version.js   the app's version, and how a git checkout differs from that release
server/admin.js     admin commands (list users, restore snapshots, reset passwords, backups)
server/test/        tests: `npm test` (SQLite); `npm run test:firestore -- <project> <database>` (and Firestore)
Dockerfile          the Cloud Run image (Firestore store)
tools/deploy.sh     deploy a release tag to staging, then promote the same image to the public site
tools/gcp-setup.sh  one-time Google Cloud setup (settings: local/gcp.env, from tools/gcp.env.example)
var/                the database (created on first run; not in git)
tools/build_strokes.py  regenerates data/strokes.js from KanjiVG SVG files
tools/build_kanji.py    regenerates the kanji, word and kanji-stroke data files (see Data below)
tools/changelog.js      run by `npm version`: turns "Unreleased" in CHANGELOG.md into the new release
serve.sh            runs the server and prints the addresses for other devices
```

## Data

The kanji and word files are generated from open datasets. To refresh them (the KANJIDIC licence asks
for regular updates), download these into an empty folder and run
`python3 -I tools/build_kanji.py <folder> data/`:

| File | Source |
| --- | --- |
| `kanjivg-main.zip` | KanjiVG release, "main" zip: https://github.com/KanjiVG/kanjivg/releases |
| `kanjidic2.xml.gz` | https://www.edrdg.org/kanjidic/kanjidic2.xml.gz |
| `JLPT_kanji_ALL.json` | https://github.com/Bluskyo/JLPT_Vocabulary/releases |
| `vocab-n1.csv` … `vocab-n5.csv` | `src/n1.csv` … `src/n5.csv` from https://github.com/jamsinclair/open-anki-jlpt-decks |

Nothing else to bump: browsers check every file for a newer copy on each load, and the version in
the page's `?v=` changes with each release.

## Credits

The app's data files keep their own licences:

- **Stroke order** (kana and kanji): [KanjiVG](https://kanjivg.tagaini.net) © 2009–2026 Ulrich Apel,
  [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- **Kanji meanings, readings, stroke counts**: this app uses the
  [KANJIDIC](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) dictionary file. These files are the
  property of the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/), and are
  used in conformance with the Group's [licence](https://www.edrdg.org/edrdg/licence.html) (CC BY-SA 4.0).
  (The SKIP codes, which have a non-commercial licence, are not used.)
- **JLPT levels and vocabulary**: Jonathan Waller's JLPT lists (CC BY), via
  [Bluskyo/JLPT_Vocabulary](https://github.com/Bluskyo/JLPT_Vocabulary) (MIT) and
  [jamsinclair/open-anki-jlpt-decks](https://github.com/jamsinclair/open-anki-jlpt-decks) (MIT).
  Unofficial: the JLPT has published no lists since 2010.
- **JLPT ↔ CEFR**: approximate, from the official
  [CEFR reference levels](https://www.jlpt.jp/e/about/cefr_reference.html).

The app shows these under Settings → About & data sources, with a credit line on the kanji and word screens.
