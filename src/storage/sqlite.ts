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
  }
  return db;
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
