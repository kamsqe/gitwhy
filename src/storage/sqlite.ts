import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import type { Database as DatabaseType } from 'better-sqlite3';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const schemaPath = join(moduleDir, 'schema.sql');

export interface OpenDatabaseOptions {
  /** Absolute or repo-relative path to the SQLite file. */
  readonly path: string;
  /** When true, allow opening an in-memory database (used for tests). */
  readonly memory?: boolean;
  /** When true, skip executing the schema file (used for unit tests). */
  readonly skipSchema?: boolean;
}

export function openDatabase(options: OpenDatabaseOptions): DatabaseType {
  const db = new Database(options.memory === true ? ':memory:' : options.path);
  if (options.skipSchema !== true) {
    db.exec(readSchema());
    applyMigrations(db);
  }
  return db;
}

/**
 * Idempotent in-place migrations for installs that opened the DB with an
 * older schema. We additive-only: never drop columns, never reorder. Each
 * migration checks PRAGMA table_info to decide whether to run.
 *
 * If you add a migration, also bump the SQL file's schema_version row so
 * fresh DBs and migrated DBs converge to the same state.
 */
function applyMigrations(db: DatabaseType): void {
  // commit_files.excluded — added for .gitwhyignore filtering (Phase D.2).
  // The schema CREATE TABLE IF NOT EXISTS clause is a no-op on pre-existing
  // tables, so the column won't appear via schema reload alone. Order matters:
  // add the column FIRST, then the index — otherwise the index DDL throws
  // "no such column".
  const cols = db.prepare(`PRAGMA table_info(commit_files)`).all() as Array<{
    name: string;
  }>;
  const hasExcluded = cols.some((c) => c.name === 'excluded');
  if (!hasExcluded) {
    db.exec(`ALTER TABLE commit_files ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0`);
  }
  db.exec(`CREATE INDEX IF NOT EXISTS idx_commit_files_excluded ON commit_files(excluded)`);
}

export function readSchema(): string {
  return readFileSync(schemaPath, 'utf8');
}

export function getSchemaVersion(db: DatabaseType): string | null {
  try {
    const row = db
      .prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'")
      .get() as { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}
