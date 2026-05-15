import type { Database as DatabaseType } from 'better-sqlite3';

export interface GhostCodeOptions {
  /** A contributor is considered inactive if their most recent commit is older than this. Default 180 days. */
  readonly inactiveAfterDays?: number;
  /** Share threshold for "sole owner". Default 80% — a single author owning 80%+ of the file's churn qualifies. */
  readonly soleOwnerSharePercent?: number;
  /** Max results to return. Default 50. */
  readonly limit?: number;
  /** Optional path prefix to scope the analysis. */
  readonly pathPrefix?: string;
}

export interface GhostCode {
  readonly path: string;
  readonly soleOwnerName: string;
  readonly soleOwnerEmail: string;
  readonly ownerSharePercent: number;
  readonly ownerLastCommit: Date;
  readonly daysSinceOwnerActive: number;
  readonly totalCommits: number;
  readonly contributorCount: number;
}

const DEFAULT_INACTIVE_AFTER_DAYS = 180;
const DEFAULT_SOLE_OWNER_SHARE = 80;
const DEFAULT_LIMIT = 50;

interface ContribRow {
  path: string;
  author_email: string;
  author_name: string;
  commits: number;
  lines: number;
  last_commit: number;
}

interface FileTotalRow {
  path: string;
  total_commits: number;
  total_lines: number;
  contributor_count: number;
}

/**
 * Detect "ghost code" files: those primarily owned by a contributor who
 * has been inactive for too long. A file qualifies when one contributor
 * owns at least `soleOwnerSharePercent` of the file's line changes AND
 * their last commit to the file is older than `inactiveAfterDays`.
 *
 * These files are bus-factor-zero risks: nobody currently active in the
 * project has meaningful context for them.
 */
export function detectGhostCode(db: DatabaseType, options: GhostCodeOptions = {}): GhostCode[] {
  const inactiveAfterDays = options.inactiveAfterDays ?? DEFAULT_INACTIVE_AFTER_DAYS;
  const soleOwnerShare = options.soleOwnerSharePercent ?? DEFAULT_SOLE_OWNER_SHARE;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const pathFilter = options.pathPrefix !== undefined ? `${options.pathPrefix}%` : '%';
  const inactiveCutoffMs = Date.now() - inactiveAfterDays * 24 * 60 * 60 * 1000;

  const totals = db
    .prepare(`
      SELECT
        cf.path,
        COUNT(DISTINCT cf.commit_hash) AS total_commits,
        SUM(cf.insertions + cf.deletions) AS total_lines,
        COUNT(DISTINCT c.author_email) AS contributor_count
      FROM commit_files cf
      INNER JOIN commits c ON c.hash = cf.commit_hash
      WHERE c.category NOT IN ('merge', 'bot', 'formatting')
        AND cf.path LIKE @path_filter
      GROUP BY cf.path
    `)
    .all({ path_filter: pathFilter }) as FileTotalRow[];

  const contribs = db
    .prepare(`
      SELECT
        cf.path,
        c.author_email,
        c.author_name,
        COUNT(DISTINCT cf.commit_hash) AS commits,
        SUM(cf.insertions + cf.deletions) AS lines,
        MAX(c.committed_at) AS last_commit
      FROM commit_files cf
      INNER JOIN commits c ON c.hash = cf.commit_hash
      WHERE c.category NOT IN ('merge', 'bot', 'formatting')
        AND cf.path LIKE @path_filter
      GROUP BY cf.path, c.author_email
    `)
    .all({ path_filter: pathFilter }) as ContribRow[];

  const topByPath = new Map<string, ContribRow>();
  for (const row of contribs) {
    const existing = topByPath.get(row.path);
    if (!existing || (row.lines ?? 0) > (existing.lines ?? 0)) {
      topByPath.set(row.path, row);
    }
  }

  const totalsByPath = new Map<string, FileTotalRow>(totals.map((t) => [t.path, t]));
  const results: GhostCode[] = [];

  for (const [path, top] of topByPath) {
    const total = totalsByPath.get(path);
    if (!total || total.total_lines === 0) continue;
    const share = ((top.lines ?? 0) / total.total_lines) * 100;
    if (share < soleOwnerShare) continue;
    if (top.last_commit >= inactiveCutoffMs) continue;

    const daysSince = Math.floor((Date.now() - top.last_commit) / (24 * 60 * 60 * 1000));
    results.push({
      path,
      soleOwnerName: top.author_name,
      soleOwnerEmail: top.author_email,
      ownerSharePercent: share,
      ownerLastCommit: new Date(top.last_commit),
      daysSinceOwnerActive: daysSince,
      totalCommits: total.total_commits,
      contributorCount: total.contributor_count,
    });
  }

  results.sort((a, b) => b.daysSinceOwnerActive - a.daysSinceOwnerActive);
  return results.slice(0, limit);
}
