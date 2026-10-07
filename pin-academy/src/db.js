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
  status TEXT NOT NULL DEFAULT 'draft',          -- draft | open | closed | deleted
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

-- Scenarios = a short pretend call: what the caller says, one or two stops (pickup / drop-off) with the right pin
-- and entrances, the questions worth asking, and what the driver note must say. Details live in data (JSON).
-- (The addresses / test_items / answers tables above are from the first version and are no longer used.)
CREATE TABLE IF NOT EXISTS scenarios (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  data TEXT NOT NULL,
  practice INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS test_scenarios (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (test_id, scenario_id)
);

CREATE TABLE IF NOT EXISTS scenario_answers (
  id INTEGER PRIMARY KEY,
  attempt_id INTEGER NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  scenario_id INTEGER NOT NULL REFERENCES scenarios(id),
  submitted TEXT NOT NULL,          -- what the trainee sent (pins, entrances, questions asked, note)
  result TEXT NOT NULL,             -- the grading, worked out on the server
  passed INTEGER NOT NULL,
  seconds INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (attempt_id, scenario_id)
);
`);

// Columns added after the first version: add them to existing databases without touching any data.
function addColumn(table, column, ddl) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
// Every save bumps the version; a save from a page opened before the last change is refused (no silent overwrite).
addColumn('scenarios', 'version', 'version INTEGER NOT NULL DEFAULT 1');
addColumn('tests', 'mode', "mode TEXT NOT NULL DEFAULT 'test'"); // 'test' = timed, one go | 'practice' = a practice set for a class
// A practice set and a test made together in one form share a group_id (the first one's id), so Edit opens both.
// Deleting a practice set or test sets status = 'deleted': it disappears everywhere, but its results stay in the database.
addColumn('tests', 'group_id', 'group_id INTEGER');
// When a class is deleted its (deleted) tests let go of it; the class name is kept here so old answers still say whose they were.
addColumn('tests', 'deleted_class_name', 'deleted_class_name TEXT');
// A class can be archived once it is 6 months old (Vee, 2026-10-07): out of the menus, links stop working, data kept.
addColumn('classes', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
// Every sign-in, so admins can see each time a trainee signed in (Vee, 2026-10-07).
db.exec(`CREATE TABLE IF NOT EXISTS logins (id INTEGER PRIMARY KEY, slack_id TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')))`);

export const one = (sql, ...p) => db.prepare(sql).get(...p);
export const all = (sql, ...p) => db.prepare(sql).all(...p);
export const run = (sql, ...p) => db.prepare(sql).run(...p);

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}
