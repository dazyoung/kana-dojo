// Opens the store the server is set to use: SQLite (a database file; the default) or Firestore (Google Cloud).
'use strict';

function openStore({ kind = 'sqlite', file, project, database } = {}) {
  if (kind === 'sqlite') return require('./sqlite').open(file);
  if (kind === 'firestore') return require('./firestore').open({ project, database });
  throw new Error(`Unknown store "${kind}" (use sqlite or firestore)`);
}

module.exports = { openStore };
