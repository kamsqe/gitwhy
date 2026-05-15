import type { Database as DatabaseType } from 'better-sqlite3';
import type { GitWhyConfig } from '../config/index.js';
import type { LlmProvider } from '../providers/llm/types.js';
import {
  recordLlmCall,
  upsertCluster,
  upsertCommit,
} from '../storage/commits-repo.js';
import { getIndexedHashes } from '../storage/commits-repo.js';
import { upsertCommitEmbedding } from '../storage/embeddings-repo.js';
import { categorize as runCategorize } from './categorizers/registry.js';
import { registerBuiltinCategorizers } from './categorizers/builtin.js';
import { clusterCommits } from './commit-clusterer.js';
import { analyzeDiff, isFormattingOnlyDiff } from './diff-analyzer.js';
import type { GitReader } from './git-reader.js';
import { decomposeMegaCommit } from './mega-commit-decomposer.js';
import { estimateCostUsd } from './pricing.js';
import type { CommitCategory, CommitInfo } from './types.js';

export interface IndexProgress {
  total: number;
  processed: number;
  enriched: number;
  skipped: number;
  errors: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  currentHash?: string;
}

export interface IndexerOptions {
  readonly reader: GitReader;
  readonly db: DatabaseType;
  readonly llm: LlmProvider;
  readonly config: GitWhyConfig;
  readonly onProgress?: (progress: Readonly<IndexProgress>) => void;
  readonly onBudgetExceeded?: () => 'stop' | 'continue';
  readonly skipEnrichmentForCategories?: readonly CommitCategory[];
  /** Override the model used for enrichment (defaults to config.provider.indexingModel). */
  readonly enrichmentModel?: string;
  /** When true, skip generating embeddings for enriched summaries. Default false. */
  readonly skipEmbeddings?: boolean;
}

export interface IndexResult {
  readonly progress: Readonly<IndexProgress>;
  readonly durationMs: number;
  readonly stoppedReason?: 'budget' | 'complete';
}

const DEFAULT_SKIP_ENRICHMENT: readonly CommitCategory[] = [
  'merge',
  'bot',
  'formatting',
  'initial',
];

