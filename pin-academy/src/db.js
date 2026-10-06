// SQLite through Node's built-in driver. On Railway the file lives on a volume (DATA_DIR).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';
const dir = process.env.DATA_DIR || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(dir, { recursive: true });
export const DB_FILE = path.join(dir, process.env.DB_NAME || 'pin-academy.sqlite');
export const db = new DatabaseSync(DB_FILE);

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  slack_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'trainee',          -- trainee | admin
  class_id INTEGER REFERENCES classes(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT
);

-- start_* = where Google drops the pin for this address (what the dashboard shows an operator).
-- answer_* = where the pin SHOULD go, set by a trainer. Never sent to a trainee before they answer.
CREATE TABLE IF NOT EXISTS addresses (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,
  address TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  why TEXT NOT NULL DEFAULT '',
  start_lat REAL NOT NULL, start_lng REAL NOT NULL,
  answer_lat REAL NOT NULL, answer_lng REAL NOT NULL,
  practice INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tests (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  class_id INTEGER REFERENCES classes(id),
  pass_meters REAL NOT NULL DEFAULT 15,
  pass_count INTEGER NOT NULL DEFAULT 8,
  time_limit_min INTEGER NOT NULL DEFAULT 20,
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | open | closed
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_items (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  address_id INTEGER NOT NULL REFERENCES addresses(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (test_id, address_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY,
  slack_id TEXT NOT NULL REFERENCES users(slack_id),
  test_id INTEGER REFERENCES tests(id),          -- null = practice
  started_at TEXT NOT NULL DEFAULT (datetime('now')),
  deadline TEXT,
  submitted_at TEXT,
  UNIQUE (slack_id, test_id)
);

CREATE TABLE IF NOT EXISTS answers (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  address_id INTEGER NOT NULL REFERENCES addresses(id),
  lat REAL NOT NULL, lng REAL NOT NULL,
  distance_m REAL NOT NULL,
  start_distance_m REAL NOT NULL,                -- how far Google's pin was; shows whether they moved it
  seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (attempt_id, address_id)
);
`);

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
