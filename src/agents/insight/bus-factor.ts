import type { Database as DatabaseType } from 'better-sqlite3';
import type { AliasResolver } from '../../config/aliases.js';

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
export function calculateBusFactor(
  db: DatabaseType,
  path: string,
  aliases?: AliasResolver,
): BusFactorResult {
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

  // Merge aliased emails BEFORE share-percent computation. Otherwise the same
  // human with two emails gets two slices of the pie and bus factor lies.
  // Without an alias resolver we use the identity mapping.
  const merged = aliases?.hasAliases === true ? mergeByCanonical(rows, aliases) : rows;

  const totalLines = merged.reduce((s, r) => s + (r.lines ?? 0), 0);
  const totalCommits = merged.reduce((s, r) => s + r.commits, 0);

  const contributors: ContributorShare[] = merged.map((r) => ({
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

/**
 * Group raw per-email rows by canonical email. Sums commits/lines and picks
 * the most-recent last_commit. The author_name shown is the one associated
 * with the canonical email's most-active row (typically the user's current
 * display name rather than an old one).
 */
function mergeByCanonical(
  rows: ReadonlyArray<ContributorRow>,
  aliases: AliasResolver,
): ContributorRow[] {
  const buckets = new Map<string, ContributorRow & { topLines: number }>();
  for (const r of rows) {
    const canonical = aliases.resolve(r.author_email);
    const existing = buckets.get(canonical);
    if (existing === undefined) {
      buckets.set(canonical, {
        author_name: r.author_name,
        author_email: canonical,
        commits: r.commits,
        lines: r.lines ?? 0,
        last_commit: r.last_commit,
        topLines: r.lines ?? 0,
      });
    } else {
      existing.commits += r.commits;
      existing.lines = (existing.lines ?? 0) + (r.lines ?? 0);
      if (r.last_commit > existing.last_commit) {
        existing.last_commit = r.last_commit;
      }
      // Pick the name from whichever alias contributed the most lines.
      if ((r.lines ?? 0) > existing.topLines) {
        existing.author_name = r.author_name;
        existing.topLines = r.lines ?? 0;
      }
    }
  }
  // Drop the helper field and re-sort by lines descending (matches SQL order).
  return Array.from(buckets.values())
    .map(({ topLines: _, ...rest }) => rest)
    .sort((a, b) => (b.lines ?? 0) - (a.lines ?? 0));
}
