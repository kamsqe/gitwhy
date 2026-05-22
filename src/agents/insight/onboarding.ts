import type { Database as DatabaseType } from 'better-sqlite3';
import type { AliasResolver } from '../../config/aliases.js';

export interface OnboardingCommit {
  readonly commitHash: string;
  readonly shortHash: string;
  readonly date: Date;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly originalMessage: string;
  readonly enrichedSummary: string;
  readonly category: string;
  readonly filesChanged: number;
  readonly filesAdded: number;
  readonly score: number;
  /** Short human-readable explanation of why this commit was picked. */
  readonly reason: string;
}

export interface OnboardingOptions {
  /** Max commits to return. Default 10. */
  readonly limit?: number;
  /** Reject the top contributor's commits beyond this many in a row, to keep the list balanced. Default 3. */
  readonly maxConsecutiveFromSameAuthor?: number;
}

export interface OnboardingResult {
  readonly totalCommits: number;
  readonly candidatesConsidered: number;
  readonly recommendations: readonly OnboardingCommit[];
}

const DEFAULT_LIMIT = 10;
const DEFAULT_AUTHOR_RUN = 3;
const MIN_FILES = 2;
const MAX_FILES = 15;
const MIN_SUMMARY_CHARS = 50;
const SUBSTANTIVE_SUMMARY_CHARS = 100;
const SUBSTANTIVE_MESSAGE_CHARS = 30;

interface CandidateRow {
  hash: string;
  short_hash: string;
  committed_at: number;
  author_name: string;
  author_email: string;
  message: string;
  enriched_summary: string;
  category: string;
  files_changed: number;
  files_added: number;
}

/**
 * "10 commits a new dev should read."
 *
 * Why this isn't just "sort by impact": sorting by line-count returns the
 * mega-refactors, which are the LEAST useful commits for onboarding. A new
 * dev needs commits that explain WHY the codebase is the way it is, not
 * 5000-line "reformat everything" diffs.
 *
 * Selection criteria (filter):
 *   - category must be 'normal' (not mega/micro/bot/revert/merge/initial)
 *   - enriched_summary present and at least 50 chars
 *   - touches between 2 and 15 files (architectural meaning, not a typo fix,
 *     not a mega refactor)
 *   - no excluded files (lockfiles, dist/, etc.) — handled by joining
 *     against commit_files.excluded
 *
 * Scoring (rank within filter):
 *   + score grows with file count (up to MAX_FILES, capped)
 *   + bonus for substantive enriched summary (≥100 chars)
 *   + bonus for substantive commit message (≥30 chars — not just "fix")
 *   + bonus when the commit adds new files (introduces concepts)
 *
 * Diversification: after sorting by score, run a windowed filter that
 * prevents the same author from filling the entire list. If we hit 3
 * consecutive picks from one author, demote subsequent matches from them
 * to break the streak.
 */
export function selectOnboardingCommits(
  db: DatabaseType,
  options: OnboardingOptions = {},
  _aliases?: AliasResolver,
): OnboardingResult {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxRun = options.maxConsecutiveFromSameAuthor ?? DEFAULT_AUTHOR_RUN;

  const totalCommits = (
    db.prepare(`SELECT COUNT(*) AS c FROM commits`).get() as { c: number }
  ).c;

  // Pull every commit that passes the structural filter. The score column
  // is computed in SQL so we can ORDER BY it; we then re-evaluate with the
  // diversification pass in JS.
  const rows = db
    .prepare(`
      SELECT
        c.hash,
        c.short_hash,
        c.committed_at,
        c.author_name,
        c.author_email,
        c.message,
        c.enriched_summary,
        c.category,
        COUNT(DISTINCT cf.path) AS files_changed,
        SUM(CASE WHEN cf.status = 'added' THEN 1 ELSE 0 END) AS files_added
      FROM commits c
      INNER JOIN commit_files cf
        ON cf.commit_hash = c.hash
       AND cf.excluded = 0
      WHERE c.category = 'normal'
        AND c.enriched_summary IS NOT NULL
        AND LENGTH(c.enriched_summary) >= @min_summary_chars
      GROUP BY c.hash
      HAVING files_changed BETWEEN @min_files AND @max_files
      ORDER BY c.committed_at DESC
    `)
    .all({
      min_summary_chars: MIN_SUMMARY_CHARS,
      min_files: MIN_FILES,
      max_files: MAX_FILES,
    }) as CandidateRow[];

  const scored = rows.map((r) => ({
    row: r,
    ...scoreCommit(r),
  }));

  // Sort by score descending; ties broken by older first (more foundational).
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.row.committed_at - b.row.committed_at;
  });

  // Diversify: prevent runs from one author. We keep a sliding window of
  // the last `maxRun` picks; if we'd violate the rule, skip and try the
  // next candidate. This isn't optimal but it's deterministic and fast.
  const picks: typeof scored = [];
  for (const cand of scored) {
    if (picks.length >= limit) break;
    if (violatesAuthorRun(picks, cand.row.author_email, maxRun)) continue;
    picks.push(cand);
  }
  // If we got fewer than `limit` because of diversification, top up from
  // the original sorted list ignoring the constraint — better to have a
  // homogeneous list than a short one for single-author repos.
  if (picks.length < limit) {
    for (const cand of scored) {
      if (picks.length >= limit) break;
      if (picks.some((p) => p.row.hash === cand.row.hash)) continue;
      picks.push(cand);
    }
  }

  const recommendations: OnboardingCommit[] = picks.map(({ row, score, reason }) => ({
    commitHash: row.hash,
    shortHash: row.short_hash,
    date: new Date(row.committed_at),
    authorName: row.author_name,
    authorEmail: row.author_email,
    originalMessage: row.message,
    enrichedSummary: row.enriched_summary,
    category: row.category,
    filesChanged: row.files_changed,
    filesAdded: row.files_added ?? 0,
    score,
    reason,
  }));

  return {
    totalCommits,
    candidatesConsidered: scored.length,
    recommendations,
  };
}

function violatesAuthorRun(
  picks: ReadonlyArray<{ row: { author_email: string } }>,
  email: string,
  maxRun: number,
): boolean {
  const window = picks.slice(-maxRun);
  if (window.length < maxRun) return false;
  return window.every((p) => p.row.author_email === email);
}

function scoreCommit(row: CandidateRow): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];

  // File count: normalize so 5-10 files = sweet spot.
  const filesNorm = Math.min(1, row.files_changed / 10);
  score += 0.35 * filesNorm;

  // Substantive enriched summary (≥100 chars).
  if (row.enriched_summary.length >= SUBSTANTIVE_SUMMARY_CHARS) {
    score += 0.2;
    reasons.push('detailed AI summary');
  }

  // Substantive commit message — the author bothered to explain themselves.
  if (row.message.length >= SUBSTANTIVE_MESSAGE_CHARS) {
    score += 0.15;
    reasons.push('thoughtful commit message');
  }

  // Introduces new files (concept genesis).
  if ((row.files_added ?? 0) > 0) {
    score += 0.25 * Math.min(1, (row.files_added ?? 0) / 3);
    reasons.push(
      `introduces ${row.files_added} new file${(row.files_added ?? 0) === 1 ? '' : 's'}`,
    );
  }

  // Breadth of touches as a small additional weight — but capped, because
  // we already filtered out single-file fixes and mega-commits at the
  // SQL boundary.
  score += 0.05 * Math.min(1, row.files_changed / MAX_FILES);

  if (reasons.length === 0) reasons.push(`touches ${row.files_changed} files`);
  return { score: Math.min(1, score), reason: reasons.join(' · ') };
}
