import { existsSync, statSync } from 'node:fs';
import type { Database as DatabaseType } from 'better-sqlite3';
import { getHotspots } from '../../agents/insight/index.js';
import { resolvePaths } from '../../config/loader.js';
import { createGitReader } from '../../indexer/git-reader.js';
import { countCommitEmbeddings } from '../../storage/embeddings-repo.js';
import {
  countCommits,
  getUsageSummary,
} from '../../storage/commits-repo.js';
import { openDatabase } from '../../storage/sqlite.js';

export interface StatusOptions {
  readonly cwd: string;
}

export interface StatusResult {
  readonly initialized: boolean;
  readonly indexedCommits: number;
  readonly embeddings: number;
  readonly llmCalls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
  readonly lastIndexedAt: Date | null;
  readonly dbSizeBytes: number;
  readonly gitTotalCommits: number;
  readonly indexCoverage: number;
  readonly topHotspots: ReadonlyArray<{ path: string; recentCommits: number }>;
  readonly warnings: readonly string[];
}

export async function runStatusCommand(options: StatusOptions): Promise<StatusResult> {
  const paths = resolvePaths(options.cwd);
  const warnings: string[] = [];

  if (!existsSync(paths.commitsDb)) {
    return {
      initialized: false,
      indexedCommits: 0,
      embeddings: 0,
      llmCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      lastIndexedAt: null,
      dbSizeBytes: 0,
      gitTotalCommits: 0,
      indexCoverage: 0,
      topHotspots: [],
      warnings: ['gitwhy is not initialized. Run `gitwhy init` then `gitwhy index`.'],
    };
  }

  const db: DatabaseType = openDatabase({ path: paths.commitsDb });
  try {
    const commitsCount = countCommits(db);
    const embeddingsCount = countCommitEmbeddings(db);
    const usage = getUsageSummary(db);
    const lastIndexedRow = db
      .prepare(`SELECT MAX(indexed_at) AS t FROM commits`)
      .get() as { t: number | null };
    const dbSize = statSync(paths.commitsDb).size;

    const reader = createGitReader({ cwd: options.cwd });
    const diag = await reader.diagnose();

    const coverage = diag.totalCommits === 0 ? 0 : commitsCount / diag.totalCommits;

    if (diag.totalCommits === 0) {
      warnings.push('No commits in the git repository.');
    } else if (commitsCount === 0) {
      warnings.push('Index is empty. Run `gitwhy index` to populate it.');
    } else if (coverage < 0.5) {
      warnings.push(
        `Only ${(coverage * 100).toFixed(0)}% of commits indexed. Rerun \`gitwhy index\` to catch up.`,
      );
    }
    if (commitsCount > 0 && embeddingsCount === 0) {
      warnings.push('No embeddings stored — Q&A will fall back to "I don\'t know". Re-run `gitwhy index`.');
    }
    if (diag.isShallow) {
      warnings.push('Repository is a shallow clone. Run `git fetch --unshallow` for complete history.');
    }

    const hotspots = getHotspots(db, { recentDays: 30, limit: 5 }).map((h) => ({
      path: h.path,
      recentCommits: h.recentCommits,
    }));

    return {
      initialized: true,
      indexedCommits: commitsCount,
      embeddings: embeddingsCount,
      llmCalls: usage.calls,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      costUsd: usage.costUsd,
      lastIndexedAt: lastIndexedRow.t === null ? null : new Date(lastIndexedRow.t),
      dbSizeBytes: dbSize,
      gitTotalCommits: diag.totalCommits,
      indexCoverage: coverage,
      topHotspots: hotspots,
      warnings,
    };
  } finally {
    db.close();
  }
}
