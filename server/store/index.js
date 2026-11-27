// Opens the store the server is set to use: SQLite (a database file; the default) or Firestore (Google Cloud).
'use strict';

function openStore({ kind = 'sqlite', file, project, database, prefix, partSize } = {}) {
  if (kind === 'sqlite') return require('./sqlite').open(file);
  if (kind === 'firestore') return require('./firestore').open({ project, database, prefix, partSize });
  throw new Error(`Unknown store "${kind}" (use sqlite or firestore)`);
}

module.exports = { openStore };
