import type { Database as DatabaseType } from 'better-sqlite3';

export interface HotspotOptions {
  /** Look back this many days for "recent" activity. Default 90. */
  readonly recentDays?: number;
  /** Maximum results to return. Default 20. */
  readonly limit?: number;
  /** Optional path prefix to scope the analysis. */
  readonly pathPrefix?: string;
}

export interface Hotspot {
  readonly path: string;
  readonly totalCommits: number;
  readonly recentCommits: number;
  readonly totalChurn: number;
  readonly recentChurn: number;
  readonly contributorCount: number;
  readonly hotspotScore: number;
}

interface HotspotRow {
  path: string;
  total_commits: number;
  recent_commits: number;
  total_churn: number;
  recent_churn: number;
  contributor_count: number;
}

const DEFAULT_RECENT_DAYS = 90;
const DEFAULT_LIMIT = 20;

/**
 * Detect hotspot files: high churn × recent activity. The score is
 * `recent_commits * log(1 + total_commits)` so that files which are both
 * historically churned and recently active rise to the top. Repeatedly
 * changed code is statistically the most bug-prone.
 */
export function getHotspots(db: DatabaseType, options: HotspotOptions = {}): Hotspot[] {
  const recentDays = options.recentDays ?? DEFAULT_RECENT_DAYS;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const sinceMs = Date.now() - recentDays * 24 * 60 * 60 * 1000;

  const pathFilter = options.pathPrefix !== undefined ? `${options.pathPrefix}%` : '%';

  const rows = db
    .prepare(`
      SELECT
        cf.path,
        COUNT(DISTINCT cf.commit_hash) AS total_commits,
        SUM(CASE WHEN c.committed_at >= @since_ms THEN 1 ELSE 0 END) AS recent_commits,
        SUM(cf.insertions + cf.deletions) AS total_churn,
        SUM(CASE WHEN c.committed_at >= @since_ms THEN cf.insertions + cf.deletions ELSE 0 END) AS recent_churn,
        COUNT(DISTINCT c.author_email) AS contributor_count
      FROM commit_files cf
      INNER JOIN commits c ON c.hash = cf.commit_hash
      WHERE c.category NOT IN ('merge', 'bot', 'formatting')
        AND cf.is_binary = 0
        AND cf.excluded = 0
        AND cf.path LIKE @path_filter
      GROUP BY cf.path
      HAVING recent_commits > 0
      ORDER BY (recent_commits * total_commits) DESC
      LIMIT @lim
    `)
    .all({ since_ms: sinceMs, path_filter: pathFilter, lim: limit }) as HotspotRow[];

  return rows.map((row) => ({
    path: row.path,
    totalCommits: row.total_commits,
    recentCommits: row.recent_commits,
    totalChurn: row.total_churn ?? 0,
    recentChurn: row.recent_churn ?? 0,
    contributorCount: row.contributor_count,
    hotspotScore: row.recent_commits * (1.0 + Math.log1p(row.total_commits)),
  }));
}
