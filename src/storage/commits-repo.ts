import type { Database as DatabaseType } from 'better-sqlite3';
import type { CommitCluster } from '../indexer/commit-clusterer.js';
import type { IgnoreMatcher } from '../indexer/ignore-matcher.js';
import type {
  CommitCategory,
  CommitInfo,
} from '../indexer/types.js';

export interface UpsertCommitInput {
  readonly commit: CommitInfo;
  readonly category: CommitCategory;
  readonly categoryReason: string;
  readonly enrichedSummary?: string;
  readonly enrichmentModel?: string;
  /** When provided, sets `excluded = 1` on matching commit_files rows. */
  readonly ignoreMatcher?: IgnoreMatcher;
}

export interface StoredCommit {
  readonly hash: string;
  readonly shortHash: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committedAt: Date;
  readonly message: string;
  readonly parentHashes: readonly string[];
  readonly insertions: number;
  readonly deletions: number;
  readonly category: CommitCategory;
  readonly categoryReason: string | null;
  readonly enrichedSummary: string | null;
  readonly enrichmentModel: string | null;
  readonly indexedAt: Date;
}

export interface LlmCallRecord {
  readonly provider: string;
  readonly model: string;
  readonly purpose: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd?: number;
  readonly relatedCommit?: string;
}

export interface UsageSummary {
  readonly calls: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly costUsd: number;
}

export function upsertCommit(db: DatabaseType, input: UpsertCommitInput): void {
  const { commit, category, categoryReason, enrichedSummary, enrichmentModel } = input;
  const now = Date.now();

  const upsertStmt = db.prepare(`
    INSERT INTO commits (
      hash, short_hash, author_name, author_email, committed_at, message,
      parent_hashes, insertions, deletions, category, category_reason,
      enriched_summary, enrichment_model, indexed_at
    ) VALUES (
      @hash, @short_hash, @author_name, @author_email, @committed_at, @message,
      @parent_hashes, @insertions, @deletions, @category, @category_reason,
      @enriched_summary, @enrichment_model, @indexed_at
    )
    ON CONFLICT(hash) DO UPDATE SET
      category = excluded.category,
      category_reason = excluded.category_reason,
      enriched_summary = COALESCE(excluded.enriched_summary, commits.enriched_summary),
      enrichment_model = COALESCE(excluded.enrichment_model, commits.enrichment_model),
      indexed_at = excluded.indexed_at
  `);

  // Note: the column is named `excluded` and SQLite also uses `excluded` as
  // a keyword in ON CONFLICT clauses to refer to the would-be-inserted row.
  // To avoid the collision in the UPDATE SET we qualify with table alias on
  // the right-hand side. (The schema column name stays — renaming would be
  // a breaking migration.)
  const fileStmt = db.prepare(`
    INSERT INTO commit_files (
      commit_hash, path, old_path, status, insertions, deletions, is_binary, excluded
    ) VALUES (
      @commit_hash, @path, @old_path, @status, @insertions, @deletions, @is_binary, @excluded
    )
    ON CONFLICT(commit_hash, path) DO UPDATE SET
      old_path = excluded.old_path,
      status = excluded.status,
      insertions = excluded.insertions,
      deletions = excluded.deletions,
      is_binary = excluded.is_binary,
      excluded = excluded.excluded
  `);

  const txn = db.transaction(() => {
    upsertStmt.run({
      hash: commit.hash,
      short_hash: commit.shortHash,
      author_name: commit.author.name,
      author_email: commit.author.email,
      committed_at: commit.date.getTime(),
      message: commit.message,
      parent_hashes: JSON.stringify(commit.parentHashes),
      insertions: commit.insertions,
      deletions: commit.deletions,
      category,
      category_reason: categoryReason,
      enriched_summary: enrichedSummary ?? null,
      enrichment_model: enrichmentModel ?? null,
      indexed_at: now,
    });

    for (const f of commit.filesChanged) {
      fileStmt.run({
        commit_hash: commit.hash,
        path: f.path,
        old_path: f.oldPath ?? null,
        status: f.status,
        insertions: f.insertions,
        deletions: f.deletions,
        is_binary: f.isBinary ? 1 : 0,
        excluded: input.ignoreMatcher?.isExcluded(f.path) === true ? 1 : 0,
      });
    }
  });

  txn();
}

export function getCommit(db: DatabaseType, hash: string): StoredCommit | null {
  const row = db.prepare(`SELECT * FROM commits WHERE hash = ?`).get(hash) as
    | CommitRow
    | undefined;
  if (!row) return null;
  return rowToStoredCommit(row);
}

export function hasCommit(db: DatabaseType, hash: string): boolean {
  const row = db.prepare(`SELECT 1 FROM commits WHERE hash = ?`).get(hash);
  return row !== undefined;
}

