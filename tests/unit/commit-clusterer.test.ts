import { describe, expect, it } from 'vitest';
import { clusterCommits } from '../../src/indexer/commit-clusterer.js';
import type { CommitCategory, CommitInfo } from '../../src/indexer/types.js';

function commit(hash: string, isoDate: string, email = 'alice@example.com'): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: { name: 'Alice', email },
    date: new Date(isoDate),
    message: 'wip',
    parentHashes: ['p'],
    filesChanged: [
      { path: 'src/foo.ts', status: 'modified', insertions: 2, deletions: 1, isBinary: false },
    ],
    insertions: 2,
    deletions: 1,
  };
}

describe('clusterCommits', () => {
  it('groups consecutive micro-commits by the same author within the gap window', () => {
    const c1 = commit('aaaaaaa', '2026-01-01T10:00:00Z');
    const c2 = commit('bbbbbbb', '2026-01-01T10:10:00Z');
    const c3 = commit('ccccccc', '2026-01-01T10:20:00Z');
    const categories = new Map<string, CommitCategory>([
      [c1.hash, 'micro'],
      [c2.hash, 'micro'],
      [c3.hash, 'micro'],
    ]);
    const clusters = clusterCommits([c1, c2, c3], categories);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]?.commits.map((c) => c.hash)).toEqual([c1.hash, c2.hash, c3.hash]);
    expect(clusters[0]?.totalInsertions).toBe(6);
  });

  it('does not cluster a lone micro-commit', () => {
    const c1 = commit('a', '2026-01-01T10:00:00Z');
    const clusters = clusterCommits([c1], new Map([[c1.hash, 'micro']]));
    expect(clusters).toHaveLength(0);
  });

  it('breaks clusters when a non-micro commit appears', () => {
    const c1 = commit('a', '2026-01-01T10:00:00Z');
    const c2 = commit('b', '2026-01-01T10:05:00Z');
    const c3 = commit('c', '2026-01-01T10:10:00Z');
    const categories = new Map<string, CommitCategory>([
      [c1.hash, 'micro'],
      [c2.hash, 'normal'],
      [c3.hash, 'micro'],
    ]);
    const clusters = clusterCommits([c1, c2, c3], categories);
    expect(clusters).toHaveLength(0);
  });

  it('breaks clusters when author changes', () => {
    const c1 = commit('a', '2026-01-01T10:00:00Z', 'alice@x');
    const c2 = commit('b', '2026-01-01T10:05:00Z', 'bob@x');
    const c3 = commit('c', '2026-01-01T10:10:00Z', 'alice@x');
    const categories = new Map<string, CommitCategory>([
      [c1.hash, 'micro'],
      [c2.hash, 'micro'],
      [c3.hash, 'micro'],
    ]);
    expect(clusterCommits([c1, c2, c3], categories)).toHaveLength(0);
  });

  it('breaks clusters when the gap exceeds the threshold', () => {
    const c1 = commit('a', '2026-01-01T10:00:00Z');
    const c2 = commit('b', '2026-01-01T12:00:00Z');
    const categories = new Map<string, CommitCategory>([
      [c1.hash, 'micro'],
      [c2.hash, 'micro'],
    ]);
    const clusters = clusterCommits([c1, c2], categories, { maxGapMs: 30 * 60 * 1000 });
    expect(clusters).toHaveLength(0);
  });

  it('produces a stable clusterId derived from hash range', () => {
    const c1 = commit('aaaaaaa', '2026-01-01T10:00:00Z');
    const c2 = commit('bbbbbbb', '2026-01-01T10:05:00Z');
    const categories = new Map<string, CommitCategory>([
      [c1.hash, 'micro'],
      [c2.hash, 'micro'],
    ]);
    const clusters = clusterCommits([c1, c2], categories);
    expect(clusters[0]?.clusterId).toBe('cluster_aaaaaaa_bbbbbbb_2');
  });

  it('handles input regardless of order (sorts by date internally)', () => {
    const c1 = commit('a', '2026-01-01T10:00:00Z');
    const c2 = commit('b', '2026-01-01T10:05:00Z');
    const c3 = commit('c', '2026-01-01T10:10:00Z');
    const categories = new Map<string, CommitCategory>([
      [c1.hash, 'micro'],
      [c2.hash, 'micro'],
      [c3.hash, 'micro'],
    ]);
    const clusters = clusterCommits([c3, c1, c2], categories);
    expect(clusters[0]?.commits.map((c) => c.hash)).toEqual(['a', 'b', 'c']);
  });
});
