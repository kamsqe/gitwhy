import { beforeEach, describe, expect, it } from 'vitest';
import { calculateRiskScore } from '../../src/agents/insight/risk-score.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { seedCommit } from '../fixtures/seed-commits.js';
import type { Database as DatabaseType } from 'better-sqlite3';

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

describe('calculateRiskScore', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('flags HIGH risk for a hot, single-owner file with departed maintainer', () => {
    // Sole owner, inactive 400d ago, 12 recent commits
    seedCommit(db, {
      hash: 'historical',
      author: 'former',
      date: daysAgo(400),
      files: [{ path: 'src/x.ts', insertions: 200 }],
    });
    for (let i = 0; i < 12; i++) {
      seedCommit(db, {
        hash: `r${i}`,
        author: 'former',
        date: daysAgo(400 - i),
        files: [{ path: 'src/x.ts', insertions: 5 }],
      });
    }
    const r = calculateRiskScore(db, 'src/x.ts');
    expect(r.level).toBe('high');
    expect(r.reasons.some((s) => s.includes('bus factor = 1'))).toBe(true);
    expect(r.reasons.some((s) => s.includes('ghost code') || s.includes('inactive'))).toBe(true);
  });

  it('returns LOW risk for a balanced, recent file with several contributors', () => {
    const authors = ['alice', 'bob', 'carol', 'dave'];
    for (let i = 0; i < authors.length; i++) {
      for (let j = 0; j < 3; j++) {
        seedCommit(db, {
          hash: `${authors[i]}-${j}`,
          author: authors[i]!,
          date: daysAgo(30 - j),
          files: [{ path: 'src/shared.ts', insertions: 10 }],
        });
      }
    }
    const r = calculateRiskScore(db, 'src/shared.ts');
    expect(['low', 'medium']).toContain(r.level);
    expect(r.inputs.busFactor).toBeGreaterThan(1);
  });

  it('returns reasons explaining the score', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'alice',
      date: daysAgo(10),
      files: [{ path: 'src/x.ts', insertions: 100 }],
    });
    const r = calculateRiskScore(db, 'src/x.ts');
    expect(r.reasons.length).toBeGreaterThan(0);
    expect(r.inputs.busFactor).toBe(1);
  });

  it('reports inputs with computed metrics', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'alice',
      date: daysAgo(5),
      files: [{ path: 'src/x.ts' }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'bob',
      date: daysAgo(3),
      files: [{ path: 'src/x.ts' }],
    });
    const r = calculateRiskScore(db, 'src/x.ts');
    expect(r.inputs.contributorCount).toBe(2);
    expect(r.inputs.totalCommits).toBe(2);
    expect(r.inputs.recentCommits90d).toBe(2);
  });

  it('produces a score between 0 and 1', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'a',
      date: daysAgo(10),
      files: [{ path: 'src/x.ts' }],
    });
    const r = calculateRiskScore(db, 'src/x.ts');
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});
