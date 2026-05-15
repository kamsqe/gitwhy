import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runEstimate } from '../../src/cli/commands/estimate.js';
import { runIndexCommand } from '../../src/cli/commands/index-command.js';
import { runInit } from '../../src/cli/commands/init.js';
import { resolvePaths } from '../../src/config/loader.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';

describe('CLI commands', () => {
  let repo: TempRepo;

  beforeAll(() => {
    repo = createTempRepo();
    repo.commit({
      message: 'initial commit',
      files: { 'README.md': '# Test\n' },
      date: '2026-01-01T10:00:00Z',
    });
    repo.commit({
      message: 'fix',
      files: { 'src/foo.ts': 'export const foo = 1;\n' },
      date: '2026-01-02T10:00:00Z',
    });
    repo.commit({
      message: 'Add null guard before pricing lookup',
      files: { 'src/foo.ts': 'export const foo = 2;\nconsole.log(foo);\n' },
      date: '2026-01-03T10:00:00Z',
    });
  });

  afterAll(() => {
    repo?.cleanup();
  });

  describe('init', () => {
    it('creates .gitwhy/ directory with config and empty db', async () => {
      const result = await runInit({ cwd: repo.path });
      expect(result.created).toBe(true);
      const paths = resolvePaths(repo.path);
      expect(existsSync(paths.configFile)).toBe(true);
      expect(existsSync(paths.commitsDb)).toBe(true);

      const config = JSON.parse(readFileSync(paths.configFile, 'utf8')) as { version: number };
      expect(config.version).toBe(1);

      expect(result.diagnostics.totalCommits).toBe(3);
      expect(result.diagnostics.isGitRepo).toBe(true);
    });

    it('refuses to overwrite without --force', async () => {
      const second = await runInit({ cwd: repo.path });
      expect(second.created).toBe(false);
      expect(second.warnings.join(' ')).toContain('already exists');
    });

    it('overwrites with --force', async () => {
      const result = await runInit({ cwd: repo.path, force: true });
      expect(result.created).toBe(true);
    });
  });

  describe('estimate', () => {
    it('produces a cost estimate broken down by category', async () => {
      await runInit({ cwd: repo.path, force: true });
      const result = await runEstimate({ cwd: repo.path });
      expect(result.totalCommits).toBe(3);
      expect(result.byCategory.length).toBeGreaterThan(0);

      const normal = result.byCategory.find((c) => c.category === 'normal');
      expect(normal?.llmCallsPlanned).toBeGreaterThan(0);

      const initial = result.byCategory.find((c) => c.category === 'initial');
      expect(initial?.llmCallsPlanned).toBe(0);
    });
  });

  describe('index (with mock provider)', () => {
    it('indexes the repo end-to-end and produces stored commits', async () => {
      const freshRepo = createTempRepo();
      try {
        freshRepo.commit({
          message: 'initial',
          files: { 'README.md': '# fresh\n' },
          date: '2026-02-01T10:00:00Z',
        });
        freshRepo.commit({
          message: 'add real feature with descriptive message',
          files: { 'src/x.ts': 'export const x = 1;\n' },
          date: '2026-02-02T10:00:00Z',
        });
        await runInit({ cwd: freshRepo.path });
        const result = await runIndexCommand({ cwd: freshRepo.path, provider: 'mock' });

        expect(result.progress.processed).toBe(2);
        expect(result.progress.errors).toBe(0);

        const paths = resolvePaths(freshRepo.path);
        expect(existsSync(paths.commitsDb)).toBe(true);
      } finally {
        freshRepo.cleanup();
      }
    });

    it('throws a useful error when OPENAI_API_KEY is missing and provider=openai', async () => {
      const prevKey = process.env['OPENAI_API_KEY'];
      const prevMock = process.env['GITWHY_USE_MOCK_LLM'];
      delete process.env['OPENAI_API_KEY'];
      delete process.env['GITWHY_USE_MOCK_LLM'];
      try {
        const freshRepo = createTempRepo();
        try {
          freshRepo.commit({
            message: 'a',
            files: { 'a.txt': 'a' },
            date: '2026-02-01T10:00:00Z',
          });
          await runInit({ cwd: freshRepo.path });
          await expect(
            runIndexCommand({ cwd: freshRepo.path, provider: 'openai' }),
          ).rejects.toThrow(/OPENAI_API_KEY/);
        } finally {
          freshRepo.cleanup();
        }
      } finally {
        if (prevKey !== undefined) process.env['OPENAI_API_KEY'] = prevKey;
        if (prevMock !== undefined) process.env['GITWHY_USE_MOCK_LLM'] = prevMock;
      }
    });
  });

  it('resolvePaths returns the expected .gitwhy/ layout', () => {
    const paths = resolvePaths('/tmp/somewhere');
    expect(paths.root).toBe('/tmp/somewhere/.gitwhy');
    expect(paths.configFile).toBe('/tmp/somewhere/.gitwhy/config.json');
    expect(paths.commitsDb).toBe('/tmp/somewhere/.gitwhy/index/commits.sqlite');
  });

  // resolvePaths uses join with paths.root, double-check the join above is correct.
  it('places the commits db inside .gitwhy/index/', () => {
    const paths = resolvePaths('/tmp/somewhere');
    expect(paths.commitsDb).toBe(join('/tmp/somewhere', '.gitwhy', 'index', 'commits.sqlite'));
  });
});
