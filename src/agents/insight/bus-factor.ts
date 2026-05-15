import type { Database as DatabaseType } from 'better-sqlite3';

export interface ContributorShare {
  readonly authorName: string;
  readonly authorEmail: string;
  readonly commits: number;
  readonly linesChanged: number;
  readonly sharePercent: number;
  readonly lastCommit: Date;
}

export interface BusFactorResult {
  readonly path: string;
  readonly totalCommits: number;
  readonly totalLinesChanged: number;
  readonly busFactor: number;
  readonly contributors: readonly ContributorShare[];
  readonly soleOwner: ContributorShare | null;
}

interface ContributorRow {
  author_name: string;
  author_email: string;
  commits: number;
  lines: number;
  last_commit: number;
}

/**
 * Calculate the bus factor for a file or directory: the minimum number of
 * contributors whose combined share of line changes exceeds 50%. A bus
 * factor of 1 indicates a single point of failure.
 *
 * Bot and merge commits are excluded — they don't represent meaningful
 * human ownership.
 */
export function calculateBusFactor(db: DatabaseType, path: string): BusFactorResult {
  const normalized = path.replace(/\\/g, '/');
  const pattern = normalized.endsWith('/') ? `${normalized}%` : normalized;

  const rows = db
    .prepare(`
      SELECT
        c.author_name,
        c.author_email,
        COUNT(DISTINCT cf.commit_hash) AS commits,
        SUM(cf.insertions + cf.deletions) AS lines,
        MAX(c.committed_at) AS last_commit
      FROM commit_files cf
      INNER JOIN commits c ON c.hash = cf.commit_hash
      WHERE (cf.path = @exact OR cf.path LIKE @pattern)
        AND c.category NOT IN ('merge', 'bot')
      GROUP BY c.author_email
      ORDER BY lines DESC
    `)
    .all({ exact: normalized, pattern }) as ContributorRow[];

  const totalLines = rows.reduce((s, r) => s + (r.lines ?? 0), 0);
  const totalCommits = rows.reduce((s, r) => s + r.commits, 0);

  const contributors: ContributorShare[] = rows.map((r) => ({
    authorName: r.author_name,
    authorEmail: r.author_email,
    commits: r.commits,
    linesChanged: r.lines ?? 0,
    sharePercent: totalLines > 0 ? ((r.lines ?? 0) / totalLines) * 100 : 0,
    lastCommit: new Date(r.last_commit),
  }));

  let cumulative = 0;
  let busFactor = contributors.length;
  for (let i = 0; i < contributors.length; i++) {
    cumulative += contributors[i]!.sharePercent;
    if (cumulative > 50) {
      busFactor = i + 1;
      break;
    }
  }

  const soleOwner =
    contributors.length === 1
      ? contributors[0]!
      : contributors.length > 0 && (contributors[0]!.sharePercent ?? 0) >= 80
        ? contributors[0]!
        : null;

  return {
    path: normalized,
    totalCommits,
    totalLinesChanged: totalLines,
    busFactor,
    contributors,
    soleOwner,
  };
}
