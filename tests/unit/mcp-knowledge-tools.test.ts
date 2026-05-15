import { beforeEach, describe, expect, it } from 'vitest';
import { createInsightAgent } from '../../src/agents/insight/index.js';
import { createKnowledgeAgent } from '../../src/agents/knowledge/index.js';
import { defaultConfig } from '../../src/config/index.js';
import type { McpRuntime, McpRuntimeFactory } from '../../src/mcp/runtime.js';
import { catchupTool, parseSince } from '../../src/mcp/tools/catchup.js';
import { historyTool } from '../../src/mcp/tools/history.js';
import { searchTool } from '../../src/mcp/tools/search.js';
import { whyTool } from '../../src/mcp/tools/why.js';
import { createNullTracer } from '../../src/observability/tracer.js';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';
import { createSqliteBlobVectorStore } from '../../src/providers/vector/sqlite-blob.js';
import { upsertCommit } from '../../src/storage/commits-repo.js';
import { upsertCommitEmbedding } from '../../src/storage/embeddings-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitInfo } from '../../src/indexer/types.js';

function makeCommit(
  hash: string,
  message: string,
  paths: string[],
  date = new Date('2026-01-01T00:00:00Z'),
): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: { name: 'Alice', email: 'alice@example.com' },
    date,
    message,
    parentHashes: ['p'],
    filesChanged: paths.map((p) => ({
      path: p,
      status: 'modified' as const,
      insertions: 5,
      deletions: 1,
      isBinary: false,
    })),
    insertions: 5 * paths.length,
    deletions: paths.length,
  };
}

function makeRuntime(db: DatabaseType): McpRuntime {
  const llm = createMockLlmProvider({
    embedder: (input) =>
      input.toLowerCase().includes('timeout')
        ? [0.95, 0.05, 0, 0]
        : input.toLowerCase().includes('auth')
          ? [0, 0.95, 0.05, 0]
          : [0, 0, 0, 1],
    responder: () => 'Synthesized answer with citation [aaabbbb].',
  });
  const vectorStore = createSqliteBlobVectorStore({ db });
  const knowledge = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });
  const insight = createInsightAgent(db);
  return {
    cwd: '/tmp/test',
    db,
    llm,
    vectorStore,
    knowledge,
    insight,
    config: defaultConfig,
    tracer: createNullTracer(),
  };
}

function makeFactory(runtime: McpRuntime): McpRuntimeFactory {
  return { get: () => runtime, reset: () => undefined };
}

describe('Knowledge-agent MCP tools', () => {
  let db: DatabaseType;
  let runtime: McpRuntime;
  let factory: McpRuntimeFactory;
  const ctxBase = { cwd: '/tmp/test' } as const;

  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
    upsertCommit(db, {
      commit: makeCommit('aaabbbb', 'add timeout', ['src/payment.ts'], new Date('2026-01-15')),
      category: 'normal',
      categoryReason: '17 lines',
      enrichedSummary: 'Added 30s timeout to processPayment due to Stripe webhook delays.',
      enrichmentModel: 'mock',
    });
    upsertCommitEmbedding(db, {
      commitHash: 'aaabbbb',
      embedding: [1, 0, 0, 0],
      model: 'mock-embed',
    });
    upsertCommit(db, {
      commit: makeCommit('cccdddd', 'rewrite auth', ['src/auth.ts'], new Date('2026-02-01')),
      category: 'normal',
      categoryReason: '40 lines',
      enrichedSummary: 'Rewrote auth middleware to use JWT instead of sessions.',
      enrichmentModel: 'mock',
    });
    upsertCommitEmbedding(db, {
      commitHash: 'cccdddd',
      embedding: [0, 1, 0, 0],
      model: 'mock-embed',
    });
    runtime = makeRuntime(db);
    factory = makeFactory(runtime);
  });

  describe('gitwhy.why', () => {
    it('returns an answer with citations for a matching question', async () => {
      const result = await whyTool.handler(
        { question: 'why does processPayment have a timeout?' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Synthesized answer');
      expect(text).toContain('Citations:');
      expect(text).toContain('aaabbbb');
      expect(text).toContain('Confidence:');
    });

    it('flags low-confidence answers as idk', async () => {
      const result = await whyTool.handler(
        { question: 'tell me about elephants' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain("I don't have enough information");
    });
  });

  describe('gitwhy.history', () => {
    it('returns commits that touched a specific file', async () => {
      const result = await historyTool.handler(
        { path: 'src/payment.ts' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('aaabbbb');
      expect(text).toContain('Added 30s timeout');
    });

    it('returns commits under a directory path', async () => {
      const result = await historyTool.handler(
        { path: 'src/' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('aaabbbb');
      expect(text).toContain('cccdddd');
    });

    it('returns a friendly message when no commits match the path', async () => {
      const result = await historyTool.handler(
        { path: 'nonexistent/path' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('No indexed commits found');
    });
  });

  describe('gitwhy.search', () => {
    it('returns ranked commits matching a semantic query', async () => {
      const result = await searchTool.handler(
        { query: 'something about a timeout' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('aaabbbb');
      expect(text).toContain('Added 30s timeout');
    });

    it('honors the topK limit', async () => {
      const result = await searchTool.handler(
        { query: 'anything', topK: 1 },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      const hashMatches = text.match(/\[\w{7}\]/g) ?? [];
      expect(hashMatches.length).toBe(1);
    });
  });

  describe('gitwhy.catchup', () => {
    it('returns commits since an ISO date', async () => {
      const result = await catchupTool.handler(
        { since: '2026-01-01' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('Catchup since');
      expect(text).toContain('aaabbbb');
    });

    it('reports no commits when range is in the future', async () => {
      const result = await catchupTool.handler(
        { since: '2030-01-01' },
        { ...ctxBase, runtime: factory },
      );
      const text = result.content[0]?.text ?? '';
      expect(text).toContain('No commits indexed since');
    });

    it('rejects unparseable since values', async () => {
      const result = await catchupTool.handler(
        { since: 'gibberish' },
        { ...ctxBase, runtime: factory },
      );
      expect(result.isError).toBe(true);
    });
  });

  describe('parseSince', () => {
    it('accepts ISO dates', () => {
      const t = parseSince('2026-01-15');
      expect(t).toBe(Date.parse('2026-01-15'));
    });

    it('accepts relative periods', () => {
      const now = Date.now();
      const t = parseSince('1 week ago');
      expect(t).not.toBeNull();
      expect(now - t!).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
      expect(now - t!).toBeLessThan(8 * 24 * 60 * 60 * 1000);
    });

    it('returns null for gibberish', () => {
      expect(parseSince('not a date')).toBeNull();
      expect(parseSince('')).toBeNull();
    });
  });

  describe('tool descriptions', () => {
    it('all tools include "gitwhy" namespace in their name', () => {
      for (const t of [whyTool, historyTool, searchTool, catchupTool]) {
        expect(t.name).toMatch(/^gitwhy\.[a-z_]+$/);
      }
    });

    it('all tools have descriptions long enough to drive auto-invocation', () => {
      for (const t of [whyTool, historyTool, searchTool, catchupTool]) {
        expect(t.description.length).toBeGreaterThan(100);
      }
    });
  });
});
