import { beforeEach, describe, expect, it } from 'vitest';
import { createKnowledgeAgent } from '../../src/agents/knowledge/index.js';
import { defaultConfig } from '../../src/config/index.js';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';
import { createSqliteBlobVectorStore } from '../../src/providers/vector/sqlite-blob.js';
import { upsertCommit } from '../../src/storage/commits-repo.js';
import { upsertCommitEmbedding } from '../../src/storage/embeddings-repo.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitInfo } from '../../src/indexer/types.js';

function makeCommit(hash: string, message: string, summary: string): CommitInfo {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    author: { name: 'Alice', email: 'alice@example.com' },
    date: new Date('2026-01-01T00:00:00Z'),
    message,
    parentHashes: ['p'],
    filesChanged: [],
    insertions: 5,
    deletions: 1,
  };
  void summary; // summary applied via upsertCommit below
}

function seedCommit(
  db: DatabaseType,
  hash: string,
  message: string,
  summary: string,
  embedding: number[],
): void {
  const commit = makeCommit(hash, message, summary);
  upsertCommit(db, {
    commit,
    category: 'normal',
    categoryReason: 'r',
    enrichedSummary: summary,
    enrichmentModel: 'mock',
  });
  upsertCommitEmbedding(db, {
    commitHash: hash,
    embedding,
    model: 'mock-embed',
  });
}

describe('Knowledge agent', () => {
  let db: DatabaseType;
  beforeEach(() => {
    db = openDatabase({ path: ':memory:', memory: true });
  });

  it('returns idk when there are no indexed commits', async () => {
    const llm = createMockLlmProvider();
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });

    const result = await agent.ask('why does the payment timeout exist?');
    expect(result.idk).toBe(true);
    expect(result.retrieved).toBe(0);
    expect(result.modelUsed).toBeNull();
  });

  it('returns idk when top-1 similarity is below the threshold (without calling LLM completion)', async () => {
    seedCommit(db, 'aaa', 'fix', 'Added null guard before pricing lookup', [1, 0, 0, 0]);

    const llm = createMockLlmProvider({
      embedder: () => [0, 1, 0, 0],
    });
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({
      db,
      llm,
      vectorStore,
      config: defaultConfig,
    });

    const result = await agent.ask('why does the payment timeout exist?', {
      minConfidence: 0.5,
    });
    expect(result.idk).toBe(true);
    expect(result.modelUsed).toBeNull();
    expect(llm.calls.complete).toHaveLength(0);
    expect(result.citations).toHaveLength(1);
    expect(result.confidence).toBeCloseTo(0, 5);
  });

  it('returns a synthesized answer when retrieval clears the threshold', async () => {
    seedCommit(
      db,
      'aaabbbb',
      'add timeout',
      'Added 30s timeout to processPayment due to Stripe webhook delays.',
      [1, 0, 0, 0],
    );
    seedCommit(
      db,
      'cccdddd',
      'docs',
      'Updated README with new install steps.',
      [0, 1, 0, 0],
    );

    const llm = createMockLlmProvider({
      embedder: (input) => {
        return input.includes('timeout') ? [0.9, 0.1, 0, 0] : [0, 1, 0, 0];
      },
      responder: () => 'The 30s timeout was added because of Stripe webhook delays (see [aaabbbb]).',
    });
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });

    const result = await agent.ask('why does processPayment have a timeout?');
    expect(result.idk).toBe(false);
    expect(result.answer).toContain('Stripe');
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.citations[0]?.shortHash).toBe('aaabbbb');
    expect(result.retrieved).toBe(2);
  });

  it('caches identical questions and reports cached=true on the second call', async () => {
    seedCommit(db, 'aaa', 'add', 'Added a feature.', [1, 0]);

    const llm = createMockLlmProvider({
      embedder: () => [1, 0],
      responder: () => 'It was added (see [aaa]).',
    });
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });

    const first = await agent.ask('why was the feature added?');
    const second = await agent.ask('why was the feature added?');
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.answer).toBe(first.answer);
    expect(llm.calls.complete.length).toBe(1);
  });

  it('bypasses cache when noCache=true', async () => {
    seedCommit(db, 'aaa', 'add', 'feature', [1, 0]);
    const llm = createMockLlmProvider({
      embedder: () => [1, 0],
      responder: () => 'answer (see [aaa]).',
    });
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });
    await agent.ask('q?');
    await agent.ask('q?', { noCache: true });
    expect(llm.calls.complete).toHaveLength(2);
  });

  it('lowers confidence when the LLM answer hedges with "not enough information"', async () => {
    seedCommit(db, 'aaa', 'add', 'feature', [1, 0]);
    const llm = createMockLlmProvider({
      embedder: () => [1, 0],
      responder: () =>
        "I don't have enough information to answer this from the indexed history.",
    });
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });
    const result = await agent.ask('q?');
    expect(result.idk).toBe(true);
    expect(result.confidence).toBeLessThan(0.4);
  });

  it('reset() clears the cache', async () => {
    seedCommit(db, 'aaa', 'add', 'feature', [1, 0]);
    const llm = createMockLlmProvider({ embedder: () => [1, 0], responder: () => 'a' });
    const vectorStore = createSqliteBlobVectorStore({ db });
    const agent = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });
    await agent.ask('q?');
    agent.reset();
    const second = await agent.ask('q?');
    expect(second.cached).toBe(false);
  });
});
