import { beforeEach, describe, expect, it } from 'vitest';
import { detectGhostCode } from '../../src/agents/insight/ghost-code.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { seedCommit } from '../fixtures/seed-commits.js';
import type { Database as DatabaseType } from 'better-sqlite3';

const longAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

describe('detectGhostCode', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('flags files where the sole owner has been inactive past the threshold', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'departed',
      date: longAgo(400),
      files: [{ path: 'src/legacy.ts', insertions: 100 }],
    });
    const ghosts = detectGhostCode(db, { inactiveAfterDays: 180 });
    expect(ghosts.map((g) => g.path)).toContain('src/legacy.ts');
    const g = ghosts.find((g) => g.path === 'src/legacy.ts')!;
    expect(g.soleOwnerName).toBe('departed');
    expect(g.ownerSharePercent).toBe(100);
    expect(g.daysSinceOwnerActive).toBeGreaterThan(180);
  });

  it('does not flag files where the sole owner is still active', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'active',
      date: longAgo(10),
      files: [{ path: 'src/active.ts', insertions: 50 }],
    });
    expect(detectGhostCode(db).find((g) => g.path === 'src/active.ts')).toBeUndefined();
  });

  it('does not flag files with multiple roughly-equal contributors', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'alice',
      date: longAgo(400),
      files: [{ path: 'shared.ts', insertions: 50 }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'bob',
      date: longAgo(390),
      files: [{ path: 'shared.ts', insertions: 50 }],
    });
    expect(detectGhostCode(db).find((g) => g.path === 'shared.ts')).toBeUndefined();
  });

  it('flags a file with one dominant inactive contributor (>=80%)', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'former',
      date: longAgo(400),
      files: [{ path: 'src/x.ts', insertions: 90 }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'newer',
      date: longAgo(30),
      files: [{ path: 'src/x.ts', insertions: 5 }],
    });
    const found = detectGhostCode(db, { inactiveAfterDays: 180 }).find((g) => g.path === 'src/x.ts');
    expect(found).toBeDefined();
    expect(found?.soleOwnerName).toBe('former');
    expect(found?.ownerSharePercent).toBeGreaterThanOrEqual(80);
  });

  it('respects custom soleOwnerSharePercent threshold', () => {
    seedCommit(db, {
      hash: 'a',
      author: 'former',
      date: longAgo(400),
      files: [{ path: 'src/x.ts', insertions: 60 }],
    });
    seedCommit(db, {
      hash: 'b',
      author: 'newer',
      date: longAgo(30),
      files: [{ path: 'src/x.ts', insertions: 40 }],
    });
    expect(
      detectGhostCode(db, { soleOwnerSharePercent: 50 }).find((g) => g.path === 'src/x.ts'),
    ).toBeDefined();
    expect(
      detectGhostCode(db, { soleOwnerSharePercent: 80 }).find((g) => g.path === 'src/x.ts'),
    ).toBeUndefined();
  });
});
