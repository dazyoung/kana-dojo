// The app's version: "version" in package.json (semantic versioning, bumped by `npm version` at each
// release), plus, when the server runs from a git checkout, how that checkout differs from the release:
//
//   0.4.0              exactly the v0.4.0 release
//   0.4.0+dev.1a2b3c4  0.4.0 plus unreleased changes (later commits and/or uncommitted edits)
//   0.5.0-dev.1a2b3c4  package.json already says 0.5.0, but there's no v0.5.0 tag yet
//
// A container built from a release tag has no .git, so it's just the version. APP_VERSION overrides it.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const FRESH = 5000; // re-check git at most this often (files may be copied in while the server runs)

let cached = null;
let cachedAt = 0;

function git(...args) {
  return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim();
}

function compute() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (process.env.APP_VERSION) return { version, label: process.env.APP_VERSION, note: '' };
  let sha, dirty, ahead;
  try {
    sha = git('rev-parse', '--short=7', 'HEAD');
    dirty = git('status', '--porcelain') !== '';
  } catch (e) {
    return { version, label: version, note: '' }; // not a git checkout (or no git): a release build
  }
  try { ahead = Number(git('rev-list', '--count', `v${version}..HEAD`)); } catch (e) { ahead = null; } // no tag yet
  if (ahead === 0 && !dirty) return { version, label: version, note: '' };
  const parts = [];
  if (ahead === null) parts.push(`v${version} isn’t tagged yet`);
  else if (ahead) parts.push(`${ahead} commit${ahead === 1 ? '' : 's'} after v${version}`);
  if (dirty) parts.push('uncommitted changes');
  return {
    version,
    label: `${version}${ahead === null ? '-' : '+'}dev.${sha}`,
    note: `Unreleased: ${parts.join(', ')} (commit ${sha})`,
  };
}

// { version: '0.4.0', label: '0.4.0+dev.1a2b3c4', note: 'Unreleased: …' }
function appVersion() {
  if (!cached || Date.now() - cachedAt > FRESH) {
    cached = compute();
    cachedAt = Date.now();
  }
  return cached;
}

module.exports = { appVersion };
