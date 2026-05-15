import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../../src/config/index.js';
import { createGitReader } from '../../src/indexer/git-reader.js';
import { indexRepo } from '../../src/indexer/indexer.js';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';
import { countCommits, getCommit, getUsageSummary } from '../../src/storage/commits-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';

describe('indexer', () => {
  let repo: TempRepo;
  const hashes: { initial: string; vague: string; descriptive: string } = {
    initial: '',
    vague: '',
    descriptive: '',
  };

  beforeAll(() => {
    repo = createTempRepo();
    hashes.initial = repo.commit({
      message: 'initial commit',
      files: { 'README.md': '# Test\n' },
      date: '2026-01-01T10:00:00Z',
    });
    hashes.vague = repo.commit({
      message: 'fix',
      files: { 'src/foo.ts': 'export const foo = 1;\n' },
      date: '2026-01-02T10:00:00Z',
    });
    hashes.descriptive = repo.commit({
      message: 'Add null guard before pricing lookup to prevent crash',
      files: { 'src/foo.ts': 'export const foo = 2;\nif (foo) { /* guard */ }\n' },
      date: '2026-01-03T10:00:00Z',
    });
  });

  afterAll(() => {
    repo?.cleanup();
  });

  it('indexes all commits and stores them with categories', async () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    const reader = createGitReader({ cwd: repo.path });
    const llm = createMockLlmProvider({
      responder: () => 'AI-inferred change description.',
    });

    const result = await indexRepo({
      reader,
      db,
      llm,
      config: defaultConfig,
    });

    expect(result.progress.processed).toBe(3);
    expect(countCommits(db)).toBe(3);

    const initial = getCommit(db, hashes.initial);
    const vague = getCommit(db, hashes.vague);
    const descriptive = getCommit(db, hashes.descriptive);

    expect(initial?.category).toBe('initial');
    expect(initial?.enrichedSummary).toBeNull();

    expect(vague?.category).toBe('micro');
    expect(descriptive?.category).toBe('normal');
    expect(descriptive?.enrichedSummary).toBe('AI-inferred change description.');
  });

  it('records LLM accounting in llm_calls', async () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    const reader = createGitReader({ cwd: repo.path });
    const llm = createMockLlmProvider();
    await indexRepo({ reader, db, llm, config: defaultConfig });

    const usage = getUsageSummary(db);
    expect(usage.calls).toBeGreaterThan(0);
    expect(usage.promptTokens).toBeGreaterThan(0);
  });

  it('skips already-indexed commits on re-run (resume support)', async () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    const reader = createGitReader({ cwd: repo.path });
    const llm = createMockLlmProvider();

    const first = await indexRepo({ reader, db, llm, config: defaultConfig });
    const firstEnriched = first.progress.enriched;

    const second = await indexRepo({ reader, db, llm, config: defaultConfig });
    expect(second.progress.skipped).toBe(3);
    expect(second.progress.enriched).toBe(0);

    expect(firstEnriched).toBeGreaterThan(0);
  });

  it('honors budget cap and stops early', async () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    const reader = createGitReader({ cwd: repo.path });
    const llm = createMockLlmProvider({
      responder: () => 'x'.repeat(1000),
    });

    const result = await indexRepo({
      reader,
      db,
      llm,
      config: {
        ...defaultConfig,
        budget: { maxUsd: 0.0000001 },
      },
    });

    expect(['budget', 'complete']).toContain(result.stoppedReason);
    if (result.stoppedReason === 'budget') {
      expect(result.progress.processed).toBeLessThan(result.progress.total);
    }
  });

  it('emits progress events through onProgress callback', async () => {
    const db = openDatabase({ path: ':memory:', memory: true });
    const reader = createGitReader({ cwd: repo.path });
    const llm = createMockLlmProvider();
    const seen: number[] = [];

    await indexRepo({
      reader,
      db,
      llm,
      config: defaultConfig,
      onProgress: (p) => seen.push(p.processed),
    });

    expect(seen.length).toBeGreaterThan(0);
    expect(seen[seen.length - 1]).toBe(3);
  });
});
