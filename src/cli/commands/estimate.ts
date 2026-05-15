import { loadConfig } from '../../config/loader.js';
import { categorize as runCategorize } from '../../indexer/categorizers/registry.js';
import { registerBuiltinCategorizers } from '../../indexer/categorizers/builtin.js';
import { createGitReader, gitReaderOptionsFromConfig } from '../../indexer/git-reader.js';
import { estimateCostUsd } from '../../indexer/pricing.js';
import type { CommitCategory, CommitInfo } from '../../indexer/types.js';

export interface EstimateOptions {
  readonly cwd: string;
  readonly since?: string;
  readonly until?: string;
  readonly maxCount?: number;
}

export interface CategoryEstimate {
  readonly category: CommitCategory;
  readonly count: number;
  readonly llmCallsPlanned: number;
  readonly estimatedPromptTokens: number;
  readonly estimatedCompletionTokens: number;
  readonly estimatedUsd: number;
}

export interface EstimateResult {
  readonly totalCommits: number;
  readonly enrichmentModel: string;
  readonly byCategory: readonly CategoryEstimate[];
  readonly grandTotal: {
    readonly llmCallsPlanned: number;
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly usd: number;
  };
}

const CHARS_PER_TOKEN = 4;
const COMPLETION_TOKENS_PER_ENRICHMENT = 80;
const MEGA_GROUP_COUNT_HINT = 4;

const NON_ENRICHED: ReadonlySet<CommitCategory> = new Set([
  'merge',
  'bot',
  'formatting',
  'initial',
  'revert',
]);

export async function runEstimate(options: EstimateOptions): Promise<EstimateResult> {
  registerBuiltinCategorizers();
  const config = loadConfig(options.cwd);
  const readerOptions = gitReaderOptionsFromConfig(options.cwd, config.scope, {
    ...(options.since !== undefined && { since: options.since }),
    ...(options.until !== undefined && { until: options.until }),
    ...(options.maxCount !== undefined && { maxCount: options.maxCount }),
  });
  const reader = createGitReader(readerOptions);

  const buckets = new Map<CommitCategory, CategoryEstimate>();
  let totalCommits = 0;

  for await (const commit of reader.iterate()) {
    totalCommits++;
    const { category } = runCategorize(commit);
    const estimate = estimateForCommit(commit, category, config.provider.indexingModel);
    const prev = buckets.get(category);
    if (prev) {
      buckets.set(category, {
        category,
        count: prev.count + 1,
        llmCallsPlanned: prev.llmCallsPlanned + estimate.llmCalls,
        estimatedPromptTokens: prev.estimatedPromptTokens + estimate.promptTokens,
        estimatedCompletionTokens: prev.estimatedCompletionTokens + estimate.completionTokens,
        estimatedUsd: prev.estimatedUsd + estimate.usd,
      });
    } else {
      buckets.set(category, {
        category,
        count: 1,
        llmCallsPlanned: estimate.llmCalls,
        estimatedPromptTokens: estimate.promptTokens,
        estimatedCompletionTokens: estimate.completionTokens,
        estimatedUsd: estimate.usd,
      });
    }
  }

  const byCategory = [...buckets.values()].sort((a, b) => b.count - a.count);
  const grandTotal = byCategory.reduce(
    (acc, c) => ({
      llmCallsPlanned: acc.llmCallsPlanned + c.llmCallsPlanned,
      promptTokens: acc.promptTokens + c.estimatedPromptTokens,
      completionTokens: acc.completionTokens + c.estimatedCompletionTokens,
      usd: acc.usd + c.estimatedUsd,
    }),
    { llmCallsPlanned: 0, promptTokens: 0, completionTokens: 0, usd: 0 },
  );

  return {
    totalCommits,
    enrichmentModel: config.provider.indexingModel,
    byCategory,
    grandTotal,
  };
}

function estimateForCommit(
  commit: CommitInfo,
  category: CommitCategory,
  model: string,
): { llmCalls: number; promptTokens: number; completionTokens: number; usd: number } {
  if (NON_ENRICHED.has(category) || category === 'micro') {
    return { llmCalls: 0, promptTokens: 0, completionTokens: 0, usd: 0 };
  }

  const lineTokens = Math.ceil(((commit.insertions + commit.deletions) * 40) / CHARS_PER_TOKEN);
  const overheadTokens = 250;
  const calls = category === 'mega' ? MEGA_GROUP_COUNT_HINT : 1;
  const promptTokens = (lineTokens + overheadTokens) * calls;
  const completionTokens = COMPLETION_TOKENS_PER_ENRICHMENT * calls;
  return {
    llmCalls: calls,
    promptTokens,
    completionTokens,
    usd: estimateCostUsd(model, promptTokens, completionTokens),
  };
}
