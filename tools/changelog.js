#!/usr/bin/env node
// Run by `npm version` (the "version" script in package.json) after it bumps package.json and before it
// commits: renames "## Unreleased" in CHANGELOG.md to the new version and today's date, adds a fresh empty
// "## Unreleased" above it, and stages the file so it goes into the release commit and tag.
// Refuses (and so stops the release) if nothing is listed under "## Unreleased".
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'CHANGELOG.md');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const fail = (msg) => { console.error(`changelog: ${msg}`); process.exit(1); };

const lines = fs.readFileSync(FILE, 'utf8').split('\n');
const i = lines.findIndex((l) => /^## Unreleased\s*$/.test(l));
if (i < 0) fail('CHANGELOG.md has no "## Unreleased" section.');
let j = i + 1;
while (j < lines.length && !/^## /.test(lines[j])) j++;
if (!lines.slice(i + 1, j).join('\n').trim()) {
  fail('nothing is listed under "## Unreleased" in CHANGELOG.md. Add what changed, commit it, then run npm version again.');
}
const date = new Date().toISOString().slice(0, 10);
lines.splice(i, 1, '## Unreleased', '', `## ${version} (${date})`);
fs.writeFileSync(FILE, lines.join('\n'));
execFileSync('git', ['add', 'CHANGELOG.md'], { cwd: ROOT });
console.log(`changelog: "Unreleased" is now ${version} (${date}).`);
