import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createInsightAgent } from '../../src/agents/insight/index.js';
import { createKnowledgeAgent } from '../../src/agents/knowledge/index.js';
import { defaultConfig } from '../../src/config/index.js';
import type { McpRuntime, McpRuntimeFactory } from '../../src/mcp/runtime.js';
import { suggestCommitMessageTool } from '../../src/mcp/tools/suggest-commit-message.js';
import { createNullTracer } from '../../src/observability/tracer.js';
import { createMockLlmProvider } from '../../src/providers/llm/mock.js';
import { createSqliteBlobVectorStore } from '../../src/providers/vector/sqlite-blob.js';
import { openDatabase } from '../../src/storage/sqlite.js';
import { createTempRepo } from '../fixtures/temp-repo.js';
import type { TempRepo } from '../fixtures/temp-repo.js';
import type { Database as DatabaseType } from 'better-sqlite3';

function makeFactory(db: DatabaseType, cwd: string, llm = createMockLlmProvider({
  responder: () => 'fix(payment): add null guard before pricing lookup',
})): McpRuntimeFactory {
  const vectorStore = createSqliteBlobVectorStore({ db });
  const knowledge = createKnowledgeAgent({ db, llm, vectorStore, config: defaultConfig });
  const insight = createInsightAgent(db);
  const runtime: McpRuntime = {
    cwd,
    db,
    llm,
    vectorStore,
    knowledge,
    insight,
    config: defaultConfig,
    tracer: createNullTracer(),
  };
  return { get: () => runtime, reset: () => undefined };
}

describe('gitwhy.suggest_commit_message', () => {
  let repo: TempRepo;
  let db: DatabaseType;

  beforeEach(() => {
    repo = createTempRepo();
    repo.commit({
      message: 'initial',
      files: { 'README.md': '# repo\n' },
      date: '2026-01-01T10:00:00Z',
    });
    db = openDatabase({ path: ':memory:', memory: true });
  });

  afterEach(() => {
    repo.cleanup();
  });

  it('returns a generated message when staged changes are present', async () => {
    writeFileSync(join(repo.path, 'src.ts'), 'export const x = 1;\n');
    execSync('mkdir -p src', { cwd: repo.path });
    execSync('git add -A', { cwd: repo.path });

    const factory = makeFactory(db, repo.path);
    const result = await suggestCommitMessageTool.handler(
      { style: 'conventional' },
      { cwd: repo.path, runtime: factory },
    );
    expect(result.content[0]?.text).toContain('fix(payment)');
  });

  it('reports a friendly message when there are no staged changes', async () => {
    const factory = makeFactory(db, repo.path);
    const result = await suggestCommitMessageTool.handler(
      {},
      { cwd: repo.path, runtime: factory },
    );
    expect(result.content[0]?.text).toContain('No staged changes');
    expect(result.isError).toBeUndefined();
  });

  it('redacts secrets in the staged diff before calling the LLM', async () => {
    writeFileSync(join(repo.path, 'config.txt'), 'OPENAI=sk-abcdefghijklmnopqrstuvwxyz0123\n');
    execSync('git add -A', { cwd: repo.path });

    const llm = createMockLlmProvider({
      responder: () => 'chore(config): add OPENAI key placeholder',
    });
    const factory = makeFactory(db, repo.path, llm);

    const result = await suggestCommitMessageTool.handler(
      {},
      { cwd: repo.path, runtime: factory },
    );
    expect(result.content[0]?.text).toContain('secret');
    const userPrompt = llm.calls.complete[0]?.messages[1]?.content ?? '';
    expect(userPrompt).toContain('[REDACTED:');
    expect(userPrompt).not.toContain('sk-abcdefghijklmnopqrstuvwxyz0123');
  });

  it('mentions truncation when the diff is too large', async () => {
    const huge = 'x'.repeat(15000);
    writeFileSync(join(repo.path, 'huge.txt'), huge);
    execSync('git add -A', { cwd: repo.path });

    const factory = makeFactory(db, repo.path);
    const result = await suggestCommitMessageTool.handler(
      { maxDiffChars: 500 },
      { cwd: repo.path, runtime: factory },
    );
    expect(result.content[0]?.text).toContain('truncated');
  });

  it('has a sufficiently detailed description for agent auto-invocation', () => {
    expect(suggestCommitMessageTool.name).toBe('gitwhy.suggest_commit_message');
    expect(suggestCommitMessageTool.description.length).toBeGreaterThan(150);
    expect(suggestCommitMessageTool.description.toLowerCase()).toContain('commit message');
  });
});
