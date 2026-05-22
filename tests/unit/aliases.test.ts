import { describe, expect, it } from 'vitest';
import { calculateBusFactor } from '../../src/agents/insight/bus-factor.js';
import { createResolver, suggestAliases } from '../../src/config/aliases.js';
import { upsertCommit } from '../../src/storage/commits-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';

describe('alias resolver', () => {
  it('returns identity for unaliased emails', () => {
    const r = createResolver({});
    expect(r.resolve('foo@bar.com')).toBe('foo@bar.com');
    expect(r.hasAliases).toBe(false);
  });

  it('maps an alias to its canonical', () => {
    const r = createResolver({
      'alice@example.com': ['alice@oldcompany.com'],
    });
    expect(r.resolve('alice@oldcompany.com')).toBe('alice@example.com');
    expect(r.resolve('alice@example.com')).toBe('alice@example.com');
    expect(r.resolve('bob@example.com')).toBe('bob@example.com');
    expect(r.hasAliases).toBe(true);
  });

  it('is case-insensitive', () => {
    const r = createResolver({
      'Alice@example.com': ['alice@oldcompany.com'],
    });
    expect(r.resolve('ALICE@example.com')).toBe('Alice@example.com');
    expect(r.resolve('Alice@OldCompany.com')).toBe('Alice@example.com');
  });

  it('handles multiple aliases per canonical', () => {
    const r = createResolver({
      'alice@example.com': [
        'alice@oldcompany.com',
        '12345+alice@users.noreply.github.com',
      ],
    });
    expect(r.resolve('alice@oldcompany.com')).toBe('alice@example.com');
    expect(r.resolve('12345+alice@users.noreply.github.com')).toBe('alice@example.com');
  });
});

describe('alias suggestions', () => {
  it('groups identical names with different emails', () => {
    const suggestions = suggestAliases([
      { name: 'Alice Smith', email: 'alice@example.com', commits: 10 },
      { name: 'Alice Smith', email: 'alice@oldcompany.com', commits: 3 },
      { name: 'Bob Jones', email: 'bob@example.com', commits: 5 },
    ]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.name).toBe('Alice Smith');
    expect(suggestions[0]?.emails).toHaveLength(2);
  });

  it('orders emails within a suggestion by commit count', () => {
    const suggestions = suggestAliases([
      { name: 'Alice', email: 'b@x.com', commits: 1 },
      { name: 'Alice', email: 'a@x.com', commits: 100 },
    ]);
    expect(suggestions[0]?.emails[0]?.email).toBe('a@x.com');
    expect(suggestions[0]?.emails[1]?.email).toBe('b@x.com');
  });

  it('orders suggestions by total commit volume', () => {
    const suggestions = suggestAliases([
      { name: 'Alice', email: 'alice@a', commits: 2 },
      { name: 'Alice', email: 'alice@b', commits: 1 },
      { name: 'Bob', email: 'bob@a', commits: 50 },
      { name: 'Bob', email: 'bob@b', commits: 50 },
    ]);
    expect(suggestions[0]?.name).toBe('Bob');
    expect(suggestions[1]?.name).toBe('Alice');
  });

  it('returns no suggestions when no name appears twice', () => {
    expect(
      suggestAliases([
        { name: 'Alice', email: 'a@x', commits: 1 },
        { name: 'Bob', email: 'b@x', commits: 1 },
      ]),
    ).toEqual([]);
  });

  it('ignores empty or whitespace-only names', () => {
    expect(
      suggestAliases([
        { name: '', email: 'a@x', commits: 1 },
        { name: '  ', email: 'b@x', commits: 1 },
      ]),
    ).toEqual([]);
  });
});

describe('alias-aware bus factor', () => {
  // Helper to insert a synthetic commit-with-one-file-touch into an in-memory DB.
  function makeCommit(
    db: ReturnType<typeof openDatabase>,
    args: {
      hash: string;
      authorEmail: string;
      authorName: string;
      lines: number;
      date: Date;
    },
  ): void {
    upsertCommit(db, {
      commit: {
        hash: args.hash,
        shortHash: args.hash.slice(0, 7),
        author: { name: args.authorName, email: args.authorEmail },
        date: args.date,
        message: 'test',
        parentHashes: [],
        insertions: args.lines,
        deletions: 0,
        filesChanged: [
          {
            path: 'src/x.ts',
            status: 'modified',
            insertions: args.lines,
            deletions: 0,
            isBinary: false,
          },
        ],
      },
      category: 'normal',
      categoryReason: 'test',
    });
  }

  it('merges aliased emails so one human gets one contributor row', () => {
    const db = openDatabase({ memory: true });
    makeCommit(db, {
      hash: 'a'.repeat(40),
      authorEmail: 'alice@newco.com',
      authorName: 'Alice',
      lines: 100,
      date: new Date('2026-01-01'),
    });
    makeCommit(db, {
      hash: 'b'.repeat(40),
      authorEmail: 'alice@oldco.com',
      authorName: 'Alice',
      lines: 50,
      date: new Date('2025-06-01'),
    });
    makeCommit(db, {
      hash: 'c'.repeat(40),
      authorEmail: 'bob@example.com',
      authorName: 'Bob',
      lines: 25,
      date: new Date('2025-12-01'),
    });

    // Without aliases: 3 contributors, alice's two slots split her ownership.
    const noAliases = calculateBusFactor(db, 'src/x.ts');
    expect(noAliases.contributors).toHaveLength(3);

    // With aliases: alice's emails collapse to one row that combines both.
    const resolver = createResolver({ 'alice@newco.com': ['alice@oldco.com'] });
    const withAliases = calculateBusFactor(db, 'src/x.ts', resolver);
    expect(withAliases.contributors).toHaveLength(2);
    const alice = withAliases.contributors.find(
      (c) => c.authorEmail === 'alice@newco.com',
    );
    expect(alice).toBeDefined();
    // Combined: 100 + 50 = 150 lines, 2 commits, last touched at the newer date.
    expect(alice?.linesChanged).toBe(150);
    expect(alice?.commits).toBe(2);
    expect(alice?.lastCommit.getTime()).toBe(new Date('2026-01-01').getTime());

    // Alice's share moves from "150/175 split across two rows" to a clean
    // "150/175 = 86%". That should drop bus factor from 2 to 1 — single
    // point of failure becomes visible.
    expect(withAliases.busFactor).toBe(1);

    db.close();
  });
});
