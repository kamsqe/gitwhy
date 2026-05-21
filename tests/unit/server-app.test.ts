/**
 * HTTP-server end-to-end tests against a temp git repo + seeded index.
 *
 * Uses Hono's `app.request()` to fire HTTP requests without binding a
 * port — tests stay deterministic and fast.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runIndexCommand } from '../../src/cli/commands/index-command.js';
import { runInit } from '../../src/cli/commands/init.js';
import { createApp } from '../../src/server/app.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';
import type { Hono } from 'hono';

describe('HTTP server end-to-end', () => {
  let repo: TempRepo;
  let app: Hono;
  let prevMockEnv: string | undefined;

  beforeAll(async () => {
    // Server tests use the mock LLM provider so we don't need real API keys
    // and runtime.get() never throws on missing credentials.
    prevMockEnv = process.env['GITWHY_USE_MOCK_LLM'];
    process.env['GITWHY_USE_MOCK_LLM'] = '1';

    repo = createTempRepo();
    repo.commit({
      message: 'initial commit',
      files: { 'README.md': '# test\n' },
      date: '2026-01-01T10:00:00Z',
    });
    repo.commit({
      message: 'Add real feature with descriptive message',
      files: { 'src/x.ts': 'export const x = 1;\n' },
      date: '2026-01-02T10:00:00Z',
    });
    repo.commit({
      message: 'add another descriptive feature for testing',
      files: { 'src/y.ts': 'export const y = 2;\nconsole.log(y);\n' },
      date: '2026-01-03T10:00:00Z',
    });

    await runInit({ cwd: repo.path });
    await runIndexCommand({ cwd: repo.path, provider: 'mock' });

    app = createApp({ cwd: repo.path });
  });

  afterAll(() => {
    repo?.cleanup();
    if (prevMockEnv !== undefined) {
      process.env['GITWHY_USE_MOCK_LLM'] = prevMockEnv;
    } else {
      delete process.env['GITWHY_USE_MOCK_LLM'];
    }
  });

  describe('GET /api/health', () => {
    it('returns ok and reports initialized=true after init', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { ok: boolean; initialized: boolean; version: string };
      expect(body.ok).toBe(true);
      expect(body.initialized).toBe(true);
      expect(body.version).toBeTruthy();
    });

    it('always responds even without a request body', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
    });
  });

  describe('GET /api/status', () => {
    it('returns coverage + LLM usage stats', async () => {
      const res = await app.request('/api/status');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { initialized: boolean; indexedCommits: number };
      expect(body.initialized).toBe(true);
      expect(body.indexedCommits).toBeGreaterThan(0);
    });
  });

  describe('POST /api/risk', () => {
    it('returns risk assessment with text + data', async () => {
      const res = await app.request('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'src/x.ts' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        text: string;
        data: { risk: { level: string; score: number }; busFactor: { busFactor: number } };
      };
      expect(body.text.length).toBeGreaterThan(0);
      expect(body.data.risk.level).toMatch(/^(low|medium|high)$/);
    });

    it('returns 400 when path is missing', async () => {
      const res = await app.request('/api/risk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/related', () => {
    it('returns co-changing files (text + data)', async () => {
      const res = await app.request('/api/related', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'src/x.ts', minCoCommits: 1 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { text: string; data: unknown[] };
      expect(Array.isArray(body.data)).toBe(true);
    });
  });

  describe('GET /api/history', () => {
    it('returns commit timeline for a file', async () => {
      const res = await app.request('/api/history?path=src/x.ts&limit=5');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { text: string };
      expect(body.text).toContain('src/x.ts');
    });

    it('returns 400 when path query is missing', async () => {
      const res = await app.request('/api/history');
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/catchup', () => {
    it('returns narrated activity for a time window', async () => {
      const res = await app.request('/api/catchup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: '2025-01-01' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { text: string };
      expect(body.text.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/why', () => {
    it('returns answer + confidence + citations structure', async () => {
      const res = await app.request('/api/why', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: 'what does the project do' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        answer: string;
        confidence: number;
        citations: unknown[];
        idk: boolean;
      };
      expect(body.answer.length).toBeGreaterThan(0);
      expect(Array.isArray(body.citations)).toBe(true);
    });
  });

  describe('POST /api/estimate', () => {
    it('returns cost projection without LLM calls', async () => {
      const res = await app.request('/api/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totalCommits: number; grandTotal: { usd: number } };
      expect(body.totalCommits).toBeGreaterThan(0);
    });
  });

  describe('POST /api/feedback + GET summary/list', () => {
    it('round-trips feedback', async () => {
      const submit = await app.request('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: 'up',
          question: 'why does this exist',
          confidence: 0.8,
        }),
      });
      expect(submit.status).toBe(200);
      const submitBody = (await submit.json()) as { id: number };
      expect(submitBody.id).toBeGreaterThan(0);

      const summary = await app.request('/api/feedback/summary');
      expect(summary.status).toBe(200);
      const summaryBody = (await summary.json()) as { upCount: number; total: number };
      expect(summaryBody.upCount).toBeGreaterThan(0);
      expect(summaryBody.total).toBeGreaterThan(0);

      const list = await app.request('/api/feedback/list?limit=5');
      expect(list.status).toBe(200);
      const listBody = (await list.json()) as Array<{ rating: string }>;
      expect(listBody.length).toBeGreaterThan(0);
    });
  });

  describe('POST /api/context-for-pr', () => {
    it('returns per-file risk + summary for explicit file list', async () => {
      const res = await app.request('/api/context-for-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files: ['src/x.ts'] }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { text: string };
      expect(body.text).toContain('src/x.ts');
    });

    it('returns 400 when neither branch nor files provided', async () => {
      const res = await app.request('/api/context-for-pr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('CORS', () => {
    it('allows requests from gitwhy.pages.dev', async () => {
      const res = await app.request('/api/health', {
        headers: { Origin: 'https://gitwhy.pages.dev' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://gitwhy.pages.dev');
    });

    it('allows any localhost origin (dev mode)', async () => {
      const res = await app.request('/api/health', {
        headers: { Origin: 'http://localhost:4321' },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:4321');
    });

    it('refuses unknown origins', async () => {
      const res = await app.request('/api/health', {
        headers: { Origin: 'https://evil.example.com' },
      });
      // request still succeeds (CORS is browser-side) but no allow-origin header
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('404 / error shape', () => {
    it('returns JSON 404 for unknown endpoints', async () => {
      const res = await app.request('/api/does-not-exist');
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBeTruthy();
    });
  });

  describe('precondition for endpoints that require init', () => {
    it('uninitialized repo gets 412 on /api/status', async () => {
      const freshRepo = createTempRepo();
      try {
        freshRepo.commit({
          message: 'just a commit',
          files: { 'a.txt': 'a\n' },
          date: '2026-01-01T10:00:00Z',
        });
        const freshApp = createApp({ cwd: freshRepo.path });
        const res = await freshApp.request('/api/status');
        expect(res.status).toBe(412);
        const body = (await res.json()) as { error: string };
        expect(body.error).toContain('not initialized');
      } finally {
        freshRepo.cleanup();
      }
    });

    it('uninitialized repo still has /api/health available', async () => {
      const freshRepo = createTempRepo();
      try {
        freshRepo.commit({
          message: 'a',
          files: { 'a.txt': 'a' },
          date: '2026-01-01T10:00:00Z',
        });
        const freshApp = createApp({ cwd: freshRepo.path });
        const res = await freshApp.request('/api/health');
        expect(res.status).toBe(200);
        const body = (await res.json()) as { initialized: boolean };
        expect(body.initialized).toBe(false);
      } finally {
        freshRepo.cleanup();
      }
    });
  });
});
