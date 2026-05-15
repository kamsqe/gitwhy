import { describe, expect, it } from 'vitest';
import {
  botCategorizer,
  initialCategorizer,
  isVagueMessage,
  mergeCategorizer,
  revertCategorizer,
  sizeCategorizer,
} from '../../src/indexer/categorizers/builtin.js';
import type { CommitInfo } from '../../src/indexer/types.js';

function makeCommit(overrides: Partial<CommitInfo> = {}): CommitInfo {
  return {
    hash: 'abc123def456',
    shortHash: 'abc123d',
    author: { name: 'Test', email: 'test@example.com' },
    date: new Date('2026-01-01T00:00:00Z'),
    message: 'add foo',
    parentHashes: ['parent1'],
    filesChanged: [
      { path: 'src/foo.ts', status: 'modified', insertions: 5, deletions: 2, isBinary: false },
    ],
    insertions: 5,
    deletions: 2,
    ...overrides,
  };
}

describe('mergeCategorizer', () => {
  it('matches commits with two or more parents', () => {
    const result = mergeCategorizer.categorize(makeCommit({ parentHashes: ['a', 'b'] }));
    expect(result?.category).toBe('merge');
  });
  it('does not match single-parent commits', () => {
    expect(mergeCategorizer.categorize(makeCommit({ parentHashes: ['a'] }))).toBeNull();
  });
});

describe('initialCategorizer', () => {
  it('matches commits with no parents', () => {
    expect(initialCategorizer.categorize(makeCommit({ parentHashes: [] }))?.category).toBe('initial');
  });
  it('does not match commits with parents', () => {
    expect(initialCategorizer.categorize(makeCommit({ parentHashes: ['a'] }))).toBeNull();
  });
});

describe('botCategorizer', () => {
  it.each([
    ['dependabot[bot]', 'dependabot[bot]@users.noreply.github.com'],
    ['github-actions[bot]', '41898282+github-actions[bot]@users.noreply.github.com'],
    ['renovate[bot]', 'renovate[bot]@users.noreply.github.com'],
  ])('detects %s via email', (_, email) => {
    expect(botCategorizer.categorize(makeCommit({ author: { name: 'Bot', email } }))?.category).toBe('bot');
  });

  it('detects bots by name pattern', () => {
    expect(
      botCategorizer.categorize(
        makeCommit({ author: { name: 'dependabot[bot]', email: 'somewhere@example.com' } }),
      )?.category,
    ).toBe('bot');
  });

  it('detects dependabot-style commit messages even with non-obvious email', () => {
    expect(
      botCategorizer.categorize(
        makeCommit({
          author: { name: 'CI Bot', email: 'noreply@something.example' },
          message: 'chore(deps): bump lodash from 4.17.20 to 4.17.21',
        }),
      )?.category,
    ).toBe('bot');
  });

  it('does not match human commits with normal emails', () => {
    expect(botCategorizer.categorize(makeCommit())).toBeNull();
  });
});

describe('revertCategorizer', () => {
  it('matches commits with messages starting with Revert', () => {
    expect(revertCategorizer.categorize(makeCommit({ message: 'Revert "broken feature"' }))?.category).toBe('revert');
  });
  it('is case-insensitive', () => {
    expect(revertCategorizer.categorize(makeCommit({ message: 'revert: feature' }))?.category).toBe('revert');
  });
  it('does not match commits that merely mention revert', () => {
    expect(revertCategorizer.categorize(makeCommit({ message: 'fix bug exposed by revert' }))).toBeNull();
  });
});

describe('sizeCategorizer', () => {
  it('classifies large commits as mega', () => {
    expect(
      sizeCategorizer.categorize(makeCommit({ insertions: 600, deletions: 0 }))?.category,
    ).toBe('mega');
  });

  it('classifies small + vague commits as micro', () => {
    expect(
      sizeCategorizer.categorize(makeCommit({ insertions: 5, deletions: 3, message: 'wip' }))?.category,
    ).toBe('micro');
  });

  it('classifies small + descriptive commits as normal', () => {
    expect(
      sizeCategorizer.categorize(
        makeCommit({
          insertions: 5,
          deletions: 3,
          message: 'add null guard before pricing lookup to prevent crash',
        }),
      )?.category,
    ).toBe('normal');
  });

  it('classifies medium-sized commits as normal regardless of message', () => {
    expect(
      sizeCategorizer.categorize(makeCommit({ insertions: 100, deletions: 50, message: 'wip' }))?.category,
    ).toBe('normal');
  });

  it('has priority 10 (runs last in default order)', () => {
    expect(sizeCategorizer.priority).toBe(10);
  });
});

describe('isVagueMessage', () => {
  it.each(['fix', 'wip', 'wip2', 'update', 'changes', 'tmp', 'misc', '..', 'a'])(
    'treats %s as vague',
    (msg) => {
      expect(isVagueMessage(msg)).toBe(true);
    },
  );

  it.each([
    'add null guard before pricing lookup',
    'Refactor PaymentService to extract retry logic',
    'feat: introduce streaming response support',
  ])('treats %s as not vague', (msg) => {
    expect(isVagueMessage(msg)).toBe(false);
  });
});
