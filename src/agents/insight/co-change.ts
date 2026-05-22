import type { Database as DatabaseType } from 'better-sqlite3';

export interface CoChangeOptions {
  /** Max files to return. Default 10. */
  readonly limit?: number;
  /** Minimum co-occurrence count to qualify. Default 2. */
  readonly minCoCommits?: number;
}

export interface RelatedFile {
  readonly path: string;
  readonly coCommits: number;
  readonly thisFileCommits: number;
  readonly otherFileCommits: number;
  /** Probability that other_file changes when this_file changes. */
  readonly forwardConfidence: number;
  /** Symmetric correlation: |co| / sqrt(|this| * |other|). */
  readonly jaccardLike: number;
}

interface CoChangeRow {
  other_path: string;
  co_commits: number;
  other_total: number;
}

interface BaseCountRow {
  c: number;
}

const DEFAULT_LIMIT = 10;
const DEFAULT_MIN_CO = 2;

/**
 * Find files that historically change together with `path`. Useful for
 * surfacing the "files you'll probably also need to touch" question
 * before someone edits a file.
 *
 * Uses commit-level co-occurrence over commits that aren't merges, bots,
 * or formatting-only changes.
 */
export function findRelatedFiles(
  db: DatabaseType,
  path: string,
  options: CoChangeOptions = {},
): RelatedFile[] {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const minCo = options.minCoCommits ?? DEFAULT_MIN_CO;
  const normalized = path.replace(/\\/g, '/');

  const baseRow = db
    .prepare(`
      SELECT COUNT(DISTINCT cf.commit_hash) AS c
      FROM commit_files cf
      INNER JOIN commits c ON c.hash = cf.commit_hash
      WHERE cf.path = @path
        AND c.category NOT IN ('merge', 'bot', 'formatting')
    `)
    .get({ path: normalized }) as BaseCountRow;

  if (baseRow.c === 0) return [];

  // Filter out excluded files (lockfiles, dist/, etc.) from the co-change
  // result set — they co-change with everything by design and would dominate
  // the rankings. The input path is still queried as-is (so `gitwhy related
  // pnpm-lock.yaml` works if you really want it), only the OTHER side of the
  // join is filtered.
  const rows = db
    .prepare(`
      SELECT cf2.path AS other_path,
             COUNT(DISTINCT cf1.commit_hash) AS co_commits,
             (
               SELECT COUNT(DISTINCT cf3.commit_hash)
               FROM commit_files cf3
               INNER JOIN commits c3 ON c3.hash = cf3.commit_hash
               WHERE cf3.path = cf2.path
                 AND c3.category NOT IN ('merge', 'bot', 'formatting')
             ) AS other_total
      FROM commit_files cf1
      INNER JOIN commit_files cf2 ON cf2.commit_hash = cf1.commit_hash AND cf2.path != cf1.path
      INNER JOIN commits c ON c.hash = cf1.commit_hash
      WHERE cf1.path = @path
        AND cf2.excluded = 0
        AND c.category NOT IN ('merge', 'bot', 'formatting')
      GROUP BY cf2.path
      HAVING co_commits >= @min_co
      ORDER BY co_commits DESC
      LIMIT @lim
    `)
    .all({ path: normalized, min_co: minCo, lim: limit }) as CoChangeRow[];

  return rows.map((r) => ({
    path: r.other_path,
    coCommits: r.co_commits,
    thisFileCommits: baseRow.c,
    otherFileCommits: r.other_total,
    forwardConfidence: r.co_commits / baseRow.c,
    jaccardLike:
      r.other_total > 0 ? r.co_commits / Math.sqrt(baseRow.c * r.other_total) : 0,
  }));
}
