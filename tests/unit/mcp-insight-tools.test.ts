import { beforeEach, describe, expect, it } from 'vitest';
import { createInsightAgent } from '../../src/agents/insight/index.js';
import { createKnowledgeAgent } from '../../src/agents/knowledge/index.js';
import { defaultConfig } from '../../src/config/index.js';
import type { McpRuntime, McpRuntimeFactory } from '../../src/mcp/runtime.js';
import { contextForPrTool } from '../../src/mcp/tools/context-for-pr.js';
import { relatedTool } from '../../src/mcp/tools/related.js';
import { riskTool } from '../../src/mcp/tools/risk.js';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';
import { createSqliteBlobVectorStore } from '../../src/providers/vector/sqlite-blob.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { seedCommit } from '../fixtures/seed-commits.js';
import type { Database as DatabaseType } from 'better-sqlite3';

const daysAgo = (days: number): string =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

function makeFactory(db: DatabaseType): McpRuntimeFactory {
  const llm = createMockLlmProvider();
  const vectorStore = createSqliteBlobVectorStore({ db });
  const knowledge = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });
  const insight = createInsightAgent(db);
  const runtime: McpRuntime = {
    cwd: '/tmp/test',
    db,
    llm,
    vectorStore,
    knowledge,
    insight,
    config: defaultConfig,
  };
  return { get: () => runtime, reset: () => undefined };
}

describe('Insight MCP tools', () => {
  let db: DatabaseType;
  let factory: McpRuntimeFactory;
  const ctx = { cwd: '/tmp/test', runtime: undefined as unknown as McpRuntimeFactory };

  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
    seedCommit(db, {
      hash: 'h1',
      author: 'alice',
      date: daysAgo(5),
      files: [{ path: 'src/payment.ts', insertions: 30 }, { path: 'src/payment.test.ts', insertions: 15 }],
    });
    seedCommit(db, {
      hash: 'h2',
      author: 'alice',
      date: daysAgo(3),
      files: [{ path: 'src/payment.ts', insertions: 20 }, { path: 'src/payment.test.ts', insertions: 10 }],
    });
    seedCommit(db, {
      hash: 'h3',
      author: 'bob',
      date: daysAgo(2),
      files: [{ path: 'src/payment.ts', insertions: 5 }],
    });
    factory = makeFactory(db);
    ctx.runtime = factory;
  });

  describe('gitwhy.risk', () => {
    it('returns risk assessment with bus factor and reasons', async () => {
      const result = await riskTool.handler({ path: 'src/payment.ts' }, ctx);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Risk:');
      expect(text).toContain('src/payment.ts');
      expect(text).toContain('bus factor');
      expect(text).toContain('alice');
    });

    it('returns friendly message for unindexed paths', async () => {
      const result = await riskTool.handler({ path: 'nonexistent.ts' }, ctx);
      expect(result.content[0]?.text).toContain('No indexed history');
    });
  });

  describe('gitwhy.related', () => {
    it('returns co-changing files', async () => {
      const result = await relatedTool.handler({ path: 'src/payment.ts' }, ctx);
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('src/payment.test.ts');
      expect(text).toContain('confidence');
    });

    it('returns friendly message for unrelated paths', async () => {
      const result = await relatedTool.handler({ path: 'src/unrelated.ts' }, ctx);
      expect(result.content[0]?.text).toContain('No co-changing files');
    });

    it('honors minCoCommits and limit options', async () => {
      const result = await relatedTool.handler(
        { path: 'src/payment.ts', minCoCommits: 3, limit: 5 },
        ctx,
      );
      const text = result.content[0]?.text ?? '';
      // payment.test.ts has 2 co-commits, below threshold of 3
      expect(text).toContain('No co-changing files');
    });
  });

  describe('gitwhy.context_for_pr', () => {
    it('returns risk summary for an explicit file list', async () => {
      const result = await contextForPrTool.handler(
        { files: ['src/payment.ts'] },
        ctx,
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('PR review context');
      expect(text).toContain('src/payment.ts');
      expect(text).toContain('Risk:');
      expect(text).toContain('Risk summary:');
    });

    it('marks unindexed files separately in the summary', async () => {
      const result = await contextForPrTool.handler(
        { files: ['src/payment.ts', 'never/seen.ts'] },
        ctx,
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('1 unindexed');
    });
  });

  describe('tool descriptions', () => {
    it('all Phase 4 tools live under the gitwhy namespace', () => {
      for (const t of [riskTool, relatedTool, contextForPrTool]) {
        expect(t.name).toMatch(/^gitwhy\.[a-z_]+$/);
      }
    });

    it('all Phase 4 tools have descriptions long enough to drive auto-invocation', () => {
      for (const t of [riskTool, relatedTool, contextForPrTool]) {
        expect(t.description.length).toBeGreaterThan(150);
      }
    });
  });
});
