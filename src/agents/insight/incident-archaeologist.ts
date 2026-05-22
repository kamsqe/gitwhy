import type { Database as DatabaseType } from 'better-sqlite3';
import type { AliasResolver } from '../../config/aliases.js';
import { calculateBusFactor } from './bus-factor.js';

export interface IncidentWindowOptions {
  /** Unix milliseconds for when the incident started. */
  readonly atMs: number;
  /** Window length BEFORE atMs, in milliseconds. Default: 4 hours. */
  readonly windowMs?: number;
  /**
   * Also surface commits in `[atMs, atMs + afterMs]` as potential hot-fixes
   * that may have already addressed the issue. Default: 1 hour.
   */
  readonly afterMs?: number;
  /**
   * Cap the number of commits per bucket (before + after) to avoid blowing
   * up on hyperactive repos. Default: 50.
   */
  readonly limitPerBucket?: number;
}

export interface IncidentSuspect {
  readonly commitHash: string;
  readonly shortHash: string;
  readonly date: Date;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly originalMessage: string;
  readonly enrichedSummary: string | null;
  readonly category: string;
  readonly filesChanged: number;
  readonly excludedFilesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
  /** Max bus-factor risk across the (non-excluded) files this commit touched. */
  readonly maxBusFactor: number | null;
  /**
   * Heuristic risk score for this commit relative to others in the window.
   * Combines line churn, bus factor exposure, and category penalty
   * (mega = +0.2, revert = +0.15). Bounded to [0, 1] but values above 0.6
   * are pretty rare on small-window queries.
   */
  readonly suspicionScore: number;
}

export interface IncidentWindowResult {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly hotfixWindowEndMs: number;
  /** Commits in [windowStart, atMs] — the candidates that may have caused the incident. */
  readonly suspects: readonly IncidentSuspect[];
  /** Commits in [atMs, hotfixWindowEnd] — potential mitigations or follow-up fixes. */
  readonly hotfixes: readonly IncidentSuspect[];
}

const DEFAULT_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const DEFAULT_AFTER_MS = 60 * 60 * 1000; // 1 hour
const DEFAULT_LIMIT = 50;

interface CommitRow {
  hash: string;
  short_hash: string;
  committed_at: number;
  author_name: string;
  author_email: string;
  message: string;
  enriched_summary: string | null;
  category: string;
  insertions: number;
  deletions: number;
}

/**
 * "What landed in the window when this thing broke?"
 *
 * Pure SQL + the existing bus-factor query — no LLM call, runs instantly.
 * Surfaces commits in two buckets:
 *   - Suspects: commits that landed BEFORE the incident timestamp, within
 *     a configurable window (default 4h before). These are the candidates
 *     for "what caused this".
 *   - Hot-fixes: commits that landed AFTER the incident timestamp (default
 *     1h after). These are potential mitigations the team already shipped.
 *
 * Ranking: per-commit suspicionScore that combines:
 *   - line churn (more lines = more risk surface)
 *   - max bus-factor exposure (touched a single-point-of-failure file)
 *   - category penalty (mega +0.20, revert +0.15)
 *
 * Important non-claims: we do NOT say "this commit caused the outage."
 * The tool surfaces facts and a ranking — causal attribution stays
 * with the human. The UI emphasizes that framing too.
 */
