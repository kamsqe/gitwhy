import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runEstimate } from '../../src/cli/commands/estimate.js';
import { runIndexCommand } from '../../src/cli/commands/index-command.js';
import { runInit } from '../../src/cli/commands/init.js';
import { resolvePaths } from '../../src/config/loader.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';

describe('scope wiring (config + CLI overrides → GitReader)', () => {
  let repo: TempRepo;
  beforeEach(() => {
    repo = createTempRepo();
    repo.commit({
      message: 'old commit',
      files: { 'a.txt': 'a' },
      date: '2024-01-01T10:00:00Z',
    });
    repo.commit({
      message: 'mid commit',
      files: { 'b.txt': 'b' },
      date: '2025-06-01T10:00:00Z',
    });
    repo.commit({
      message: 'new commit',
      files: { 'c.txt': 'c' },
      date: '2026-04-01T10:00:00Z',
    });
  });
  afterEach(() => repo.cleanup());

  it('runEstimate respects --since (CLI override)', async () => {
    await runInit({ cwd: repo.path });
    const result = await runEstimate({ cwd: repo.path, since: '2025-01-01' });
    expect(result.totalCommits).toBe(2);
  });

  it('runEstimate respects --until', async () => {
    await runInit({ cwd: repo.path });
    const result = await runEstimate({ cwd: repo.path, until: '2025-01-01' });
    expect(result.totalCommits).toBe(1);
  });

  it('runEstimate respects --max-count (caps at newest N)', async () => {
    await runInit({ cwd: repo.path });
    const result = await runEstimate({ cwd: repo.path, maxCount: 2 });
    expect(result.totalCommits).toBe(2);
  });

  it('runIndexCommand respects --since', async () => {
    await runInit({ cwd: repo.path });
    const result = await runIndexCommand({
      cwd: repo.path,
      provider: 'mock',
      since: '2025-01-01',
    });
    expect(result.progress.total).toBe(2);
    expect(result.progress.processed).toBe(2);
  });

  it('config.scope.since takes effect when no CLI override is given', async () => {
    await runInit({ cwd: repo.path });
    const paths = resolvePaths(repo.path);
    const cfg = {
      version: 1,
      provider: {
        llm: 'mock',
        indexingModel: 'mock',
        queryModel: 'mock',
        embeddingModel: 'mock',
      },
      scope: { since: '2025-01-01' },
      budget: {},
      storage: { indexDir: '.gitwhy', vectorBackend: 'sqlite-vec' },
    };
    writeFileSync(paths.configFile, JSON.stringify(cfg, null, 2));

    const result = await runEstimate({ cwd: repo.path });
    expect(result.totalCommits).toBe(2);
  });

  it('CLI --since wins over config.scope.since', async () => {
    await runInit({ cwd: repo.path });
    const paths = resolvePaths(repo.path);
    const cfg = {
      version: 1,
      provider: {
        llm: 'mock',
        indexingModel: 'mock',
        queryModel: 'mock',
        embeddingModel: 'mock',
      },
      scope: { since: '2025-01-01' }, // would yield 2
      budget: {},
      storage: { indexDir: '.gitwhy', vectorBackend: 'sqlite-vec' },
    };
    writeFileSync(paths.configFile, JSON.stringify(cfg, null, 2));

    const result = await runEstimate({ cwd: repo.path, since: '2026-01-01' });
    expect(result.totalCommits).toBe(1);
  });
});

// Suppress lint warning: join used implicitly via writeFileSync, kept for path computation hygiene.
void join;
