import { beforeEach, describe, expect, it } from 'vitest';
import { calculateBusFactor } from '../../src/agents/insight/bus-factor.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { seedCommit } from '../fixtures/seed-commits.js';
import type { Database as DatabaseType } from 'better-sqlite3';

describe('calculateBusFactor', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('returns busFactor=1 when one author owns >50% of changes', () => {
    seedCommit(db, {
      hash: 'a1',
      author: 'alice',
      date: '2026-01-01',
      files: [{ path: 'src/x.ts', insertions: 100, deletions: 0 }],
    });
    seedCommit(db, {
      hash: 'a2',
      author: 'alice',
      date: '2026-01-02',
      files: [{ path: 'src/x.ts', insertions: 100, deletions: 0 }],
    });
    seedCommit(db, {
      hash: 'a3',
      author: 'bob',
      date: '2026-01-03',
      files: [{ path: 'src/x.ts', insertions: 5, deletions: 0 }],
    });
    const r = calculateBusFactor(db, 'src/x.ts');
    expect(r.busFactor).toBe(1);
    expect(r.contributors).toHaveLength(2);
    expect(r.contributors[0]?.authorName).toBe('alice');
    expect(r.soleOwner?.authorName).toBe('alice');
  });

  it('returns busFactor=2 when two authors are needed to cross 50%', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'alice',
      date: '2026-01-01',
      files: [{ path: 'src/x.ts', insertions: 30 }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'bob',
      date: '2026-01-02',
      files: [{ path: 'src/x.ts', insertions: 30 }],
    });
    seedCommit(db, {
      hash: 'c',
      author: 'carol',
      date: '2026-01-03',
      files: [{ path: 'src/x.ts', insertions: 20 }],
    });
    seedCommit(db, {
      hash: 'd',
      author: 'dave',
      date: '2026-01-04',
      files: [{ path: 'src/x.ts', insertions: 20 }],
    });
    const r = calculateBusFactor(db, 'src/x.ts');
    expect(r.busFactor).toBe(2);
    expect(r.soleOwner).toBeNull();
  });

  it('excludes merge and bot commits from ownership calculation', () => {
    seedCommit(db, {
      hash: 'human',
      author: 'alice',
      date: '2026-01-01',
      files: [{ path: 'src/x.ts', insertions: 50, deletions: 0 }],
    });
    seedCommit(db, {
      hash: 'merge1',
      author: 'someone',
      date: '2026-01-02',
      category: 'merge',
      files: [{ path: 'src/x.ts', insertions: 10000, deletions: 0 }],
    });
    seedCommit(db, {
      hash: 'bot1',
      author: 'dependabot',
      date: '2026-01-03',
      category: 'bot',
      files: [{ path: 'src/x.ts', insertions: 5000, deletions: 0 }],
    });
    const r = calculateBusFactor(db, 'src/x.ts');
    expect(r.contributors.map((c) => c.authorName)).toEqual(['alice']);
    expect(r.totalLinesChanged).toBe(50);
  });

  it('aggregates over a directory prefix', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'alice',
      date: '2026-01-01',
      files: [
        { path: 'src/auth/login.ts', insertions: 10, deletions: 0 },
        { path: 'src/auth/logout.ts', insertions: 5, deletions: 0 },
        { path: 'src/payment/charge.ts', insertions: 30, deletions: 0 },
      ],
    });
    const r = calculateBusFactor(db, 'src/auth/');
    expect(r.totalLinesChanged).toBe(15);
  });

  it('returns zero contributors for an unknown path', () => {
    const r = calculateBusFactor(db, 'src/nope.ts');
    expect(r.contributors).toHaveLength(0);
    expect(r.busFactor).toBe(0);
  });
});
