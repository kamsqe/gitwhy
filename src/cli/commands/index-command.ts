import { existsSync } from 'node:fs';
import { loadConfig, resolvePaths } from '../../config/loader.js';
import { createGitReader, gitReaderOptionsFromConfig } from '../../indexer/git-reader.js';
import { loadIgnoreMatcher } from '../../indexer/ignore-matcher.js';
import { indexRepo } from '../../indexer/indexer.js';
import type { IndexProgress, IndexResult } from '../../indexer/indexer.js';
import { resolveLlmFromEnv } from '../../mcp/runtime.js';
import { createGeminiProvider } from '../../providers/llm/gemini.js';
import { createMockLlmProvider } from '../../providers/llm/mock.js';
import { createOpenAiProvider } from '../../providers/llm/openai.js';
import type { LlmProvider } from '../../providers/llm/types.js';
import { getLatestCommittedAt } from '../../storage/commits-repo.js';
import { openDatabase } from '../../storage/sqlite.js';
import { logger } from '../../utils/logger.js';

const INCREMENTAL_SAFETY_BUFFER_MS = 24 * 60 * 60 * 1000;

export interface IndexCommandOptions {
  readonly cwd: string;
  readonly provider?: 'openai' | 'gemini' | 'mock';
  readonly model?: string;
  readonly budgetUsd?: number;
  /** Override config.scope.since (e.g. "6 months ago", "2024-01-01"). */
  readonly since?: string;
  /** Override config.scope.until. */
  readonly until?: string;
  /** Cap the number of commits processed (newest first). */
  readonly maxCount?: number;
  /**
   * Receive every progress tick — used by the SSE job manager to stream
   * to the web UI. Default behavior (when omitted) is the CLI logger
   * pattern: log every 5 processed + the final tick.
   */
  readonly onProgress?: (progress: Readonly<IndexProgress>) => void;
  /** Cooperative cancellation; forwarded to indexer. */
  readonly signal?: AbortSignal;
  /**
   * Force a full git-log iteration even when a prior index exists.
   * Useful after force-pushes / rebases or when you suspect drift.
   * Default false: incremental — caps `--since` at the most-recent
   * indexed commit timestamp (minus a 24h safety buffer) so re-runs
   * after `git pull` only walk new history.
   */
  readonly full?: boolean;
}

export async function runIndexCommand(options: IndexCommandOptions): Promise<IndexResult> {
  const cwd = options.cwd;
  const config = loadConfig(cwd);
  const paths = resolvePaths(cwd, config);

  // Incremental indexing — when a prior index exists and the caller didn't
  // pin --since explicitly, scope the git log to commits at or after the
  // most recent indexed timestamp (with a 24h safety buffer for clock skew
  // and backdated commits). The existing hash-dedup still catches anything
  // we re-iterate, so this is purely a speedup, not a correctness change.
  let effectiveSince = options.since;
  let incrementalNote: string | null = null;
  if (effectiveSince === undefined && options.full !== true && existsSync(paths.commitsDb)) {
    const probeDb = openDatabase({ path: paths.commitsDb });
    try {
      const latest = getLatestCommittedAt(probeDb);
      if (latest !== null) {
        const sinceMs = latest - INCREMENTAL_SAFETY_BUFFER_MS;
        effectiveSince = new Date(sinceMs).toISOString();
        incrementalNote = `incremental: resuming from ${new Date(sinceMs).toISOString().slice(0, 10)} (use --full to re-walk full history)`;
      }
    } finally {
      probeDb.close();
    }
  }

  const readerOptions = gitReaderOptionsFromConfig(cwd, config.scope, {
    ...(effectiveSince !== undefined && { since: effectiveSince }),
    ...(options.until !== undefined && { until: options.until }),
    ...(options.maxCount !== undefined && { maxCount: options.maxCount }),
  });
  if (incrementalNote !== null) {
    logger.info(incrementalNote);
  }
  const reader = createGitReader(readerOptions);
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

  const ignoreMatcher = loadIgnoreMatcher(cwd);

  let lastLogged = 0;
  const result = await indexRepo({
    reader,
    db,
    llm,
    config: effectiveConfig,
    ignoreMatcher,
    ...(options.model !== undefined && { enrichmentModel: options.model }),
    ...(options.signal !== undefined && { signal: options.signal }),
    onProgress: (p: Readonly<IndexProgress>) => {
      // Always forward to the caller (used by the SSE bridge).
      options.onProgress?.(p);
      // CLI-style log throttling — only when no caller-provided progress
      // sink, so the web UI doesn't get spammed in stdout.
      if (options.onProgress === undefined) {
        if (p.processed - lastLogged >= 5 || p.processed === p.total) {
          lastLogged = p.processed;
          logger.info(
            `indexed ${p.processed}/${p.total} (enriched=${p.enriched}, skipped=${p.skipped}, errors=${p.errors}, est. $${p.costUsd.toFixed(4)})`,
          );
        }
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
