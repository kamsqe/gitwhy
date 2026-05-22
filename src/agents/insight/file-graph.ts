import type { Database as DatabaseType } from 'better-sqlite3';
import type { AliasResolver } from '../../config/aliases.js';
import { calculateBusFactor } from './bus-factor.js';

export interface GraphNode {
  /** File path — also the node id. */
  readonly path: string;
  /** Total commits touching this file (recent enough to be in scope). */
  readonly commits: number;
  /** Bus factor — 1 = single point of failure. null when no contributors. */
  readonly busFactor: number | null;
}

export interface GraphEdge {
  readonly source: string;
  readonly target: string;
  /** How many commits touched BOTH source and target. */
  readonly weight: number;
}

export interface FileGraphResult {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
  readonly truncated: boolean;
  readonly totalCandidates: number;
}

export interface FileGraphOptions {
  /** Max nodes to return, ranked by total commits descending. Default 50. */
  readonly maxNodes?: number;
  /** Minimum co-commit count to surface an edge. Default 3. */
  readonly minCoCommits?: number;
}

const DEFAULT_MAX_NODES = 50;
const DEFAULT_MIN_CO = 3;

/**
 * Build a file co-change graph for visualization.
 *
 * Why this isn't just a SELECT: force-directed layouts visually break above
 * ~500 nodes — every dot collides with every other and the graph becomes a
 * hairball. We cap aggressively (default 50 nodes) by total commit count to
 * keep the visualization legible.
 *
 * .gitwhyignore'd files are already excluded thanks to D.2's
 * `commit_files.excluded` column — without that, lockfiles dominate the
 * top-N selection because they co-change with everything.
 *
 * Bus factor is per-node — colorizes the visualization by "how many humans
 * could keep this file alive if one left". Single-point-of-failure files
 * stand out as red dots clustered with the things they pull along.
 */
export function buildFileGraph(
  db: DatabaseType,
  options: FileGraphOptions = {},
  aliases?: AliasResolver,
): FileGraphResult {
  const maxNodes = options.maxNodes ?? DEFAULT_MAX_NODES;
  const minCo = options.minCoCommits ?? DEFAULT_MIN_CO;

  // Top N paths by activity. Filter excludes lockfiles/dist (D.2) AND
  // bot/merge/formatting commits (they don't reflect ownership).
  const pathRows = db
    .prepare(`
      SELECT cf.path, COUNT(DISTINCT cf.commit_hash) AS commits
      FROM commit_files cf
      INNER JOIN commits c ON c.hash = cf.commit_hash
      WHERE cf.excluded = 0
        AND cf.is_binary = 0
        AND c.category NOT IN ('merge', 'bot', 'formatting')
      GROUP BY cf.path
      ORDER BY commits DESC
      LIMIT @lim
    `)
    .all({ lim: maxNodes }) as Array<{ path: string; commits: number }>;

  if (pathRows.length === 0) {
    return { nodes: [], edges: [], truncated: false, totalCandidates: 0 };
  }

  // Total candidates (for "X of Y" reporting in the UI).
  const totalCandidates = (
    db
      .prepare(`
        SELECT COUNT(DISTINCT path) AS c FROM commit_files
        WHERE excluded = 0 AND is_binary = 0
      `)
      .get() as { c: number }
  ).c;

  // Bus factor per node. Slowest step — one bus-factor query per node.
  // Bounded by maxNodes (default 50) so totally fine.
  const nodes: GraphNode[] = pathRows.map((r) => {
    const bf = calculateBusFactor(db, r.path, aliases);
    return {
      path: r.path,
      commits: r.commits,
      busFactor: bf.totalCommits > 0 ? bf.busFactor : null,
    };
  });

  // Edges: pairwise co-changes among the chosen nodes. Single SQL query
  // limited to the selected paths — both sides are constrained, so the
  // join is bounded.
  const paths = nodes.map((n) => n.path);
  const placeholders = paths.map(() => '?').join(',');
  const edgeRows = db
    .prepare(`
      SELECT cf1.path AS source, cf2.path AS target,
             COUNT(DISTINCT cf1.commit_hash) AS weight
      FROM commit_files cf1
      INNER JOIN commit_files cf2
        ON cf2.commit_hash = cf1.commit_hash
       AND cf2.path > cf1.path
      INNER JOIN commits c ON c.hash = cf1.commit_hash
      WHERE cf1.path IN (${placeholders})
        AND cf2.path IN (${placeholders})
        AND cf1.excluded = 0
        AND cf2.excluded = 0
        AND c.category NOT IN ('merge', 'bot', 'formatting')
      GROUP BY cf1.path, cf2.path
      HAVING weight >= ?
      ORDER BY weight DESC
    `)
    // SQL placeholders need each value passed twice (one per IN clause)
    // plus the minCo at the end.
    .all(...paths, ...paths, minCo) as Array<{
    source: string;
    target: string;
    weight: number;
  }>;

  return {
    nodes,
    edges: edgeRows,
    truncated: totalCandidates > maxNodes,
    totalCandidates,
  };
}
