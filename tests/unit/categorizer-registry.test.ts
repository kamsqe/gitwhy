import { afterEach, describe, expect, it } from 'vitest';
import {
  categorize,
  clearCategorizers,
  listCategorizers,
  registerCategorizer,
} from '../../src/indexer/categorizers/registry.js';
import type { CommitInfo } from '../../src/indexer/types.js';

const exampleCommit: CommitInfo = {
  hash: 'abc123def',
  shortHash: 'abc123d',
  author: { name: 'Test', email: 'test@example.com' },
  date: new Date('2026-01-01T00:00:00Z'),
  message: 'fix',
  parentHashes: ['parent1'],
  filesChanged: [
    {
      path: 'src/foo.ts',
      status: 'modified',
      insertions: 1,
      deletions: 1,
      isBinary: false,
    },
  ],
  insertions: 1,
  deletions: 1,
};

describe('categorizer registry', () => {
  afterEach(() => {
    clearCategorizers();
  });

  it('returns the normal fallback when no categorizers are registered', () => {
    const result = categorize(exampleCommit);
    expect(result.category).toBe('normal');
    expect(result.confidence).toBe(0.5);
  });

  it('runs categorizers in priority order, taking the first non-null', () => {
    registerCategorizer({
      name: 'low-priority-merge',
      priority: 1,
      categorize: () => ({ category: 'merge', confidence: 1, reason: 'low' }),
    });
    registerCategorizer({
      name: 'high-priority-micro',
      priority: 10,
      categorize: () => ({ category: 'micro', confidence: 1, reason: 'high' }),
    });
    const result = categorize(exampleCommit);
    expect(result.category).toBe('micro');
    expect(result.reason).toBe('high');
  });

  it('skips categorizers that return null and tries the next', () => {
    registerCategorizer({
      name: 'returns-null',
      priority: 10,
      categorize: () => null,
    });
    registerCategorizer({
      name: 'returns-bot',
      priority: 5,
      categorize: () => ({ category: 'bot', confidence: 0.9, reason: 'pattern' }),
    });
    expect(categorize(exampleCommit).category).toBe('bot');
  });

  it('rejects duplicate registrations by name', () => {
    registerCategorizer({
      name: 'duplicate',
      priority: 1,
      categorize: () => null,
    });
    expect(() =>
      registerCategorizer({
        name: 'duplicate',
        priority: 2,
        categorize: () => null,
      }),
    ).toThrow(/already registered/);
  });

  it('listCategorizers reflects registration order by priority', () => {
    registerCategorizer({ name: 'a', priority: 1, categorize: () => null });
    registerCategorizer({ name: 'b', priority: 5, categorize: () => null });
    registerCategorizer({ name: 'c', priority: 3, categorize: () => null });
    expect(listCategorizers().map((c) => c.name)).toEqual(['b', 'c', 'a']);
  });
});
