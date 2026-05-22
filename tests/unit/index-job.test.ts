/**
 * Tests the singleton indexing-job manager + its HTTP surface. These are
 * end-to-end against a real temp git repo so the indexer actually runs;
 * the mock LLM provider keeps everything offline.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runInit } from '../../src/cli/commands/init.js';
import { createApp } from '../../src/server/app.js';
import { _resetForTests, getCurrentJob, startJob, subscribe } from '../../src/server/index-job.js';
import type { JobEvent } from '../../src/server/index-job.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';
import type { Hono } from 'hono';

describe('indexing job manager', () => {
  let repo: TempRepo;
  let app: Hono;
  let prevMockEnv: string | undefined;

  beforeAll(async () => {
    prevMockEnv = process.env['GITWHY_USE_MOCK_LLM'];
    process.env['GITWHY_USE_MOCK_LLM'] = '1';

    repo = createTempRepo();
    repo.commit({
      message: 'initial commit',
      files: { 'README.md': '# test\n' },
      date: '2026-01-01T10:00:00Z',
    });
    repo.commit({
      message: 'add feature one',
      files: { 'src/one.ts': 'export const one = 1;\n' },
      date: '2026-01-02T10:00:00Z',
    });
    repo.commit({
      message: 'add feature two',
      files: { 'src/two.ts': 'export const two = 2;\n' },
      date: '2026-01-03T10:00:00Z',
    });

    await runInit({ cwd: repo.path });
    app = createApp({ cwd: repo.path });
  });

  afterEach(() => {
    _resetForTests();
  });

  // Helper: wait for an event matching the predicate (or until the job ends).
  // Uses the synchronous subscribe() API so we don't depend on Hono's stream.
  function waitForEvent(predicate: (e: JobEvent) => boolean, timeoutMs = 8000): Promise<JobEvent> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        sub?.unsubscribe();
        reject(new Error('timed out waiting for event'));
      }, timeoutMs);
      const sub = subscribe((event) => {
        if (predicate(event)) {
          clearTimeout(t);
          sub?.unsubscribe();
          resolve(event);
        }
      });
      // Replay history in case the event already happened.
      if (sub) {
        for (const event of sub.history) {
          if (predicate(event)) {
            clearTimeout(t);
            sub.unsubscribe();
            resolve(event);
            return;
          }
        }
      }
    });
  }

  it('starts a job and emits a started event', async () => {
    const result = startJob({ cwd: repo.path, provider: 'mock' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.job.state).toBe('running');
    expect(result.job.id).toBeTruthy();

    // Wait for completion before the next test resets state.
    const done = await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
    expect(done.type).toBe('done');
  });

  it('refuses to start a second concurrent job', async () => {
    const first = startJob({ cwd: repo.path, provider: 'mock' });
    expect(first.ok).toBe(true);

    const second = startJob({ cwd: repo.path, provider: 'mock' });
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('already_running');

    // Drain the first so afterEach doesn't see a still-running job.
    await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
  });

  it('emits progress events through subscribers', async () => {
    startJob({ cwd: repo.path, provider: 'mock' });
    const progressEvent = await waitForEvent((e) => e.type === 'progress');
    expect(progressEvent.type).toBe('progress');
    if (progressEvent.type === 'progress') {
      expect(progressEvent.progress.processed).toBeGreaterThan(0);
    }
    await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
  });

  // The next two tests need a clean repo (no prior .gitwhy/) since they
  // assert on first-run processed counts. The shared `repo` from beforeAll
  // accumulates state across earlier tests in this file.
  it('second run is incremental — `since` defaults to last indexed timestamp', async () => {
    const fresh = createTempRepo();
    try {
      fresh.commit({ message: 'one', files: { 'a.ts': 'x\n' }, date: '2026-01-01T10:00:00Z' });
      fresh.commit({ message: 'two', files: { 'b.ts': 'y\n' }, date: '2026-01-02T10:00:00Z' });
      fresh.commit({ message: 'three', files: { 'c.ts': 'z\n' }, date: '2026-01-03T10:00:00Z' });
      await runInit({ cwd: fresh.path });

      // First run: full index, all 3 commits.
      startJob({ cwd: fresh.path, provider: 'mock' });
      const firstDone = await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
      expect(firstDone.type).toBe('done');
      if (firstDone.type === 'done') {
        expect(firstDone.result.progress.processed).toBe(3);
      }
      _resetForTests();

      // Second run: --since defaults to `last_indexed - 24h`. Latest commit
      // is Jan 3, so the buffer covers Jan 2 onwards — Jan 1 falls out of
      // git's --since window. We expect 2 commits iterated (Jan 2, Jan 3),
      // both already-indexed → both skipped, none re-enriched.
      startJob({ cwd: fresh.path, provider: 'mock' });
      const secondDone = await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
      expect(secondDone.type).toBe('done');
      if (secondDone.type === 'done') {
        expect(secondDone.result.progress.processed).toBe(2);
        expect(secondDone.result.progress.skipped).toBe(2);
        expect(secondDone.result.progress.enriched).toBe(0);
      }
    } finally {
      fresh.cleanup();
    }
  });

  it('excludes lockfiles from path autocomplete by default (.gitwhyignore)', async () => {
    const fresh = createTempRepo();
    try {
      // A commit that touches a real source file alongside a lockfile.
      fresh.commit({
        message: 'add feature + bump deps',
        files: {
          'src/feature.ts': 'export const x = 1;\n',
          'pnpm-lock.yaml': 'lockfileVersion: 9\n',
        },
        date: '2026-01-01T10:00:00Z',
      });
      await runInit({ cwd: fresh.path });

      // Index it once so commit_files rows are written with excluded set.
      startJob({ cwd: fresh.path, provider: 'mock' });
      await waitForEvent((e) => e.type === 'done' || e.type === 'failed');

      const localApp = createApp({ cwd: fresh.path });

      // Path autocomplete should return src/feature.ts but NOT pnpm-lock.yaml.
      const res = await localApp.request('/api/paths?q=');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { paths: string[] };
      expect(body.paths).toContain('src/feature.ts');
      expect(body.paths).not.toContain('pnpm-lock.yaml');

      // ...but explicit-path queries still return the row when asked.
      const riskRes = await localApp.request('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'pnpm-lock.yaml' }),
      });
      expect(riskRes.status).toBe(200);
      // Risk's bus factor query is path-anchored, not aggregation, so the row
      // is still reachable — the user explicitly asked for it.
    } finally {
      fresh.cleanup();
    }
  });

  it('full=true bypasses incremental and re-walks everything', async () => {
    const fresh = createTempRepo();
    try {
      fresh.commit({ message: 'one', files: { 'a.ts': 'x\n' }, date: '2026-01-01T10:00:00Z' });
      fresh.commit({ message: 'two', files: { 'b.ts': 'y\n' }, date: '2026-01-02T10:00:00Z' });
      fresh.commit({ message: 'three', files: { 'c.ts': 'z\n' }, date: '2026-01-03T10:00:00Z' });
      await runInit({ cwd: fresh.path });

      startJob({ cwd: fresh.path, provider: 'mock' });
      await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
      _resetForTests();

      // With full=true, --since is NOT defaulted. We re-walk all 3 commits;
      // dedup-by-hash still skips them.
      startJob({ cwd: fresh.path, provider: 'mock', full: true });
      const done = await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
      expect(done.type).toBe('done');
      if (done.type === 'done') {
        expect(done.result.progress.processed).toBe(3);
        expect(done.result.progress.skipped).toBe(3);
      }
    } finally {
      fresh.cleanup();
    }
  });

  it('replays history to late subscribers', async () => {
    startJob({ cwd: repo.path, provider: 'mock' });
    await waitForEvent((e) => e.type === 'done' || e.type === 'failed');

    // Subscribe AFTER the job is done — history replay should still give us
    // the started + done events.
    const sub = subscribe(() => undefined);
    expect(sub).not.toBeNull();
    if (!sub) return;
    expect(sub.history.some((e) => e.type === 'started')).toBe(true);
    expect(sub.history.some((e) => e.type === 'done')).toBe(true);
    sub.unsubscribe();
  });

  describe('HTTP surface', () => {
    it('POST /api/index/start kicks off a job', async () => {
      const res = await app.request('/api/index/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'mock' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { job: { id: string; state: string } };
      expect(body.job.state).toBe('running');
      expect(body.job.id).toBeTruthy();

      await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
    });

    it('POST /api/index/start returns 409 when a job is running', async () => {
      startJob({ cwd: repo.path, provider: 'mock' });

      const res = await app.request('/api/index/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'mock' }),
      });
      expect(res.status).toBe(409);

      await waitForEvent((e) => e.type === 'done' || e.type === 'failed');
    });

    it('POST /api/index/cancel returns 404 when no job is running', async () => {
      const res = await app.request('/api/index/cancel', { method: 'POST' });
      expect(res.status).toBe(404);
    });

    it('GET /api/index/status returns null when no job exists', async () => {
      const res = await app.request('/api/index/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { job: unknown };
      expect(body.job).toBeNull();
    });

    it('GET /api/index/status returns the snapshot of the latest job', async () => {
      startJob({ cwd: repo.path, provider: 'mock' });
      await waitForEvent((e) => e.type === 'done' || e.type === 'failed');

      const res = await app.request('/api/index/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { job: { id: string; state: string } | null };
      expect(body.job).not.toBeNull();
      expect(body.job?.state).toBe('done');
    });

    it('POST /api/index/start with invalid budget rejects (regression for input validation)', async () => {
      const res = await app.request('/api/index/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'mock', budgetUsd: -5 }),
      });
      expect(res.status).toBe(400);
    });
  });

  afterAll(() => {
    repo?.cleanup();
    if (prevMockEnv !== undefined) {
      process.env['GITWHY_USE_MOCK_LLM'] = prevMockEnv;
    } else {
      delete process.env['GITWHY_USE_MOCK_LLM'];
    }
  });
});
