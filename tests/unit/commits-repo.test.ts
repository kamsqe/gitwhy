import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../../src/storage/sqlite.js';
import {
  countCommits,
  getCommit,
  getIndexedHashes,
  getUsageSummary,
  hasCommit,
  listCommits,
  recordLlmCall,
  upsertCluster,
  upsertCommit,
} from '../../src/storage/commits-repo.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitInfo } from '../../src/indexer/types.js';
import type { CommitCluster } from '../../src/indexer/commit-clusterer.js';

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123def456',
    shortHash: 'abc123d',
    author: { name: 'Alice', email: 'alice@example.com' },
    date: new Date('2026-01-01T10:00:00Z'),
    message: 'fix bug',
    parentHashes: ['parent1'],
    filesChanged: [
      { path: 'src/foo.ts', status: 'modified', insertions: 5, deletions: 2, isBinary: false },
      { path: 'src/bar.ts', status: 'added', insertions: 10, deletions: 0, isBinary: false },
    ],
    insertions: 15,
    deletions: 2,
    ...overrides,
  };
}

describe('commits repo', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  describe('upsertCommit', () => {
    it('inserts a new commit with its files', () => {
      const commit = makeCommit();
      upsertCommit(db, {
        commit,
        category: 'normal',
        categoryReason: '17 lines changed',
      });

      expect(hasCommit(db, commit.hash)).toBe(true);
      const stored = getCommit(db, commit.hash);
      expect(stored?.message).toBe('fix bug');
      expect(stored?.category).toBe('normal');
      expect(stored?.insertions).toBe(15);

      const fileRows = db.prepare(`SELECT path FROM commit_files WHERE commit_hash = ?`).all(commit.hash) as Array<{ path: string }>;
      expect(fileRows.map((r) => r.path).sort()).toEqual(['src/bar.ts', 'src/foo.ts']);
    });

    it('updates an existing commit (idempotent for re-indexing)', () => {
      const commit = makeCommit();
      upsertCommit(db, { commit, category: 'normal', categoryReason: 'first pass' });
      upsertCommit(db, {
        commit,
        category: 'normal',
        categoryReason: 'reindexed',
        enrichedSummary: 'AI summary here',
        enrichmentModel: 'gpt-4o-mini',
      });

      const stored = getCommit(db, commit.hash);
      expect(stored?.enrichedSummary).toBe('AI summary here');
      expect(stored?.enrichmentModel).toBe('gpt-4o-mini');
      expect(stored?.categoryReason).toBe('reindexed');
      expect(countCommits(db)).toBe(1);
    });

    it('preserves enriched_summary when re-upserting without one', () => {
      const commit = makeCommit();
      upsertCommit(db, {
        commit,
        category: 'normal',
        categoryReason: 'r',
        enrichedSummary: 'preserve me',
        enrichmentModel: 'gpt-4o-mini',
      });
      upsertCommit(db, { commit, category: 'normal', categoryReason: 'r2' });
      const stored = getCommit(db, commit.hash);
      expect(stored?.enrichedSummary).toBe('preserve me');
    });

    it('preserves parent hashes via JSON encoding', () => {
      const commit = makeCommit({ parentHashes: ['p1', 'p2', 'p3'] });
      upsertCommit(db, { commit, category: 'merge', categoryReason: '3 parents' });
      expect(getCommit(db, commit.hash)?.parentHashes).toEqual(['p1', 'p2', 'p3']);
    });
  });

  describe('getIndexedHashes', () => {
    it('returns the set of all indexed commit hashes', () => {
      upsertCommit(db, {
        commit: makeCommit({ hash: 'aaa' }),
        category: 'normal',
        categoryReason: 'r',
      });
      upsertCommit(db, {
        commit: makeCommit({ hash: 'bbb' }),
        category: 'normal',
        categoryReason: 'r',
      });
      expect(getIndexedHashes(db)).toEqual(new Set(['aaa', 'bbb']));
    });
  });

  describe('listCommits', () => {
    it('returns commits in reverse chronological order', () => {
      upsertCommit(db, {
        commit: makeCommit({ hash: 'old', date: new Date('2026-01-01T00:00:00Z') }),
        category: 'normal',
        categoryReason: 'r',
      });
      upsertCommit(db, {
        commit: makeCommit({ hash: 'new', date: new Date('2026-02-01T00:00:00Z') }),
        category: 'normal',
        categoryReason: 'r',
      });
      const result = listCommits(db);
      expect(result.map((c) => c.hash)).toEqual(['new', 'old']);
    });

    it('honors limit', () => {
      for (let i = 0; i < 5; i++) {
        upsertCommit(db, {
          commit: makeCommit({ hash: `c${i}`, date: new Date(2026, 0, 1 + i) }),
          category: 'normal',
          categoryReason: 'r',
        });
      }
      expect(listCommits(db, { limit: 2 })).toHaveLength(2);
    });
  });

  describe('LLM call accounting', () => {
    it('records and aggregates usage', () => {
      upsertCommit(db, {
        commit: makeCommit({ hash: 'abc' }),
        category: 'normal',
        categoryReason: 'r',
      });
      recordLlmCall(db, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        purpose: 'enrich_commit',
        promptTokens: 100,
        completionTokens: 50,
        costUsd: 0.0015,
        relatedCommit: 'abc',
      });
      recordLlmCall(db, {
        provider: 'openai',
        model: 'gpt-4o-mini',
        purpose: 'embed',
        promptTokens: 200,
        completionTokens: 0,
        costUsd: 0.0004,
      });

      const summary = getUsageSummary(db);
      expect(summary.calls).toBe(2);
      expect(summary.promptTokens).toBe(300);
      expect(summary.completionTokens).toBe(50);
      expect(summary.costUsd).toBeCloseTo(0.0019, 4);
    });
  });

  describe('upsertCluster', () => {
    it('stores a cluster and its member commits', () => {
      const c1 = makeCommit({ hash: 'aaa' });
      const c2 = makeCommit({ hash: 'bbb', date: new Date('2026-01-01T10:30:00Z') });
      upsertCommit(db, { commit: c1, category: 'micro', categoryReason: 'r' });
      upsertCommit(db, { commit: c2, category: 'micro', categoryReason: 'r' });

      const cluster: CommitCluster = {
        clusterId: 'cluster_aaa_bbb_2',
        author: { name: 'Alice', email: 'alice@example.com' },
        commits: [c1, c2],
        startedAt: c1.date,
        endedAt: c2.date,
        totalInsertions: 30,
        totalDeletions: 4,
        affectedFiles: ['src/foo.ts', 'src/bar.ts'],
      };
      upsertCluster(db, cluster, 'cluster summary');

      const row = db.prepare(`SELECT * FROM commit_clusters WHERE cluster_id = ?`).get(cluster.clusterId) as { enriched_summary: string; commit_count: number };
      expect(row.enriched_summary).toBe('cluster summary');
      expect(row.commit_count).toBe(2);

      const members = db.prepare(`SELECT commit_hash FROM commit_cluster_members WHERE cluster_id = ?`).all(cluster.clusterId) as Array<{ commit_hash: string }>;
      expect(members.map((m) => m.commit_hash).sort()).toEqual(['aaa', 'bbb']);
    });
  });
});
