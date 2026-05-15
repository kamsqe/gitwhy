import { beforeEach, describe, expect, it } from 'vitest';
import { getHotspots } from '../../src/agents/insight/hotspots.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { seedCommit } from '../fixtures/seed-commits.js';
import type { Database as DatabaseType } from 'better-sqlite3';

describe('getHotspots', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('ranks files by recent commit count × total commit count', () => {
    const now = new Date();
    const recent = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();

    seedCommit(db, { hash: 'r1', author: 'a', date: recent, files: [{ path: 'hot.ts' }] });
    seedCommit(db, { hash: 'r2', author: 'a', date: recent, files: [{ path: 'hot.ts' }] });
    seedCommit(db, { hash: 'r3', author: 'a', date: recent, files: [{ path: 'hot.ts' }] });
    seedCommit(db, { hash: 'o1', author: 'a', date: old, files: [{ path: 'hot.ts' }] });
    seedCommit(db, { hash: 'r4', author: 'a', date: recent, files: [{ path: 'cold.ts' }] });

    const hotspots = getHotspots(db, { recentDays: 30 });
    expect(hotspots[0]?.path).toBe('hot.ts');
    expect(hotspots[0]?.recentCommits).toBe(3);
    expect(hotspots[0]?.totalCommits).toBe(4);
  });

  it('excludes files with zero recent activity', () => {
    const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    seedCommit(db, {
      hash: 'a',
      author: 'a',
      date: oldDate,
      files: [{ path: 'ancient.ts' }],
    });
    const hotspots = getHotspots(db, { recentDays: 90 });
    expect(hotspots.find((h) => h.path === 'ancient.ts')).toBeUndefined();
  });

  it('excludes binary files', () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    // Binary file (we need to mark it; the seedCommit fixture defaults isBinary=false,
    // so we use direct SQL update)
    seedCommit(db, {
      hash: 'a',
      author: 'a',
      date: recent,
      files: [{ path: 'logo.png' }],
    });
    db.prepare(`UPDATE commit_files SET is_binary = 1 WHERE path = 'logo.png'`).run();
    expect(getHotspots(db).find((h) => h.path === 'logo.png')).toBeUndefined();
  });

  it('skips merge/bot/formatting commits in the count', () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    seedCommit(db, {
      hash: 'b1',
      author: 'bot',
      date: recent,
      category: 'bot',
      files: [{ path: 'src/x.ts' }],
    });
    seedCommit(db, {
      hash: 'm1',
      author: 'a',
      date: recent,
      category: 'merge',
      files: [{ path: 'src/x.ts' }],
    });
    seedCommit(db, {
      hash: 'h1',
      author: 'a',
      date: recent,
      files: [{ path: 'src/x.ts' }],
    });
    const hot = getHotspots(db).find((h) => h.path === 'src/x.ts');
    expect(hot?.totalCommits).toBe(1);
  });

  it('honors the pathPrefix scope filter', () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    seedCommit(db, { hash: 'a', author: 'a', date: recent, files: [{ path: 'src/x.ts' }] });
    seedCommit(db, { hash: 'b', author: 'a', date: recent, files: [{ path: 'tests/x.ts' }] });
    const onlySrc = getHotspots(db, { pathPrefix: 'src/' });
    expect(onlySrc.every((h) => h.path.startsWith('src/'))).toBe(true);
  });

  it('respects the limit option', () => {
    const recent = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
    for (let i = 0; i < 10; i++) {
      seedCommit(db, {
        hash: `h${i}`,
        author: 'a',
        date: recent,
        files: [{ path: `file${i}.ts` }],
      });
    }
    expect(getHotspots(db, { limit: 3 })).toHaveLength(3);
  });
});
