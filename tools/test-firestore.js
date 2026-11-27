#!/usr/bin/env node
// `npm run test:firestore -- <project> [database]`: runs the store tests against SQLite and against that
// Firestore database (the staging one; default: "(default)"), in collections of their own that they delete afterwards.
// The deploy script runs this first and stops if anything fails.
//
// `npm run test:firestore` with no project starts the local Firestore emulator instead and stops it after.
// That needs gcloud's emulator (gcloud components install cloud-firestore-emulator) and Java 21+.
'use strict';
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HOSTPORT = `127.0.0.1:${process.env.EMULATOR_PORT || 8085}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function runTests(env) {
  const dir = path.join(ROOT, 'server', 'test');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.test.js')).map((f) => path.join(dir, f));
  return spawn(process.execPath, ['--test', ...files], { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env } });
}

(async () => {
  const [project, database = '(default)'] = process.argv.slice(2);
  if (project) {
    runTests({ KANA_TEST_FIRESTORE_PROJECT: project, KANA_TEST_FIRESTORE_DB: database }).on('exit', (code) => process.exit(code === null ? 1 : code));
    return;
  }
  const log = [];
  const emulator = spawn('gcloud', ['emulators', 'firestore', 'start', `--host-port=${HOSTPORT}`, '--quiet'],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: true }); // its own process group, so Java stops with it
  emulator.stdout.on('data', (d) => log.push(String(d)));
  emulator.stderr.on('data', (d) => log.push(String(d)));
  const stop = () => { try { process.kill(-emulator.pid, 'SIGTERM'); } catch (e) { /* already gone */ } };
  process.on('exit', stop);

  let ready = false;
  for (let i = 0; i < 120 && !ready && emulator.exitCode === null; i++) {
    await sleep(500);
    try { ready = (await fetch(`http://${HOSTPORT}/`)).ok; } catch (e) { /* not yet */ }
  }
  if (!ready) {
    console.error(`The Firestore emulator didn't start:\n${log.join('')}`);
    process.exit(1);
  }

  runTests({ FIRESTORE_EMULATOR_HOST: HOSTPORT }).on('exit', (code) => { stop(); process.exit(code === null ? 1 : code); });
})();
