// Storage on Firestore (Google Cloud), through its REST API with no client library.
//
// The same methods as store/sqlite.js; server/test/store.test.js runs the same tests against both (here,
// against the local Firestore emulator). Like the SQLite store it only stores and fetches: the rules
// live in server/accounts.js.
//
// Layout:
//   names/n-<username in lower case>      { id }                     one per username, so names stay unique
//   users/<id>                            { username, pass, created }   id: random hex
//   sessions/<sha256 of the token>        { user, created, used, expires }   (expires: for a TTL policy)
//   progress/<user id>                    { updated, parts, data, snaps: [{ label, parts }] newest first }
//   progress/<user id>/snapshots/<sha1 of label>   { label, parts, data }
//   <any of the above>/parts/<n>          { data }   the rest of a large blob
//
// Progress and snapshots are stored gzipped (about 5x smaller) and split into parts of at most PART bytes,
// because a Firestore document holds at most 1 MiB.
//
// Credentials: the Firestore emulator when FIRESTORE_EMULATOR_HOST is set; on Cloud Run, the service's
// own account (metadata server); otherwise the gcloud CLI's signed-in account (for admin.js).
'use strict';
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');

const PART = 900 * 1024;      // bytes of gzipped data per document
const MAX_WRITES = 450;       // per commit (Firestore allows 500)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

// ---------- Firestore values <-> plain values ----------
const V = {
  str: (s) => ({ stringValue: String(s) }),
  int: (n) => ({ integerValue: String(Math.round(n)) }),
  bytes: (b) => ({ bytesValue: b.toString('base64') }),
  time: (ms) => ({ timestampValue: new Date(ms).toISOString() }),
  arr: (values) => ({ arrayValue: values.length ? { values } : {} }),
  map: (fields) => ({ mapValue: { fields } }),
};
function plain(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('bytesValue' in v) return Buffer.from(v.bytesValue, 'base64');
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(plain);
  if ('mapValue' in v) return fieldsOf(v.mapValue);
  return null;
}
function fieldsOf(doc) {
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = plain(v);
  return out;
}

const pack = (obj, size) => {
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
  const parts = [];
  for (let i = 0; i < gz.length; i += size) parts.push(gz.subarray(i, i + size));
  return parts.length ? parts : [Buffer.alloc(0)];
};
const unpack = (parts) => JSON.parse(zlib.gunzipSync(Buffer.concat(parts)).toString('utf8'));

function taken() {
  const e = new Error('That username is taken');
  e.code = 'TAKEN';
  return e;
}

