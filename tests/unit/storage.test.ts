import { describe, expect, it } from 'vitest';
import { getSchemaVersion, openDatabase } from '../../src/storage/sqlite.js';

describe('storage / sqlite', () => {
  it('opens an in-memory database and applies the schema', () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    expect(getSchemaVersion(db)).toBe('1');
    db.close();
  });

  it('creates the expected tables', () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain('commits');
    expect(names).toContain('commit_files');
    expect(names).toContain('commit_clusters');
    expect(names).toContain('commit_cluster_members');
    expect(names).toContain('llm_calls');
    expect(names).toContain('schema_meta');
    db.close();
  });
});
