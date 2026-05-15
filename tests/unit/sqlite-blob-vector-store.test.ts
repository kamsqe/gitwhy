import { beforeEach, describe, expect, it } from 'vitest';
import { upsertCommit } from '../../src/storage/commits-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import {
  cosineSimilarity,
  createSqliteBlobVectorStore,
} from '../../src/providers/vector/sqlite-blob.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitInfo } from '../../src/indexer/types.js';

function makeCommit(hash: string): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: { name: 'Test', email: 't@x' },
    date: new Date('2026-01-01T00:00:00Z'),
    message: 'test',
    parentHashes: [],
    filesChanged: [],
    insertions: 0,
    deletions: 0,
  };
}

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const a = Float32Array.from([1, 0, 0]);
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(
      cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([0, 1])),
    ).toBeCloseTo(0, 5);
  });

  it('returns ~-1 for opposite vectors', () => {
    expect(
      cosineSimilarity(Float32Array.from([1, 0]), Float32Array.from([-1, 0])),
    ).toBeCloseTo(-1, 5);
  });

  it('returns 0 for zero-length input', () => {
    expect(cosineSimilarity(new Float32Array(0), new Float32Array(0))).toBe(0);
  });

  it('returns 0 for mismatched dimensions', () => {
    expect(
      cosineSimilarity(Float32Array.from([1, 2]), Float32Array.from([1, 2, 3])),
    ).toBe(0);
  });
});

describe('SqliteBlobVectorStore', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
    for (const hash of ['a', 'b', 'c']) {
      upsertCommit(db, {
        commit: makeCommit(hash),
        category: 'normal',
        categoryReason: 'r',
      });
    }
  });

  it('returns top-K results ordered by similarity', async () => {
    const store = createSqliteBlobVectorStore({ db });
    await store.upsert([
      { id: 'a', embedding: [1, 0, 0], metadata: { model: 'm' } },
      { id: 'b', embedding: [0, 1, 0], metadata: { model: 'm' } },
      { id: 'c', embedding: [0.9, 0.1, 0], metadata: { model: 'm' } },
    ]);

    const results = await store.query([1, 0, 0], { topK: 2 });
    expect(results).toHaveLength(2);
    expect(results[0]?.id).toBe('a');
    expect(results[1]?.id).toBe('c');
    expect(results[0]?.score).toBeCloseTo(1, 5);
  });

  it('respects topK=0 by returning empty', async () => {
    const store = createSqliteBlobVectorStore({ db });
    await store.upsert([{ id: 'a', embedding: [1, 0], metadata: {} }]);
    expect(await store.query([1, 0], { topK: 0 })).toEqual([]);
  });

  it('count() reflects upserts and deletes', async () => {
    const store = createSqliteBlobVectorStore({ db });
    await store.upsert([
      { id: 'a', embedding: [1, 0], metadata: {} },
      { id: 'b', embedding: [0, 1], metadata: {} },
    ]);
    expect(await store.count()).toBe(2);
    await store.delete(['a']);
    expect(await store.count()).toBe(1);
  });

  it('preserves float32 precision across round trip', async () => {
    const store = createSqliteBlobVectorStore({ db });
    const original = [0.123456, -0.987654, 0.5];
    await store.upsert([{ id: 'a', embedding: original, metadata: {} }]);
    const results = await store.query(original, { topK: 1 });
    expect(results[0]?.score).toBeCloseTo(1, 5);
  });

  it('exposes a stable name property', () => {
    const store = createSqliteBlobVectorStore({ db });
    expect(store.name).toBe('sqlite-blob');
  });
});