// opts: { project, database = '(default)', prefix, partSize }. Tests set `prefix` (added to every
// top-level collection name, so a test run against a real project keeps to itself) and a small `partSize`
// (so splitting gets tested).
function open({ project, database = '(default)', prefix = '', partSize = PART } = {}) {
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  const host = emulator ? `http://${emulator}` : 'https://firestore.googleapis.com';
  let projectId = project || process.env.GOOGLE_CLOUD_PROJECT || '';
  let cachedToken = null;

  // ---------- credentials ----------
  const METADATA = 'http://metadata.google.internal/computeMetadata/v1';
  async function metadata(p) {
    const r = await fetch(`${METADATA}/${p}`, { headers: { 'Metadata-Flavor': 'Google' }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`metadata server: ${r.status}`);
    return r;
  }
  async function token() {
    if (emulator) return 'owner';
    if (cachedToken && cachedToken.until > Date.now() + 60e3) return cachedToken.value;
    if (process.env.K_SERVICE) { // Cloud Run
      const t = await (await metadata('instance/service-accounts/default/token')).json();
      cachedToken = { value: t.access_token, until: Date.now() + t.expires_in * 1000 };
    } else {
      const value = await new Promise((res, rej) => execFile('gcloud', ['auth', 'print-access-token'], { timeout: 20e3 },
        (e, out) => (e ? rej(new Error('Firestore needs gcloud signed in (gcloud auth login)')) : res(out.trim()))));
      cachedToken = { value, until: Date.now() + 30 * 60e3 };
    }
    return cachedToken.value;
  }
  async function root() {
    if (!projectId && process.env.K_SERVICE) projectId = (await (await metadata('project/project-id')).text()).trim();
    if (!projectId) throw new Error('Firestore needs a project (--project or GOOGLE_CLOUD_PROJECT)');
    return `projects/${projectId}/databases/${database}/documents`;
  }
  let ROOT = null;
  // A document's full name; the first segment is a top-level collection, which gets the prefix.
  const name = (collection, ...rest) => `${ROOT}/${[prefix + collection, ...rest].join('/')}`;

  // ---------- requests ----------
  async function call(method, pathAndQuery, body) {
    if (!ROOT) ROOT = await root();
    for (let attempt = 1; ; attempt++) {
      const r = await fetch(`${host}/v1/${pathAndQuery.replace('{root}', ROOT)}`, {
        method,
        headers: { Authorization: `Bearer ${await token()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30e3),
      });
      const text = await r.text();
      let json = null;
      try { json = text ? JSON.parse(text) : {}; } catch (e) { /* not JSON */ }
      if (r.ok) return json;
      const err = (json && (Array.isArray(json) ? json[0] : json).error) || {};
      const e = new Error(`Firestore ${method} ${pathAndQuery.split('?')[0].replace('{root}', '')}: ${err.message || r.status}`);
      e.status = err.status || String(r.status);
      e.http = r.status;
      if ((r.status === 429 || r.status === 503) && attempt < 4) { await sleep(200 * attempt); continue; }
      throw e;
    }
  }

  // Documents by full name -> Map(name -> fields); missing ones are left out.
  async function getDocs(names, transaction) {
    const out = new Map();
    for (let i = 0; i < names.length; i += 100) {
      const res = await call('POST', '{root}:batchGet', { documents: names.slice(i, i + 100), ...(transaction ? { transaction } : {}) });
      for (const r of res) if (r.found) out.set(r.found.name, fieldsOf(r.found));
    }
    return out;
  }
  const getDoc = async (n, transaction) => (await getDocs([n], transaction)).get(n) || null;

  const set = (n, fields, extra = {}) => ({ update: { name: n, fields }, ...extra });
  const del = (n) => ({ delete: n });
  async function commit(writes) {
    for (let i = 0; i < writes.length; i += MAX_WRITES) await call('POST', '{root}:commit', { writes: writes.slice(i, i + MAX_WRITES) });
  }

  // Run fn(transaction, writes) and commit its writes, as one step; retried if Firestore aborts it
  // because something else changed the same documents.
  async function inTransaction(fn) {
    let previous = null;
    for (let attempt = 1; ; attempt++) {
      const { transaction } = await call('POST', '{root}:beginTransaction',
        { options: { readWrite: previous ? { retryTransaction: previous } : {} } });
      let committed = false;
      try {
        const writes = [];
        const result = await fn(transaction, writes);
        await call('POST', '{root}:commit', { writes, transaction });
        committed = true;
        return result;
      } catch (e) {
        if (!committed) call('POST', '{root}:rollback', { transaction }).catch(() => {});
        if (e.status === 'ABORTED' && attempt < 8) {
          previous = transaction;
          await sleep(25 * attempt + Math.random() * 50);
          continue;
        }
        throw e;
      }
    }
  }

  // Documents in a top-level collection matching field == value (or field < value), by name.
  async function query(collectionId, field, op, value) {
    const res = await call('POST', '{root}:runQuery', {
      structuredQuery: {
        from: [{ collectionId: prefix + collectionId }],
        where: { fieldFilter: { field: { fieldPath: field }, op, value } },
        select: { fields: [{ fieldPath: '__name__' }] },
      },
    });
    return res.filter((r) => r.document).map((r) => r.document.name);
  }

  // ---------- blobs: a document's `data` plus parts/1, parts/2… ----------
  function blobWrites(n, fields, obj, oldParts = 1) {
    const parts = pack(obj, partSize);
    const writes = [set(n, { ...fields, parts: V.int(parts.length), data: V.bytes(parts[0]) })];
    for (let i = 1; i < parts.length; i++) writes.push(set(`${n}/parts/${i}`, { data: V.bytes(parts[i]) }));
    for (let i = parts.length; i < oldParts; i++) writes.push(del(`${n}/parts/${i}`));
    return writes;
  }
  async function readBlob(n, fields, transaction) {
    const count = fields.parts || 1;
    if (count === 1) return unpack([fields.data]);
    const rest = [];
    for (let i = 1; i < count; i++) rest.push(`${n}/parts/${i}`);
    const docs = await getDocs(rest, transaction);
    return unpack([fields.data, ...rest.map((p) => {
      const d = docs.get(p);
      if (!d) throw new Error(`Firestore: part ${p} is missing`);
      return d.data;
    })]);
  }
  function deleteBlob(n, parts = 1) {
    const writes = [del(n)];
    for (let i = 1; i < parts; i++) writes.push(del(`${n}/parts/${i}`));
    return writes;
  }

  const progressDoc = (id) => name('progress', id);
  const snapshotDoc = (id, label) => name('progress', id, 'snapshots', sha1(label));
  const snapsOf = (fields) => (fields && fields.snaps) || [];
  const snapValue = (s) => V.map({ label: V.str(s.label), parts: V.int(s.parts) });
  const user = (id, f) => (f ? { id, username: f.username, pass: f.pass, created: f.created } : null);
  const idOf = (n) => n.slice(n.lastIndexOf('/') + 1);

  return {
    kind: 'firestore',

    // ---------- users ----------
    async userByName(username) {
      const entry = await getDoc(name('names', 'n-' + String(username).toLowerCase()));
      if (!entry) return null;
      return user(entry.id, await getDoc(name('users', entry.id)));
    },
    async userById(id) {
      if (!/^[0-9a-f]{20}$/.test(String(id))) return null;
      return user(String(id), await getDoc(name('users', String(id))));
    },
    async addUser(username, pass, created) {
      const id = crypto.randomBytes(10).toString('hex');
      try {
        await call('POST', '{root}:commit', { writes: [ // both or neither
          set(name('names', 'n-' + username.toLowerCase()), { id: V.str(id) }, { currentDocument: { exists: false } }),
          set(name('users', id), { username: V.str(username), pass: V.str(pass), created: V.int(created) }),
        ] });
      } catch (e) {
        if (e.status === 'ALREADY_EXISTS' || e.status === 'FAILED_PRECONDITION') throw taken();
        throw e;
      }
      return id;
    },
    async setPassword(id, pass) {
      await commit([set(name('users', id), { pass: V.str(pass) }, { updateMask: { fieldPaths: ['pass'] }, currentDocument: { exists: true } })]);
    },
    // Deletes the account first (so it's gone at once), then its sessions, progress and snapshots.
    async deleteUser(id) {
      const u = await getDoc(name('users', id));
      const p = await getDoc(progressDoc(id));
      const writes = [del(name('users', id))];
      if (u) writes.push(del(name('names', 'n-' + u.username.toLowerCase())));
      await commit(writes);
      const rest = (await query('sessions', 'user', 'EQUAL', V.str(id))).map(del);
      if (p) {
        rest.push(...deleteBlob(progressDoc(id), p.parts));
        for (const s of snapsOf(p)) rest.push(...deleteBlob(snapshotDoc(id, s.label), s.parts));
      }
      await commit(rest);
    },
    async listUsers() {
      const users = [];
      let pageToken = '';
      do {
        const r = await call('GET', `{root}/${prefix}users?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
        for (const d of r.documents || []) users.push(user(idOf(d.name), fieldsOf(d)));
        pageToken = r.nextPageToken || '';
      } while (pageToken);
      users.sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
      const progress = await getDocs(users.map((u) => progressDoc(u.id)));
      const out = [];
      for (const u of users) {
        const p = progress.get(progressDoc(u.id));
        out.push({
          id: u.id, username: u.username, created: u.created,
          updated: p ? p.updated : null, progress: p ? await readBlob(progressDoc(u.id), p) : null,
        });
      }
      return out;
    },

    // ---------- sessions ----------
    async addSession(hash, userId, now, expires) {
      await commit([set(name('sessions', hash), {
        user: V.str(userId), created: V.int(now), used: V.int(now), ...(expires ? { expires: V.time(expires) } : {}),
      })]);
    },
    async getSession(hash) {
      const s = await getDoc(name('sessions', hash));
      return s ? { userId: s.user, created: s.created, used: s.used } : null;
    },
    async touchSession(hash, now, expires) {
      const fields = { used: V.int(now), ...(expires ? { expires: V.time(expires) } : {}) };
      try {
        await commit([set(name('sessions', hash), fields, { updateMask: { fieldPaths: Object.keys(fields) }, currentDocument: { exists: true } })]);
      } catch (e) {
        if (e.status !== 'NOT_FOUND') throw e; // signed out meanwhile
      }
    },
    async deleteSession(hash) { await commit([del(name('sessions', hash))]); },
    async deleteSessions(userId, keepHash = '') {
      const keep = keepHash ? name('sessions', keepHash) : null;
      await commit((await query('sessions', 'user', 'EQUAL', V.str(userId))).filter((n) => n !== keep).map(del));
    },
    async deleteIdleSessions(usedBefore) {
      await commit((await query('sessions', 'used', 'LESS_THAN', V.int(usedBefore))).map(del));
    },

    // ---------- progress ----------
    async getProgress(userId) {
      const p = await getDoc(progressDoc(userId));
      return p ? { progress: await readBlob(progressDoc(userId), p), updated: p.updated } : null;
    },
    // See store/sqlite.js. change() may run more than once if Firestore retries the transaction.
    saveProgress(userId, change) {
      const n = progressDoc(userId);
      return inTransaction(async (transaction, writes) => {
        const p = await getDoc(n, transaction);
        const out = change(p ? { progress: await readBlob(n, p, transaction), updated: p.updated } : null);
        let snaps = snapsOf(p);
        if (out.snapshot && !snaps.some((s) => s.label === out.snapshot.label)) {
          const sw = blobWrites(snapshotDoc(userId, out.snapshot.label), { label: V.str(out.snapshot.label) }, out.snapshot.progress);
          writes.push(...sw);
          snaps = [{ label: out.snapshot.label, parts: sw.length }, ...snaps].sort((a, b) => (a.label < b.label ? 1 : -1));
          for (const s of snaps.slice(out.keep)) writes.push(...deleteBlob(snapshotDoc(userId, s.label), s.parts));
          snaps = snaps.slice(0, out.keep);
        }
        if (out.progress) {
          writes.push(...blobWrites(n, { updated: V.int(out.updated), snaps: V.arr(snaps.map(snapValue)) }, out.progress, p ? p.parts : 1));
        } else if (out.snapshot) {
          throw new Error('saveProgress: a snapshot needs new progress with it');
        }
        return out.result;
      });
    },

    // ---------- snapshots ----------
    async listSnapshots(userId) {
      const p = await getDoc(progressDoc(userId));
      const snaps = snapsOf(p);
      const docs = await getDocs(snaps.map((s) => snapshotDoc(userId, s.label)));
      const out = [];
      for (const s of snaps) {
        const n = snapshotDoc(userId, s.label);
        if (docs.get(n)) out.push({ label: s.label, progress: await readBlob(n, docs.get(n)) });
      }
      return out;
    },
    async getSnapshot(userId, label) {
      const n = snapshotDoc(userId, String(label));
      const s = await getDoc(n);
      return s ? readBlob(n, s) : null;
    },

    async close() {},
  };
}

module.exports = { open };
