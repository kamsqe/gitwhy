import { beforeEach, describe, expect, it } from 'vitest';
import { findRelatedFiles } from '../../src/agents/insight/co-change.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { seedCommit } from '../fixtures/seed-commits.js';
import type { Database as DatabaseType } from 'better-sqlite3';

describe('findRelatedFiles', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('returns files that frequently co-change with the target', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'a',
      date: '2026-01-01',
      files: [{ path: 'src/api.ts' }, { path: 'src/api.test.ts' }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'a',
      date: '2026-01-02',
      files: [{ path: 'src/api.ts' }, { path: 'src/api.test.ts' }, { path: 'src/types.ts' }],
    });
    seedCommit(db, {
      hash: 'c',
      author: 'a',
      date: '2026-01-03',
      files: [{ path: 'src/api.ts' }, { path: 'src/api.test.ts' }, { path: 'src/types.ts' }],
    });
    const related = findRelatedFiles(db, 'src/api.ts');
    expect(related.map((r) => r.path)).toEqual(['src/api.test.ts', 'src/types.ts']);
    expect(related[0]?.coCommits).toBe(3);
    expect(related[0]?.forwardConfidence).toBe(1);
  });

  it('returns empty array for an unknown path', () => {
    expect(findRelatedFiles(db, 'nope.ts')).toEqual([]);
  });

  it('honors minCoCommits threshold', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'a',
      date: '2026-01-01',
      files: [{ path: 'main.ts' }, { path: 'rare.ts' }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'a',
      date: '2026-01-02',
      files: [{ path: 'main.ts' }, { path: 'common.ts' }],
    });
    seedCommit(db, {
      hash: 'c',
      author: 'a',
      date: '2026-01-03',
      files: [{ path: 'main.ts' }, { path: 'common.ts' }],
    });
    const result = findRelatedFiles(db, 'main.ts', { minCoCommits: 2 });
    expect(result.map((r) => r.path)).toEqual(['common.ts']);
  });

  it('excludes merge/bot/formatting commits', () => {
    seedCommit(db, {
      hash: 'm',
      author: 'a',
      date: '2026-01-01',
      category: 'merge',
      files: [{ path: 'a.ts' }, { path: 'b.ts' }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'a',
      date: '2026-01-02',
      category: 'bot',
      files: [{ path: 'a.ts' }, { path: 'b.ts' }],
    });
    expect(findRelatedFiles(db, 'a.ts')).toEqual([]);
  });

  it('computes a meaningful forwardConfidence ratio', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'a',
      date: '2026-01-01',
      files: [{ path: 'x.ts' }, { path: 'y.ts' }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'a',
      date: '2026-01-02',
      files: [{ path: 'x.ts' }, { path: 'y.ts' }],
    });
    seedCommit(db, {
      hash: 'c',
      author: 'a',
      date: '2026-01-03',
      files: [{ path: 'x.ts' }],
    });
    const r = findRelatedFiles(db, 'x.ts');
    const y = r.find((rf) => rf.path === 'y.ts')!;
    expect(y.thisFileCommits).toBe(3);
    expect(y.coCommits).toBe(2);
    expect(y.forwardConfidence).toBeCloseTo(2 / 3, 5);
  });
});
