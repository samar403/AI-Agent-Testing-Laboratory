import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";

export type DB = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_versions (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  version TEXT NOT NULL, config TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS suites (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', spec TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, experiment_id TEXT NOT NULL, suite_id TEXT, agent_version_id TEXT,
  suite_name TEXT NOT NULL, agent_label TEXT NOT NULL, status TEXT NOT NULL, options TEXT NOT NULL,
  summary TEXT, total INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, error TEXT, source TEXT NOT NULL DEFAULT 'lab',
  suite_snapshot TEXT NOT NULL, agent_snapshot TEXT NOT NULL, created_at INTEGER NOT NULL, finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC);
CREATE TABLE IF NOT EXISTS trials (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE, scenario_id TEXT NOT NULL,
  trial_index INTEGER NOT NULL, passed INTEGER NOT NULL, score REAL NOT NULL, metrics TEXT NOT NULL, data TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS trials_run ON trials(run_id);
CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, trials INTEGER NOT NULL, cost_usd REAL NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, prefix TEXT NOT NULL, hash TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

export function openDb(file?: string): DB {
  const path = file ?? resolve(process.env.AGENTLAB_DATA_DIR ?? ".data", "agentlab.db");
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

const ALPHABET = "0123456789abcdefghijkmnpqrstuvwxyz";

/** Prefixed, URL-safe, alphanumeric ids such as run_k3x9q2m7ab. */
export function id(prefix: string): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

export function json<T>(s: unknown): T {
  return (typeof s === "string" ? JSON.parse(s) : s) as T;
}

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: DB, key: string, value: string): void {
  db.prepare("INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}
