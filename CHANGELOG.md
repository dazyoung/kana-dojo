# Changelog

Kana Dojo uses [semantic versioning](https://semver.org), MAJOR.MINOR.PATCH:

- **MAJOR**: anything that breaks compatibility with older pages or saved progress, such as a new
  progress format (`FORMAT` in `js/merge.js`) or a change to accounts.
- **MINOR**: new features.
- **PATCH**: fixes, wording and small visual changes.

List changes under "Unreleased" as they're made. `npm version patch|minor|major` then turns that section
into the next release, commits it and tags it (see README → Versions and releases).

## Unreleased

## 0.8.0 (2026-11-27)

- The "☕ Buy me a coffee" link moves from the bottom of the home page to the header (just ☕ on phones).
- The public site's address is https://kanadojo.web.app (Firebase Hosting in front of Cloud Run). Pages opened
  at the service's `run.app` address redirect there (`--public-url`).
- Visitors' addresses are read correctly behind Firebase Hosting (`--proxy-nets`), so the per-address
  sign-up limit still applies to each visitor rather than to Firebase.
## 0.7.1 (2026-11-27)

- Fix: the Firestore store wrote to `null/...` before it had worked out the project's path (found by the
  first test run against real Firestore; nothing was deployed).
- `tools/gcp-setup.sh` makes the backup bucket through the Cloud Storage API, since `gcloud storage` crashes
  when gcloud runs on Python 3.14.

## 0.7.0 (2026-11-27)

- An optional "☕ Buy me a coffee" link (`--donate`, `KANA_DONATE_URL`) on the home page, in Settings and
  in About, mentioned in the privacy note. It's only a link: nothing is loaded from the donation site.

## 0.6.0 (2026-11-27)

- Staging and the public site share one Google Cloud project, each with its own Cloud Run service, Firestore
  database and service account. `--database` (`KANA_FIRESTORE_DB`) picks the Firestore database.
- `tools/deploy.sh` checks each deploy by reading Firestore as the service, and on staging by making,
  syncing and deleting a throwaway account.
## 0.5.0 (2026-11-27)

- Storage is split into rules (`server/accounts.js`) and a store that only keeps things
  (`server/store/sqlite.js`), with a test suite every store must pass (`npm test`).
- A Firestore store (`server/store/firestore.js`, `--store firestore`) for running on Google Cloud, using
  Firestore's REST API (still no dependencies). `npm run test:firestore -- <project>` runs the same tests
  against it.
- Hosting on Google Cloud: a Dockerfile for Cloud Run, `tools/gcp-setup.sh` (one-time setup) and
  `tools/deploy.sh` (test a release tag, deploy it to staging, then promote the same image to the public site).

## 0.4.0 (2026-11-27)

- Version numbers. The version shows at the bottom of the home page and in Settings, and at `/api/health`.
  A copy running from a git checkout with unreleased changes shows that too, e.g. `0.4.0+dev.1a2b3c4`.
- This changelog, and `npm version` to make a release.
- The `?v=` on the page's files now comes from the version automatically (no more manual bumps).
- A privacy note (Settings → Privacy, and from the sign-up form): what's stored and why, and how to export
  or delete it. The server's `--contact` and `--log-days` fill in who to ask and how long logs are kept.
- Limits on new accounts: 5 per network address and 200 in all (`KANA_SIGNUPS_PER_DAY`) each day.
- An account's stored progress is capped at 4 MB (everything learned is about 3 MB).
- Syncing sends changes within 20 seconds instead of after every answer, and straight away when the app
  is hidden or closed. Sync replies are gzipped (about 5× smaller).
- `--trust-proxy` now takes the number of proxies in front of the server, and the client's address is
  read from the end of `X-Forwarded-For`, where a client can't fake it.

## 0.3.0 (2026-11-27)

- Kanji (the 2,211 JLPT kanji, N5–N1) and about 8,000 JLPT words, each with meaning and reading cards,
  and writing cards for kanji.
- Progress against JLPT N5–N1 (approximately CEFR A1–C1) in Stats.
- Writing drills (trace, faint guide, start points, from memory), a fix-it loop after a missed writing
  card, the Writing workout and Custom sets.
- Voice picker.
- Writing pad: strokes that run off the edge are accepted; a light pen stroke isn't cut short; putting the
  pen down during a drill's pause starts the next round.
- Progress format 4 (longer unit names for kanji and word cards).

## 0.2.0 (2026-11-24)

- A faster 12-level review timeline (first reviews after 15 minutes, 1 hour, 4 hours and 8 hours).
- The Stats screen.

## 0.1.0 (2026-11-24)

- Hiragana and katakana: lessons, spaced-repetition reviews and handwriting practice with stroke-order
  checking.
- Accounts and syncing progress between devices.