export async function indexRepo(options: IndexerOptions): Promise<IndexResult> {
  const startTime = Date.now();
  registerBuiltinCategorizers();

  const { reader, db, llm, config } = options;
  const enrichmentModel = options.enrichmentModel ?? config.provider.indexingModel;
  const skipEnrich = new Set<CommitCategory>(
    options.skipEnrichmentForCategories ?? DEFAULT_SKIP_ENRICHMENT,
  );

  const progress: IndexProgress = {
    total: await reader.count(),
    processed: 0,
    enriched: 0,
    skipped: 0,
    errors: 0,
    promptTokens: 0,
    completionTokens: 0,
    costUsd: 0,
  };

  const alreadyIndexed = getIndexedHashes(db);
  const microCommits: CommitInfo[] = [];
  const categoryByHash = new Map<string, CommitCategory>();
  let stoppedReason: 'budget' | 'complete' = 'complete';

  for await (const commit of reader.iterate()) {
    progress.processed++;
    progress.currentHash = commit.hash;

    if (alreadyIndexed.has(commit.hash)) {
      progress.skipped++;
      options.onProgress?.(progress);
      continue;
    }

    const categorization = runCategorize(commit);
    let effectiveCategory: CommitCategory = categorization.category;
    let effectiveReason = categorization.reason;

    let enrichedSummary: string | undefined;
    let enrichmentModelUsed: string | undefined;

    // Insert the commit row early so any subsequent llm_calls FK to a valid
    // commit hash. We'll re-upsert later with the enriched summary.
    upsertCommit(db, {
      commit,
      category: effectiveCategory,
      categoryReason: effectiveReason,
    });

    if (effectiveCategory === 'micro') {
      microCommits.push(commit);
    } else if (!skipEnrich.has(effectiveCategory)) {
      try {
        const diff = await reader.loadDiff(commit.hash);

        if (effectiveCategory !== 'mega' && isFormattingOnlyDiff(diff)) {
          effectiveCategory = 'formatting';
          effectiveReason = 'diff inspection: whitespace-only changes';
        } else if (effectiveCategory === 'mega') {
          const enriched = await enrichMegaCommit(commit, diff, llm, enrichmentModel, db, progress);
          enrichedSummary = enriched.summary;
          enrichmentModelUsed = enriched.modelUsed;
          progress.enriched++;
        } else {
          const analysis = await analyzeDiff(
            { commit, diff },
            { llm, model: enrichmentModel },
          );
          enrichedSummary = analysis.enrichedSummary;
          enrichmentModelUsed = analysis.modelUsed;
          progress.enriched++;
          progress.promptTokens += analysis.usage.promptTokens;
          progress.completionTokens += analysis.usage.completionTokens;
          recordLlmCall(db, {
            provider: llm.name,
            model: analysis.modelUsed,
            purpose: 'enrich_commit',
            promptTokens: analysis.usage.promptTokens,
            completionTokens: analysis.usage.completionTokens,
            costUsd: estimateCostUsd(
              analysis.modelUsed,
              analysis.usage.promptTokens,
              analysis.usage.completionTokens,
            ),
            relatedCommit: commit.hash,
          });
        }
      } catch {
        progress.errors++;
      }
    }

    categoryByHash.set(commit.hash, effectiveCategory);

    // Re-upsert with enrichment results (COALESCE preserves non-null values).
    upsertCommit(db, {
      commit,
      category: effectiveCategory,
      categoryReason: effectiveReason,
      ...(enrichedSummary !== undefined && { enrichedSummary }),
      ...(enrichmentModelUsed !== undefined && { enrichmentModel: enrichmentModelUsed }),
    });

    if (enrichedSummary !== undefined && options.skipEmbeddings !== true) {
      try {
        const embedResult = await llm.embed({
          input: enrichedSummary,
          model: config.provider.embeddingModel,
        });
        const vec = embedResult.embeddings[0];
        if (vec !== undefined) {
          upsertCommitEmbedding(db, {
            commitHash: commit.hash,
            embedding: vec,
            model: embedResult.model,
          });
        }
        progress.promptTokens += embedResult.usage.promptTokens;
        recordLlmCall(db, {
          provider: llm.name,
          model: embedResult.model,
          purpose: 'embed_commit',
          promptTokens: embedResult.usage.promptTokens,
          completionTokens: 0,
          costUsd: estimateCostUsd(embedResult.model, embedResult.usage.promptTokens, 0),
          relatedCommit: commit.hash,
        });
      } catch {
        progress.errors++;
      }
    }

    if (enrichedSummary !== undefined && enrichmentModelUsed !== undefined) {
      const recentCost = estimateCostUsd(enrichmentModelUsed, 0, 0);
      progress.costUsd += recentCost;
    }
    progress.costUsd = estimateCostUsd(
      enrichmentModel,
      progress.promptTokens,
      progress.completionTokens,
    );

    options.onProgress?.(progress);

    const budgetCap = config.budget.maxUsd;
    if (budgetCap !== undefined && progress.costUsd >= budgetCap) {
      const action = options.onBudgetExceeded?.() ?? 'stop';
      if (action === 'stop') {
        stoppedReason = 'budget';
        break;
      }
    }
  }

  for (const commit of microCommits) {
    if (alreadyIndexed.has(commit.hash)) continue;
    upsertCommit(db, {
      commit,
      category: 'micro',
      categoryReason: 'small + vague (clustered)',
    });
  }

  const clusters = clusterCommits(microCommits, categoryByHash);
  for (const cluster of clusters) {
    upsertCluster(db, cluster);
  }

  return {
    progress,
    durationMs: Date.now() - startTime,
    stoppedReason,
  };
}

async function enrichMegaCommit(
  commit: CommitInfo,
  fullDiff: string,
  llm: LlmProvider,
  model: string,
  db: DatabaseType,
  progress: IndexProgress,
): Promise<{ summary: string; modelUsed: string }> {
  const groups = decomposeMegaCommit(commit, fullDiff);
  const groupSummaries: string[] = [];
  let modelUsed = model;

  for (const group of groups) {
    if (group.diff.length === 0) continue;
    const groupCommit: CommitInfo = { ...commit, message: `[${group.groupKey}] ${commit.message}` };
    const analysis = await analyzeDiff(
      { commit: groupCommit, diff: group.diff },
      { llm, model },
    );
    modelUsed = analysis.modelUsed;
    groupSummaries.push(`**${group.groupKey}**: ${analysis.enrichedSummary}`);
    progress.promptTokens += analysis.usage.promptTokens;
    progress.completionTokens += analysis.usage.completionTokens;
    recordLlmCall(db, {
      provider: llm.name,
      model: analysis.modelUsed,
      purpose: 'enrich_commit_mega_group',
      promptTokens: analysis.usage.promptTokens,
      completionTokens: analysis.usage.completionTokens,
      costUsd: estimateCostUsd(
        analysis.modelUsed,
        analysis.usage.promptTokens,
        analysis.usage.completionTokens,
      ),
      relatedCommit: commit.hash,
    });
  }

  return {
    summary: groupSummaries.length > 0 ? groupSummaries.join('\n') : 'Mega commit: no enrichable groups',
    modelUsed,
  };
}
