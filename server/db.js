/* Flowboard: SQLite access via Node's built-in node:sqlite (no npm packages). */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

function open(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  db.exec('PRAGMA foreign_keys = ON;');
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')").run();
  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('created_at', ?)").run(String(Date.now()));

  const cache = new Map();
  const stmt = sql => { let s = cache.get(sql); if (!s) { s = db.prepare(sql); cache.set(sql, s); } return s; };
  let depth = 0;
  // Node 22.5.x returns an object of NULLs instead of undefined when get() finds no row.
  const getBroken = db.prepare('SELECT 1 AS x WHERE 0').get() !== undefined;
  const api = {
    raw: db,
    file,
    get: getBroken ? (sql, ...args) => stmt(sql).all(...args)[0] : (sql, ...args) => stmt(sql).get(...args),
    all: (sql, ...args) => stmt(sql).all(...args),
    run: (sql, ...args) => stmt(sql).run(...args),
    // Run fn inside a transaction; nested calls join the outer transaction.
    tx(fn) {
      if (depth > 0) return fn();
      db.exec('BEGIN IMMEDIATE');
      depth++;
      try {
        const r = fn();
        depth--;
        db.exec('COMMIT');
        return r;
      } catch (e) {
        depth--;
        try { db.exec('ROLLBACK'); } catch (e2) { /* already rolled back */ }
        throw e;
      }
    },
    close() { try { db.close(); } catch (e) { /* ignore */ } }
  };
  return api;
}

module.exports = { open };
