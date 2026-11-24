// Accounts + syncing progress with the Kana Dojo server (server/server.js).
//
// Progress always lives in this browser first, so the app works offline and without an account.
// When signed in, every change is sent to the server a moment later; the server merges it with
// what other devices sent (see merge.js) and sends back the combined progress.
(function () {
  const S = window.SRS, M = window.KanaMerge;
  const ACC_KEY = 'kana-dojo-account';

  const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  let acc = read(ACC_KEY) || {}; // { username, token, lastSync, dirty }
  const saveAcc = () => localStorage.setItem(ACC_KEY, JSON.stringify(acc));

  const listeners = [];
  const emit = (what) => listeners.forEach((f) => { try { f(what); } catch (e) { console.error(e); } });
  const state = { status: acc.token ? 'idle' : 'off', message: '', server: 'unknown', signups: true };
  const setStatus = (status, message = '') => { state.status = status; state.message = message; emit('status'); };

  async function api(path, body, token = acc.token) {
    let res;
    try {
      res = await fetch('api/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(token ? { Authorization: 'Bearer ' + token } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
    } catch (e) {
      const err = new Error('Can’t reach the server');
      err.offline = true;
      throw err;
    }
    let json = {};
    try { json = await res.json(); } catch (e) { /* not JSON */ }
    if (!res.ok) {
      const err = new Error(json.error || (res.status === 404 ? 'This server doesn’t support accounts' : `Server error (${res.status})`));
      err.status = res.status;
      throw err;
    }
    return json;
  }

  // Send progress, get back the merged progress. Only accepted from a server that speaks the same
  // progress format (a server mid-update could still be running the previous version).
  async function exchange(progress) {
    const r = await api('sync', { client: M.FORMAT, progress });
    if (r.format !== M.FORMAT) throw new Error('The server is being updated. Try again in a minute.');
    return M.clean(r.progress, S.device);
  }

  // ---------- syncing ----------
  let changes = 0, running = null, timer = null;
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(sync, ms); };

  S.onChange = () => {
    changes++;
    if (!acc.token) return;
    acc.dirty = true;
    saveAcc();
    schedule(2000);
  };

  function sync() {
    if (!acc.token) return Promise.resolve();
    if (running) return running;
    clearTimeout(timer);
    running = (async () => {
      const seen = changes;
      setStatus('syncing');
      try {
        const remote = await exchange(S.progress());
        // Combine with the latest local progress (it may have changed while we waited).
        const local = S.progress();
        const merged = M.merge(remote, local);
        const changed = !M.same(merged, local);
        if (changed) S.replaceProgress(merged);
        acc.lastSync = Date.now();
        acc.dirty = changes !== seen;
        saveAcc();
        setStatus('ok');
        if (changed) emit('progress');
        if (acc.dirty) schedule(1000);
      } catch (e) {
        if (e.status === 401) {
          acc.token = null; // keep the username: this device's progress still belongs to them
          saveAcc();
          setStatus('signed-out', 'You were signed out. Sign in again to keep syncing.');
          emit('account');
        } else {
          setStatus(e.offline ? 'offline' : 'error', e.message);
          schedule(60e3);
        }
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // ---------- account ----------
  async function signIn(username, password, create) {
    const prev = { ...acc };
    const r = await api(create ? 'signup' : 'login', { username, password }, null);
    const prevOwner = prev.username ? prev.username.toLowerCase() : null;
    try {
      acc = { username: r.username, token: r.token, lastSync: 0, dirty: false };
      // Fetch the account's progress (sending nothing), then decide what to do with this device's.
      const remote = await exchange(M.empty());
      const local = S.progress();
      let next;
      if (!prevOwner) next = M.merge(remote, { ...local, gen: remote.gen }); // not signed in before: add it to the account
      else if (prevOwner === r.username.toLowerCase()) next = M.merge(remote, local); // same person signing back in
      else next = remote; // left over from a different account: don't mix it in
      S.replaceProgress(next);
      acc.dirty = !M.same(next, remote);
      acc.lastSync = Date.now();
      saveAcc();
    } catch (e) {
      acc = prev;
      saveAcc();
      throw e;
    }
    setStatus('ok');
    emit('account');
    emit('progress');
    if (acc.dirty) await sync();
    return r.username;
  }

  // Signing out removes progress from this device (it stays in the account), so the next person
  // to use the device starts fresh.
  async function signOut() {
    if (acc.token && acc.dirty) await sync();
    if (acc.token && acc.dirty &&
      !confirm('Some progress on this device hasn’t reached the server yet and will be lost. Sign out anyway?')) return false;
    if (acc.token) api('logout', {}).catch(() => {});
    clearTimeout(timer);
    acc = {};
    saveAcc();
    S.replaceProgress(M.empty(Date.now()));
    setStatus('off');
    emit('account');
    emit('progress');
    return true;
  }

  const changePassword = (current, next) => api('password', { password: current, newPassword: next });

  async function deleteAccount(password) {
    await api('delete-account', { password });
    clearTimeout(timer);
    acc = {}; // progress stays on this device, no longer linked to an account
    saveAcc();
    setStatus('off');
    emit('account');
  }

  // ---------- when to sync ----------
  const canSync = location.protocol === 'http:' || location.protocol === 'https:';
  if (canSync) {
    api('health').then((h) => { state.server = 'yes'; state.signups = h.signups !== false; emit('status'); })
      .catch(() => { state.server = 'no'; emit('status'); });
    if (acc.token) sync();
    document.addEventListener('visibilitychange', () => {
      if (!acc.token) return;
      if (document.hidden) { if (acc.dirty) sync(); } // send before the app goes into the background
      else if (Date.now() - (acc.lastSync || 0) > 15e3) sync();
    });
    window.addEventListener('online', () => { if (acc.token) sync(); });
    setInterval(() => { if (acc.token && !document.hidden) sync(); }, 5 * 60e3);
  } else {
    state.server = 'no';
  }

  window.Sync = {
    state,
    get username() { return acc.username || null; },
    get signedIn() { return !!acc.token; },
    get lastSync() { return acc.lastSync || 0; },
    get pending() { return !!acc.dirty; },
    on: (f) => listeners.push(f),
    sync, signIn, signOut, changePassword, deleteAccount,
  };
})();
