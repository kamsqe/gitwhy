/**
 * HTTP-server end-to-end tests against a temp git repo + seeded index.
 *
 * Uses Hono's `app.request()` to fire HTTP requests without binding a
 * port — tests stay deterministic and fast.
 */
import { execSync } from 'node:child_process';
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

  describe('POST /api/graph', () => {
    it('returns nodes + edges with shape the UI expects', async () => {
      const res = await app.request('/api/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxNodes: 10, minCoCommits: 1 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        nodes: Array<{ path: string; commits: number; busFactor: number | null }>;
        edges: Array<{ source: string; target: string; weight: number }>;
        truncated: boolean;
        totalCandidates: number;
      };
      expect(Array.isArray(body.nodes)).toBe(true);
      expect(Array.isArray(body.edges)).toBe(true);
      // Fixture has only a handful of files; we shouldn't be truncated.
      expect(body.truncated).toBe(false);
      // Every edge endpoint must reference a node we returned.
      const ids = new Set(body.nodes.map((n) => n.path));
      for (const e of body.edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
        expect(e.weight).toBeGreaterThanOrEqual(1);
      }
    });

    it('rejects maxNodes > 200 with 400', async () => {
      const res = await app.request('/api/graph', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxNodes: 999 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/onboarding', () => {
    it('returns ranked recommendations with reasons', async () => {
      const res = await app.request('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 5 }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        totalCommits: number;
        candidatesConsidered: number;
        recommendations: Array<{ shortHash: string; score: number; reason: string }>;
      };
      // The fixture has 3 small commits — too few to produce candidates
      // that pass the BETWEEN 2 AND 15 file-count filter — but the
      // endpoint should still return cleanly with totals and an empty
      // recommendations array.
      expect(body.totalCommits).toBeGreaterThan(0);
      expect(Array.isArray(body.recommendations)).toBe(true);
      // Score must be monotonically non-increasing.
      const scores = body.recommendations.map((r) => r.score);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] ?? Infinity);
      }
    });

    it('rejects limit > 50 with 400', async () => {
      const res = await app.request('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 100 }),
      });
      expect(res.status).toBe(400);
    });

    it('rejects negative limit with 400', async () => {
      const res = await app.request('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: -1 }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/incident', () => {
    it('surfaces commits in the look-back window and ranks suspects', async () => {
      const res = await app.request('/api/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Use a timestamp after our last fixture commit (2026-01-03) so
          // the look-back window covers all three commits.
          at: '2026-01-04T00:00:00Z',
          windowMinutes: 60 * 24 * 7, // 1 week
          afterMinutes: 0,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        windowStart: string;
        windowEnd: string;
        suspects: Array<{ shortHash: string; suspicionScore: number; category: string }>;
        hotfixes: unknown[];
      };
      expect(body.suspects.length).toBeGreaterThan(0);
      // Sorted by suspicion descending — confirm the order is non-increasing.
      const scores = body.suspects.map((s) => s.suspicionScore);
      for (let i = 1; i < scores.length; i++) {
        expect(scores[i]).toBeLessThanOrEqual(scores[i - 1] ?? Infinity);
      }
    });

    it('rejects unparsable at timestamps', async () => {
      const res = await app.request('/api/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ at: 'not a date' }),
      });
      expect(res.status).toBe(400);
    });

    it('returns empty buckets when the window is in the future', async () => {
      const res = await app.request('/api/incident', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          at: '2099-01-01T00:00:00Z',
          windowMinutes: 60,
        }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        suspects: unknown[];
        hotfixes: unknown[];
      };
      expect(body.suspects).toHaveLength(0);
      expect(body.hotfixes).toHaveLength(0);
    });
  });

  describe('GET /api/diff', () => {
    it('returns the diff for a real commit hash', async () => {
      // Grab the most recent commit from the fixture and request its diff.
      const hash = execSync('git rev-parse HEAD', { cwd: repo.path }).toString().trim();
      const res = await app.request(`/api/diff?hash=${hash}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        hash: string;
        diff: string;
        truncated: boolean;
        maxBytes: number;
      };
      expect(body.hash).toBe(hash);
      expect(body.diff.length).toBeGreaterThan(0);
      // Unified-diff output always starts with "diff --git" for real changes.
      expect(body.diff).toContain('diff --git');
      expect(body.truncated).toBe(false);
    });

    it('returns 400 when hash query parameter is missing', async () => {
      const res = await app.request('/api/diff');
      expect(res.status).toBe(400);
    });

    it('rejects non-hex hashes with 400', async () => {
      const res = await app.request('/api/diff?hash=NOT_HEX');
      expect(res.status).toBe(400);
    });

    it('returns 404 for unknown but well-formed hashes', async () => {
      const res = await app.request(
        '/api/diff?hash=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/not found/i);
    });
  });

  describe('GET /api/diagnostics', () => {
    it('returns a structured diagnostics result with ok=true on a healthy repo', async () => {
      const res = await app.request('/api/diagnostics');
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        ok: boolean;
        checks: Array<{ id: string; label: string; status: string; detail: string }>;
      };
      expect(typeof body.ok).toBe('boolean');
      expect(Array.isArray(body.checks)).toBe(true);
      expect(body.checks.length).toBeGreaterThan(0);
      // Expect the canonical check ids to be present.
      const ids = new Set(body.checks.map((c) => c.id));
      expect(ids.has('provider_keys')).toBe(true);
      expect(ids.has('provider_config')).toBe(true);
      expect(ids.has('git_repo')).toBe(true);
      expect(ids.has('db_integrity')).toBe(true);
    });

    it('git_repo check reports the current branch on a healthy repo', async () => {
      const res = await app.request('/api/diagnostics');
      const body = (await res.json()) as {
        checks: Array<{ id: string; status: string; detail: string }>;
      };
      const git = body.checks.find((c) => c.id === 'git_repo');
      expect(git).toBeDefined();
      expect(git?.status).toBe('ok');
      expect(git?.detail).toMatch(/branch/i);
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

    it('rejects limit=0 with a clear validation error (regression)', async () => {
      // Previously limit=0 was forwarded to SQL as LIMIT 0, silently returning
      // an empty result for files with real history. Must be rejected.
      const res = await app.request('/api/history?path=src/x.ts&limit=0');
      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toContain('between 1 and 200');
    });

    it('rejects negative limit', async () => {
      const res = await app.request('/api/history?path=src/x.ts&limit=-5');
      expect(res.status).toBe(400);
    });

    it('rejects non-numeric limit', async () => {
      const res = await app.request('/api/history?path=src/x.ts&limit=abc');
      expect(res.status).toBe(400);
    });

    it('rejects limit above 200', async () => {
      const res = await app.request('/api/history?path=src/x.ts&limit=500');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/paths', () => {
    it('returns paths matching a query substring', async () => {
      const res = await app.request('/api/paths?q=x.ts');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { paths: string[] };
      expect(body.paths).toContain('src/x.ts');
    });

    it('ranks prefix matches above substring matches', async () => {
      // Both src/x.ts and src/y.ts exist in the fixture; querying "src/"
      // should return both, prefix-first.
      const res = await app.request('/api/paths?q=src');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { paths: string[] };
      // First result should start with "src/" (the prefix match)
      expect(body.paths[0]?.startsWith('src/')).toBe(true);
    });

    it('returns recent paths when query is empty', async () => {
      const res = await app.request('/api/paths?q=');
      expect(res.status).toBe(200);
      const body = (await res.json()) as { paths: string[] };
      expect(body.paths.length).toBeGreaterThan(0);
    });

    it('rejects limit=0', async () => {
      const res = await app.request('/api/paths?q=x&limit=0');
      expect(res.status).toBe(400);
    });

    it('rejects limit above 100', async () => {
      const res = await app.request('/api/paths?q=x&limit=500');
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

    it('rejects unparsable since value with 400 (regression)', async () => {
      // Used to return 200 + apologetic text in body — the UI rendered it as
      // a successful result. Now the route validates the date upfront.
      const res = await app.request('/api/catchup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: 'not a real date' }),
      });
      expect(res.status).toBe(400);
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

    it('rejects questions over 2000 chars (cost guardrail)', async () => {
      const huge = 'a'.repeat(2001);
      const res = await app.request('/api/why', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: huge }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/search', () => {
    it('rejects queries over 500 chars (cost guardrail)', async () => {
      const huge = 'a'.repeat(501);
      const res = await app.request('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: huge }),
      });
      expect(res.status).toBe(400);
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

    it('allows Cloudflare Pages preview subdomains (branch + per-deploy)', async () => {
      const branchAlias = await app.request('/api/health', {
        headers: { Origin: 'https://web-ui.gitwhy.pages.dev' },
      });
      expect(branchAlias.headers.get('access-control-allow-origin')).toBe(
        'https://web-ui.gitwhy.pages.dev',
      );

      const perDeploy = await app.request('/api/health', {
        headers: { Origin: 'https://3485cde4.gitwhy.pages.dev' },
      });
      expect(perDeploy.headers.get('access-control-allow-origin')).toBe(
        'https://3485cde4.gitwhy.pages.dev',
      );
    });

    it('refuses look-alike domains pretending to be pages.dev', async () => {
      const res = await app.request('/api/health', {
        headers: { Origin: 'https://gitwhy.pages.dev.evil.com' },
      });
      expect(res.headers.get('access-control-allow-origin')).toBeNull();
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