export function analyzeIncidentWindow(
  db: DatabaseType,
  options: IncidentWindowOptions,
  aliases?: AliasResolver,
): IncidentWindowResult {
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const afterMs = options.afterMs ?? DEFAULT_AFTER_MS;
  const limit = options.limitPerBucket ?? DEFAULT_LIMIT;

  const windowStartMs = options.atMs - windowMs;
  const windowEndMs = options.atMs;
  const hotfixWindowEndMs = options.atMs + afterMs;

  const suspectRows = fetchCommits(db, windowStartMs, windowEndMs, limit);
  const hotfixRows = fetchCommits(db, windowEndMs + 1, hotfixWindowEndMs, limit);

  const suspects = suspectRows.map((r) => scoreCommit(db, r, aliases));
  const hotfixes = hotfixRows.map((r) => scoreCommit(db, r, aliases));

  // Sort suspects by suspicion descending — the UI relies on this order.
  suspects.sort((a, b) => b.suspicionScore - a.suspicionScore);
  // Hotfixes by date ascending — chronological matches a "what did the team
  // do after the alert fired" narrative.
  hotfixes.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    windowStartMs,
    windowEndMs,
    hotfixWindowEndMs,
    suspects,
    hotfixes,
  };
}

function fetchCommits(
  db: DatabaseType,
  startMs: number,
  endMs: number,
  limit: number,
): CommitRow[] {
  return db
    .prepare(`
      SELECT hash, short_hash, committed_at, author_name, author_email, message,
             enriched_summary, category, insertions, deletions
      FROM commits
      WHERE committed_at >= @start
        AND committed_at <= @end
        AND category NOT IN ('merge', 'bot')
      ORDER BY committed_at DESC
      LIMIT @lim
    `)
    .all({ start: startMs, end: endMs, lim: limit }) as CommitRow[];
}

interface CommitFilesAggregate {
  files_changed: number;
  excluded_files_changed: number;
}

function scoreCommit(
  db: DatabaseType,
  row: CommitRow,
  aliases: AliasResolver | undefined,
): IncidentSuspect {
  // Per-commit file aggregate (count + how many were .gitwhyignore'd).
  const agg = db
    .prepare(`
      SELECT
        COUNT(*) AS files_changed,
        SUM(CASE WHEN excluded = 1 THEN 1 ELSE 0 END) AS excluded_files_changed
      FROM commit_files
      WHERE commit_hash = ?
    `)
    .get(row.hash) as CommitFilesAggregate;

  // Max bus factor across non-excluded files. Heavy-ish per file but bounded:
  // commits typically touch <20 files. We cap at 10 to keep it bounded for
  // pathological mega-commits.
  const paths = db
    .prepare(`
      SELECT path FROM commit_files
      WHERE commit_hash = ? AND excluded = 0
      LIMIT 10
    `)
    .all(row.hash) as Array<{ path: string }>;

  let maxBusFactorExposure = 0;
  for (const { path } of paths) {
    const bf = calculateBusFactor(db, path, aliases);
    // Expose more "risk" when bus factor is low (single point of failure).
    // bus factor 1 → exposure 1.0; 2 → 0.5; 3 → 0.33; ≥4 → 0.25.
    if (bf.busFactor > 0) {
      const exposure = 1 / bf.busFactor;
      if (exposure > maxBusFactorExposure) maxBusFactorExposure = exposure;
    }
  }

  const churn = row.insertions + row.deletions;
  // Normalize churn to roughly [0, 1] — 500 LOC change ≈ saturation.
  const churnScore = Math.min(1, churn / 500);
  const categoryPenalty = row.category === 'mega' ? 0.2 : row.category === 'revert' ? 0.15 : 0;

  const suspicionScore = Math.min(
    1,
    0.4 * churnScore + 0.4 * maxBusFactorExposure + categoryPenalty,
  );

  return {
    commitHash: row.hash,
    shortHash: row.short_hash,
    date: new Date(row.committed_at),
    authorName: row.author_name,
    authorEmail: row.author_email,
    originalMessage: row.message,
    enrichedSummary: row.enriched_summary,
    category: row.category,
    filesChanged: agg.files_changed,
    excludedFilesChanged: agg.excluded_files_changed ?? 0,
    linesAdded: row.insertions,
    linesRemoved: row.deletions,
    maxBusFactor: maxBusFactorExposure > 0 ? Math.round(1 / maxBusFactorExposure) : null,
    suspicionScore,
  };
}