export function getIndexedHashes(db: DatabaseType): Set<string> {
  const rows = db.prepare(`SELECT hash FROM commits`).all() as Array<{ hash: string }>;
  return new Set(rows.map((r) => r.hash));
}

/**
 * Latest committed_at across all indexed commits, in unix ms.
 * Used by incremental indexing to scope `git log --since=…` so re-runs
 * after a `git pull` don't re-walk the whole history just to skip-by-hash.
 *
 * Returns null when the DB has no commits yet (first run).
 */
export function getLatestCommittedAt(db: DatabaseType): number | null {
  const row = db
    .prepare(`SELECT MAX(committed_at) AS max FROM commits`)
    .get() as { max: number | null } | undefined;
  if (!row || row.max == null) return null;
  return row.max;
}

export function listCommits(
  db: DatabaseType,
  options: { limit?: number } = {},
): StoredCommit[] {
  const limitClause = options.limit !== undefined ? `LIMIT ${options.limit | 0}` : '';
  const rows = db
    .prepare(`SELECT * FROM commits ORDER BY committed_at DESC ${limitClause}`)
    .all() as CommitRow[];
  return rows.map(rowToStoredCommit);
}

export function countCommits(db: DatabaseType): number {
  const row = db.prepare(`SELECT COUNT(*) AS c FROM commits`).get() as { c: number };
  return row.c;
}

export function recordLlmCall(db: DatabaseType, call: LlmCallRecord): void {
  db.prepare(`
    INSERT INTO llm_calls (
      occurred_at, provider, model, purpose, prompt_tokens, completion_tokens, cost_usd, related_commit
    ) VALUES (
      @occurred_at, @provider, @model, @purpose, @prompt_tokens, @completion_tokens, @cost_usd, @related_commit
    )
  `).run({
    occurred_at: Date.now(),
    provider: call.provider,
    model: call.model,
    purpose: call.purpose,
    prompt_tokens: call.promptTokens,
    completion_tokens: call.completionTokens,
    cost_usd: call.costUsd ?? null,
    related_commit: call.relatedCommit ?? null,
  });
}

export function getUsageSummary(db: DatabaseType): UsageSummary {
  const row = db
    .prepare(`
      SELECT
        COUNT(*) AS calls,
        COALESCE(SUM(prompt_tokens), 0) AS prompt,
        COALESCE(SUM(completion_tokens), 0) AS completion,
        COALESCE(SUM(cost_usd), 0) AS cost
      FROM llm_calls
    `)
    .get() as { calls: number; prompt: number; completion: number; cost: number };
  return {
    calls: row.calls,
    promptTokens: row.prompt,
    completionTokens: row.completion,
    costUsd: row.cost,
  };
}

export function upsertCluster(
  db: DatabaseType,
  cluster: CommitCluster,
  enrichedSummary?: string,
): void {
  const clusterStmt = db.prepare(`
    INSERT INTO commit_clusters (
      cluster_id, author_email, started_at, ended_at, commit_count, enriched_summary, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(cluster_id) DO UPDATE SET
      enriched_summary = COALESCE(excluded.enriched_summary, commit_clusters.enriched_summary),
      indexed_at = excluded.indexed_at
  `);
  const memberStmt = db.prepare(`
    INSERT OR IGNORE INTO commit_cluster_members (cluster_id, commit_hash) VALUES (?, ?)
  `);
  const txn = db.transaction(() => {
    clusterStmt.run(
      cluster.clusterId,
      cluster.author.email,
      cluster.startedAt.getTime(),
      cluster.endedAt.getTime(),
      cluster.commits.length,
      enrichedSummary ?? null,
      Date.now(),
    );
    for (const c of cluster.commits) {
      memberStmt.run(cluster.clusterId, c.hash);
    }
  });
  txn();
}

interface CommitRow {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  committed_at: number;
  message: string;
  parent_hashes: string;
  insertions: number;
  deletions: number;
  category: CommitCategory;
  category_reason: string | null;
  enriched_summary: string | null;
  enrichment_model: string | null;
  indexed_at: number;
}

function rowToStoredCommit(row: CommitRow): StoredCommit {
  return {
    hash: row.hash,
    shortHash: row.short_hash,
    authorName: row.author_name,
    authorEmail: row.author_email,
    committedAt: new Date(row.committed_at),
    message: row.message,
    parentHashes: JSON.parse(row.parent_hashes) as string[],
    insertions: row.insertions,
    deletions: row.deletions,
    category: row.category,
    categoryReason: row.category_reason,
    enrichedSummary: row.enriched_summary,
    enrichmentModel: row.enrichment_model,
    indexedAt: new Date(row.indexed_at),
  };
}
