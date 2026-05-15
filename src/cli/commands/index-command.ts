import { loadConfig, resolvePaths } from '../../config/loader.js';
import { createGitReader } from '../../indexer/git-reader.js';
import { indexRepo } from '../../indexer/indexer.js';
import type { IndexProgress, IndexResult } from '../../indexer/indexer.js';
import { resolveLlmFromEnv } from '../../mcp/runtime.js';
import { createGeminiProvider } from '../../providers/llm/gemini.js';
import { createMockLlmProvider } from '../../providers/llm/mock.js';
import { createOpenAiProvider } from '../../providers/llm/openai.js';
import type { LlmProvider } from '../../providers/llm/types.js';
import { openDatabase } from '../../storage/sqlite.js';
import { logger } from '../../utils/logger.js';

export interface IndexCommandOptions {
  readonly cwd: string;
  readonly provider?: 'openai' | 'gemini' | 'mock';
  readonly model?: string;
  readonly budgetUsd?: number;
}

export async function runIndexCommand(options: IndexCommandOptions): Promise<IndexResult> {
  const cwd = options.cwd;
  const config = loadConfig(cwd);
  const paths = resolvePaths(cwd, config);

  const reader = createGitReader({ cwd });
  const diag = await reader.diagnose();
  if (!diag.isGitRepo) {
    throw new Error('No git repository at this path. Run `git init` first.');
  }
  if (diag.isEmpty) {
    throw new Error('Git repository has no commits to index.');
  }
  if (diag.isShallow) {
    logger.warn('Repository is a shallow clone. Run `git fetch --unshallow` for full history.');
  }

  const llm = await resolveLlmProvider(options.provider, options.model);
  const db = openDatabase({ path: paths.commitsDb });

  const effectiveConfig = options.budgetUsd !== undefined
    ? { ...config, budget: { ...config.budget, maxUsd: options.budgetUsd } }
    : config;

  let lastLogged = 0;
  const result = await indexRepo({
    reader,
    db,
    llm,
    config: effectiveConfig,
    ...(options.model !== undefined && { enrichmentModel: options.model }),
    onProgress: (p: Readonly<IndexProgress>) => {
      if (p.processed - lastLogged >= 5 || p.processed === p.total) {
        lastLogged = p.processed;
        logger.info(
          `indexed ${p.processed}/${p.total} (enriched=${p.enriched}, skipped=${p.skipped}, errors=${p.errors}, est. $${p.costUsd.toFixed(4)})`,
        );
      }
    },
  });

  db.close();

  logger.info(
    `done in ${result.durationMs}ms — processed ${result.progress.processed}, enriched ${result.progress.enriched}, errors ${result.progress.errors}, cost $${result.progress.costUsd.toFixed(4)}`,
  );
  if (result.stoppedReason === 'budget') {
    logger.warn('Stopped early: budget cap reached. Rerun with a higher --budget to continue.');
  }
  return result;
}

function envCaseInsensitive(name: string): string | undefined {
  return process.env[name] ?? process.env[name.toLowerCase()];
}

async function resolveLlmProvider(
  provider: 'openai' | 'gemini' | 'mock' | undefined,
  defaultModel: string | undefined,
): Promise<LlmProvider> {
  if (provider === 'mock' || process.env['GITWHY_USE_MOCK_LLM'] === '1') {
    logger.info('Using mock LLM provider (no real API calls)');
    return createMockLlmProvider();
  }
  if (provider === 'openai') {
    const key = envCaseInsensitive('OPENAI_API_KEY');
    if (!key) throw new Error('--provider openai requires OPENAI_API_KEY.');
    return createOpenAiProvider({
      apiKey: key,
      ...(defaultModel !== undefined && { defaultModel }),
    });
  }
  if (provider === 'gemini') {
    const key = envCaseInsensitive('GEMINI_API_KEY') ?? envCaseInsensitive('GOOGLE_API_KEY');
    if (!key) throw new Error('--provider gemini requires GEMINI_API_KEY.');
    return createGeminiProvider({
      apiKey: key,
      ...(defaultModel !== undefined && { defaultModel }),
    });
  }
  // No explicit --provider: fall back to env-driven resolution (handles
  // mock / openai / gemini autodetect from env vars).
  const cfg = loadConfig(process.cwd());
  return resolveLlmFromEnv(cfg);
}
