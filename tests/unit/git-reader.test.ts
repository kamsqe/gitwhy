import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGitReader } from '../../src/indexer/git-reader.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';
import type { CommitInfo } from '../../src/indexer/types.js';

describe('GitReader (integration with real git)', () => {
  let repo: TempRepo;
  const hashes: { initial: string; second: string; merge?: string } = {
    initial: '',
    second: '',
  };

  beforeAll(() => {
    repo = createTempRepo();
    hashes.initial = repo.commit({
      message: 'initial commit',
      files: { 'README.md': '# Test\n' },
      date: '2026-01-01T10:00:00Z',
    });
    hashes.second = repo.commit({
      message: 'add feature\n\nWith a body explaining why.',
      files: { 'src/foo.ts': 'export const foo = 1;\n', 'README.md': '# Test\n\nUpdated.\n' },
      date: '2026-01-02T10:00:00Z',
      author: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  afterAll(() => {
    repo?.cleanup();
  });

  it('diagnose() identifies a healthy non-empty repo', async () => {
    const reader = createGitReader({ cwd: repo.path });
    const diag = await reader.diagnose();
    expect(diag.isGitRepo).toBe(true);
    expect(diag.isEmpty).toBe(false);
    expect(diag.isShallow).toBe(false);
    expect(diag.totalCommits).toBe(2);
    expect(diag.currentBranch).toBe('main');
  });

  it('count() returns the number of commits in scope', async () => {
    const reader = createGitReader({ cwd: repo.path });
    expect(await reader.count()).toBe(2);
  });

  it('iterate() yields commits in reverse chronological order with full metadata', async () => {
    const reader = createGitReader({ cwd: repo.path });
    const commits: CommitInfo[] = [];
    for await (const commit of reader.iterate()) {
      commits.push(commit);
    }
    expect(commits).toHaveLength(2);

    const [second, first] = commits;
    expect(first?.hash).toBe(hashes.initial);
    expect(first?.message).toBe('initial commit');
    expect(first?.parentHashes).toEqual([]);
    expect(first?.filesChanged.map((f) => f.path)).toContain('README.md');

    expect(second?.hash).toBe(hashes.second);
    expect(second?.message).toContain('add feature');
    expect(second?.message).toContain('With a body explaining why.');
    expect(second?.author.name).toBe('Alice');
    expect(second?.author.email).toBe('alice@example.com');
    expect(second?.parentHashes).toEqual([hashes.initial]);
    expect(second?.filesChanged.map((f) => f.path).sort()).toEqual(['README.md', 'src/foo.ts']);
    expect(second?.insertions).toBeGreaterThan(0);
  });

  it('honors maxCount to limit results', async () => {
    const reader = createGitReader({ cwd: repo.path, maxCount: 1 });
    const commits: CommitInfo[] = [];
    for await (const commit of reader.iterate()) commits.push(commit);
    expect(commits).toHaveLength(1);
    expect(commits[0]?.hash).toBe(hashes.second);
  });

  it('loadDiff() returns the diff text for a commit', async () => {
    const reader = createGitReader({ cwd: repo.path });
    const diff = await reader.loadDiff(hashes.second);
    expect(diff).toContain('src/foo.ts');
    expect(diff).toContain('+export const foo = 1;');
  });

  it('detects an empty git repo', async () => {
    const emptyRepo = createTempRepo();
    try {
      const reader = createGitReader({ cwd: emptyRepo.path });
      const diag = await reader.diagnose();
      expect(diag.isGitRepo).toBe(true);
      expect(diag.isEmpty).toBe(true);
      expect(diag.totalCommits).toBe(0);
    } finally {
      emptyRepo.cleanup();
    }
  });
});
