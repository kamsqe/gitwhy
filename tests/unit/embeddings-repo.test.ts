import { beforeEach, describe, expect, it } from 'vitest';
import {
  countCommitEmbeddings,
  deleteCommitEmbedding,
  getCommitEmbedding,
  loadAllCommitEmbeddings,
  upsertCommitEmbedding,
} from '../../src/storage/embeddings-repo.js';
import { upsertCommit } from '../../src/storage/commits-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitInfo } from '../../src/indexer/types.js';

function makeCommit(hash: string): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: { name: 'Test', email: 'test@example.com' },
    date: new Date('2026-01-01T00:00:00Z'),
    message: 'test',
    parentHashes: ['parent'],
    filesChanged: [],
    insertions: 0,
    deletions: 0,
  };
}

describe('embeddings repo', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
    upsertCommit(db, { commit: makeCommit('aaa'), category: 'normal', categoryReason: 'r' });
    upsertCommit(db, { commit: makeCommit('bbb'), category: 'normal', categoryReason: 'r' });
  });

  it('upserts and reads back an embedding with exact float values', () => {
    upsertCommitEmbedding(db, {
      commitHash: 'aaa',
      embedding: [0.1, 0.2, 0.3, 0.4],
      model: 'test-embed-1',
    });
    const got = getCommitEmbedding(db, 'aaa');
    expect(got?.dimensions).toBe(4);
    expect(got?.model).toBe('test-embed-1');
    expect(got?.embedding[0]).toBeCloseTo(0.1, 5);
    expect(got?.embedding[1]).toBeCloseTo(0.2, 5);
    expect(got?.embedding[3]).toBeCloseTo(0.4, 5);
  });

  it('overwrites an existing embedding on second upsert', () => {
    upsertCommitEmbedding(db, {
      commitHash: 'aaa',
      embedding: [1, 0, 0],
      model: 'v1',
    });
    upsertCommitEmbedding(db, {
      commitHash: 'aaa',
      embedding: [0, 1, 0],
      model: 'v2',
    });
    const got = getCommitEmbedding(db, 'aaa');
    expect(got?.model).toBe('v2');
    expect(got?.embedding[1]).toBeCloseTo(1, 5);
  });

  it('cascades on commit deletion (FK cleanup)', () => {
    upsertCommitEmbedding(db, {
      commitHash: 'aaa',
      embedding: [0.1, 0.2],
      model: 'm',
    });
    db.prepare(`DELETE FROM commits WHERE hash = 'aaa'`).run();
    expect(getCommitEmbedding(db, 'aaa')).toBeNull();
  });

  it('returns null for unknown commits', () => {
    expect(getCommitEmbedding(db, 'nope')).toBeNull();
  });

  it('counts and lists all embeddings', () => {
    upsertCommitEmbedding(db, { commitHash: 'aaa', embedding: [1, 0], model: 'm' });
    upsertCommitEmbedding(db, { commitHash: 'bbb', embedding: [0, 1], model: 'm' });
    expect(countCommitEmbeddings(db)).toBe(2);
    const all = loadAllCommitEmbeddings(db);
    expect(all.map((e) => e.commitHash).sort()).toEqual(['aaa', 'bbb']);
  });

  it('deleteCommitEmbedding removes only the matching row', () => {
    upsertCommitEmbedding(db, { commitHash: 'aaa', embedding: [1, 0], model: 'm' });
    upsertCommitEmbedding(db, { commitHash: 'bbb', embedding: [0, 1], model: 'm' });
    deleteCommitEmbedding(db, 'aaa');
    expect(countCommitEmbeddings(db)).toBe(1);
    expect(getCommitEmbedding(db, 'bbb')).not.toBeNull();
  });
});
