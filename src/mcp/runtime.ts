import { existsSync } from 'node:fs';
import type { Database as DatabaseType } from 'better-sqlite3';
import { createKnowledgeAgent } from '../agents/knowledge/index.js';
import type { KnowledgeAgent } from '../agents/knowledge/index.js';
import type { GitWhyConfig } from '../config/index.js';
import { loadConfig, resolvePaths } from '../config/loader.js';
import { createMockLlmProvider } from '../providers/llm/mock.js';
import { createOpenAiProvider } from '../providers/llm/openai.js';
import type { LlmProvider } from '../providers/llm/types.js';
import { createSqliteBlobVectorStore } from '../providers/vector/sqlite-blob.js';
import type { VectorStore } from '../providers/vector/types.js';
import { openDatabase } from '../storage/sqlite.js';

export interface McpRuntime {
  readonly cwd: string;
  readonly db: DatabaseType;
  readonly llm: LlmProvider;
  readonly vectorStore: VectorStore;
  readonly knowledge: KnowledgeAgent;
  readonly config: GitWhyConfig;
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

      cached = { cwd: options.cwd, db, llm, vectorStore, knowledge, config };
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

function resolveLlmFromEnv(_config: GitWhyConfig): LlmProvider {
  if (process.env['GITWHY_USE_MOCK_LLM'] === '1') {
    return createMockLlmProvider();
  }
  const apiKey = process.env['OPENAI_API_KEY'];
  if (!apiKey) {
    throw new Error(
      'No LLM credentials. Set OPENAI_API_KEY, or set GITWHY_USE_MOCK_LLM=1 for testing.',
    );
  }
  return createOpenAiProvider({ apiKey });
}
