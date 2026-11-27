# Changelog

Kana Dojo uses [semantic versioning](https://semver.org), MAJOR.MINOR.PATCH:

- **MAJOR**: anything that breaks compatibility with older pages or saved progress, such as a new
  progress format (`FORMAT` in `js/merge.js`) or a change to accounts.
- **MINOR**: new features.
- **PATCH**: fixes, wording and small visual changes.

List changes under "Unreleased" as they're made. `npm version patch|minor|major` then turns that section
into the next release, commits it and tags it (see README → Versions and releases).

## Unreleased

- Version numbers. The version shows at the bottom of the home page and in Settings, and at `/api/health`.
  A copy running from a git checkout with unreleased changes shows that too, e.g. `0.4.0+dev.1a2b3c4`.
- This changelog, and `npm version` to make a release.
- The `?v=` on the page's files now comes from the version automatically (no more manual bumps).

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
