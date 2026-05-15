import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as DatabaseType } from 'better-sqlite3';
import { createInsightAgent } from '../agents/insight/index.js';
import type { InsightAgent } from '../agents/insight/index.js';
import { createKnowledgeAgent } from '../agents/knowledge/index.js';
import type { KnowledgeAgent } from '../agents/knowledge/index.js';
import type { GitWhyConfig } from '../config/index.js';
import { loadConfig, resolvePaths } from '../config/loader.js';
import { createDefaultTracer } from '../observability/tracer.js';
import type { Tracer } from '../observability/tracer.js';
import { createGeminiProvider } from '../providers/llm/gemini.js';
import { createMockLlmProvider } from '../providers/llm/mock.js';
import { createOpenAiProvider } from '../providers/llm/openai.js';
import type { LlmProvider } from '../providers/llm/types.js';
import { createSqliteBlobVectorStore } from '../providers/vector/sqlite-blob.js';
import type { VectorStore } from '../providers/vector/types.js';
import { loadDotEnv } from '../utils/env.js';
import { openDatabase } from '../storage/sqlite.js';

export interface McpRuntime {
  readonly cwd: string;
  readonly db: DatabaseType;
  readonly llm: LlmProvider;
  readonly vectorStore: VectorStore;
  readonly knowledge: KnowledgeAgent;
  readonly insight: InsightAgent;
  readonly config: GitWhyConfig;
  readonly tracer: Tracer;
}

export interface McpRuntimeFactory {
  /**
   * Lazily build a runtime on first call; cache and return the same instance
   * afterwards. Throws if `.gitwhy/` is missing or no LLM credentials are
   * available.
   */
  get(): McpRuntime;
  /** Dispose of the cached runtime (closes DB). Mainly for tests. */
  reset(): void;
}

export interface CreateRuntimeOptions {
  readonly cwd: string;
  /** Override the LLM provider (used by tests; overrides env-var detection). */
  readonly llm?: LlmProvider;
}

export function createMcpRuntimeFactory(options: CreateRuntimeOptions): McpRuntimeFactory {
  let cached: McpRuntime | null = null;

  return {
    get(): McpRuntime {
      if (cached) return cached;

      loadDotEnv(options.cwd);

      const paths = resolvePaths(options.cwd);
      if (!existsSync(paths.commitsDb)) {
        throw new Error(
          `gitwhy is not initialized at ${options.cwd}. Run \`gitwhy init\` and \`gitwhy index\` first.`,
        );
      }

      const config = loadConfig(options.cwd);
      const llm = options.llm ?? resolveLlmFromEnv(config);
      const db = openDatabase({ path: paths.commitsDb });
      const vectorStore = createSqliteBlobVectorStore({ db });
      const knowledge = createKnowledgeAgent({ db, llm, vectorStore, config });
      const insight = createInsightAgent(db);
      const traceFile = join(paths.tracesDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.ndjson`);
      const tracer = createDefaultTracer(traceFile);
      tracer.emit({ kind: 'cli', data: { action: 'runtime_init', provider: llm.name } });

      cached = { cwd: options.cwd, db, llm, vectorStore, knowledge, insight, config, tracer };
      return cached;
    },
    reset(): void {
      if (cached) {
        try {
          cached.db.close();
        } catch {
          // ignore close errors
        }
        cached = null;
      }
    },
  };
}

/**
 * Resolve an LLM provider from environment. Precedence:
 *   1. GITWHY_USE_MOCK_LLM=1  → mock provider (no network)
 *   2. GITWHY_LLM_PROVIDER=<name> + matching API key
 *   3. Auto: OPENAI_API_KEY → openai
 *   4. Auto: GEMINI_API_KEY → gemini
 *   5. Throw with a helpful message.
 *
 * Env-var lookups are case-insensitive so users with either UPPER_CASE
 * (Unix convention) or lowercase .env files Just Work.
 */
export function resolveLlmFromEnv(_config: GitWhyConfig): LlmProvider {
  if (envVar('GITWHY_USE_MOCK_LLM') === '1') {
    return createMockLlmProvider();
  }

  const explicit = envVar('GITWHY_LLM_PROVIDER')?.toLowerCase();
  if (explicit === 'openai') {
    const key = envVar('OPENAI_API_KEY');
    if (!key) throw new Error('GITWHY_LLM_PROVIDER=openai but OPENAI_API_KEY is not set.');
    return createOpenAiProvider({ apiKey: key });
  }
  if (explicit === 'gemini') {
    const key = envVar('GEMINI_API_KEY') ?? envVar('GOOGLE_API_KEY');
    if (!key) {
      throw new Error('GITWHY_LLM_PROVIDER=gemini but GEMINI_API_KEY is not set.');
    }
    return createGeminiProvider({ apiKey: key });
  }
  if (explicit === 'mock') {
    return createMockLlmProvider();
  }

  const openAiKey = envVar('OPENAI_API_KEY');
  if (openAiKey) return createOpenAiProvider({ apiKey: openAiKey });

  const geminiKey = envVar('GEMINI_API_KEY') ?? envVar('GOOGLE_API_KEY');
  if (geminiKey) return createGeminiProvider({ apiKey: geminiKey });

  throw new Error(
    'No LLM credentials. Set OPENAI_API_KEY or GEMINI_API_KEY in your environment ' +
      '(or in a .env file at the repo root), or use GITWHY_USE_MOCK_LLM=1 for testing.',
  );
}

/**
 * Case-insensitive env var lookup. Tries UPPER first (Unix convention),
 * then lowercase as a fallback.
 */
function envVar(name: string): string | undefined {
  return process.env[name] ?? process.env[name.toLowerCase()];
}
