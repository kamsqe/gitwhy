import type { Database } from 'sql.js';
import type {
  HistoryCommit,
  HistoryResponse,
  HealthResponse,
  RelatedResponse,
  RiskResponse,
  StatusResponse,
} from '../../app/lib/api';
import { queryAll } from './sqljs';

/**
 * Client-side implementation of the gitwhy HTTP API, backed by a sql.js
 * Database instance. Same response shapes as the real backend so the
 * existing tab components can render results without knowing whether
 * data came from a local SQLite file or a remote gitwhy server.
 *
 * What's implemented (pure SQL — no LLM):
 *   - health / status
 *   - risk + bus factor
 *   - related (co-change matrix)
 *   - history (file timeline)
 *   - paths (autocomplete)
 *
 * What's NOT implemented (needs an LLM or git access):
 *   - ask, search, estimate, index, suggest-commit, catchup
 * Playground tabs that need these surface a clear "requires local
 * install" message instead.
 */
export function createPlaygroundApi(db: Database, demoName: string): PlaygroundApi {
  return {
    health: () => buildHealth(db, demoName),
    status: () => buildStatus(db),
    risk: (input) => buildRisk(db, input.path),
    related: (input) => buildRelated(db, input.path, input.minCoCommits ?? 1, input.limit ?? 10),
    history: (input) => buildHistory(db, input.path, input.limit ?? 20),
    paths: (input) => buildPaths(db, input.q, input.limit ?? 20),
  };
}

export interface PlaygroundApi {
  health: () => HealthResponse;
  status: () => StatusResponse;
  risk: (input: { path: string }) => RiskResponse;
  related: (input: {
    path: string;
    limit?: number;
    minCoCommits?: number;
  }) => RelatedResponse;
  history: (input: { path: string; limit?: number }) => HistoryResponse;
  paths: (input: { q: string; limit?: number }) => { paths: string[] };
}

// ─── Health + Status ────────────────────────────────────────────────────

function buildHealth(_db: Database, demoName: string): HealthResponse {
  // No real provider/model — this is a static demo. Return values that make
  // the Header render sensibly without misleading the user.
  return {
    ok: true,
    version: 'playground',
    cwd: `${demoName} (read-only playground)`,
    initialized: true,
    provider: 'playground',
    models: {
      indexing: 'pre-indexed',
      query: 'n/a (playground)',
      embedding: 'pre-indexed',
    },
  };
}

interface CountsRow {
  indexed_commits: number;
  embeddings: number;
  llm_calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
  last_indexed: number | null;
  authors: number;
}

function buildStatus(db: Database): StatusResponse {
  const counts = queryAll<CountsRow>(
    db,
    `SELECT
       (SELECT COUNT(*) FROM commits) AS indexed_commits,
       (SELECT COUNT(*) FROM commit_embeddings) AS embeddings,
       (SELECT COUNT(*) FROM llm_calls) AS llm_calls,
       (SELECT COALESCE(SUM(prompt_tokens), 0) FROM llm_calls) AS prompt_tokens,
       (SELECT COALESCE(SUM(completion_tokens), 0) FROM llm_calls) AS completion_tokens,
       (SELECT COALESCE(SUM(cost_usd), 0) FROM llm_calls) AS cost,
       (SELECT MAX(indexed_at) FROM commits) AS last_indexed,
       (SELECT COUNT(DISTINCT author_email) FROM commits) AS authors`,
  )[0];

  // Use indexed_commits as both total and indexed since we don't have
  // a live git repo to compare against.
  const indexed = counts?.indexed_commits ?? 0;
  const hotspots = queryAll<{ path: string; recent_commits: number }>(
    db,
    `SELECT cf.path, COUNT(DISTINCT cf.commit_hash) AS recent_commits
     FROM commit_files cf
     INNER JOIN commits c ON c.hash = cf.commit_hash
     WHERE c.committed_at >= ?
       AND c.category NOT IN ('merge', 'bot', 'formatting')
       AND cf.is_binary = 0
     GROUP BY cf.path
     ORDER BY recent_commits DESC, cf.path
     LIMIT 5`,
    [Date.now() - 90 * 24 * 60 * 60 * 1000],
  );

  return {
    initialized: true,
    indexedCommits: indexed,
    gitTotalCommits: indexed, // playground has no live git
    indexCoverage: 1,
    embeddings: counts?.embeddings ?? 0,
    llmCalls: counts?.llm_calls ?? 0,
    promptTokens: counts?.prompt_tokens ?? 0,
    completionTokens: counts?.completion_tokens ?? 0,
    costUsd: counts?.cost ?? 0,
    lastIndexedAt: counts?.last_indexed ? new Date(counts.last_indexed).toISOString() : null,
    dbSizeBytes: 0, // sql.js doesn't expose this
    topHotspots: hotspots.map((h) => ({ path: h.path, recentCommits: h.recent_commits })),
    warnings: [],
  };
}

// ─── Risk + Bus Factor ──────────────────────────────────────────────────

interface ContribRow {
  author_name: string;
  author_email: string;
  commits: number;
  lines: number;
  last_commit: number;
}

function buildRisk(db: Database, path: string): RiskResponse {
  const normalized = path.replace(/\\/g, '/');
  const pattern = normalized.endsWith('/') ? `${normalized}%` : normalized;

  const rows = queryAll<ContribRow>(
    db,
    `SELECT
       c.author_name,
       c.author_email,
       COUNT(DISTINCT cf.commit_hash) AS commits,
       SUM(cf.insertions + cf.deletions) AS lines,
       MAX(c.committed_at) AS last_commit
     FROM commit_files cf
     INNER JOIN commits c ON c.hash = cf.commit_hash
     WHERE (cf.path = ? OR cf.path LIKE ?)
       AND c.category NOT IN ('merge', 'bot')
     GROUP BY c.author_email
     ORDER BY lines DESC`,
    [normalized, pattern],
  );

  const totalLines = rows.reduce((s, r) => s + (r.lines ?? 0), 0);
  const totalCommits = rows.reduce((s, r) => s + r.commits, 0);

  const contributors = rows.map((r) => ({
    authorName: r.author_name,
    authorEmail: r.author_email,
    commits: r.commits,
    linesChanged: r.lines ?? 0,
    sharePercent: totalLines > 0 ? ((r.lines ?? 0) / totalLines) * 100 : 0,
    lastCommit: new Date(r.last_commit ?? 0).toISOString(),
  }));

  // Bus factor: minimum N contributors whose combined share > 50%
  let cumulative = 0;
  let busFactor = contributors.length;
  for (let i = 0; i < contributors.length; i++) {
    cumulative += contributors[i]?.sharePercent ?? 0;
    if (cumulative > 50) {
      busFactor = i + 1;
      break;
    }
  }

  // Risk score — same weights as src/agents/insight/risk-score.ts:
  // 0.4 bus factor + 0.3 ghost code + 0.3 hotspot
  const top = contributors[0];
  const soleOwnerShare = top?.sharePercent ?? 0;
  const ownerInactiveDays = top
    ? Math.floor((Date.now() - new Date(top.lastCommit).getTime()) / (24 * 60 * 60 * 1000))
    : 0;
  const recentCommits90d = countRecentCommitsForPath(db, normalized, pattern, 90);

  const busRisk = busFactor <= 1 ? 1.0 : busFactor === 2 ? 0.5 : busFactor === 3 ? 0.2 : 0.1;
  // No ghost-code detection in the playground (it requires a more complex
  // cross-author / time analysis); approximate with the "inactive for 180+
  // days" signal alone.
  const ghostRisk = ownerInactiveDays > 365 ? 1.0 : ownerInactiveDays > 180 ? 0.5 : 0;
  const recencyComponent = Math.min(1, recentCommits90d / 20);
  const churnComponent = Math.min(1, totalCommits / 50);
  const hotspotRisk = recentCommits90d === 0 ? 0 : 0.6 * recencyComponent + 0.4 * churnComponent;
  const score = 0.4 * busRisk + 0.3 * ghostRisk + 0.3 * hotspotRisk;
  const level = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low';

  const reasons: string[] = [];
  if (busFactor === 1 && top) {
    reasons.push(`bus factor = 1 (${top.authorName} owns ${soleOwnerShare.toFixed(0)}% of the file)`);
  } else if (busFactor === 2) {
    reasons.push('bus factor = 2 (two-person dependency)');
  }
  if (ownerInactiveDays > 365) {
    reasons.push(`sole owner inactive for ${ownerInactiveDays} days (ghost code)`);
  } else if (ownerInactiveDays > 180) {
    reasons.push(`top contributor last touched this ${ownerInactiveDays} days ago`);
  }
  if (recentCommits90d >= 10) {
    reasons.push(`hotspot: ${recentCommits90d} commits in the last 90 days`);
  } else if (recentCommits90d >= 5) {
    reasons.push(`moderately active: ${recentCommits90d} recent commits`);
  }
  if (contributors.length === 1) {
    reasons.push('only one contributor in indexed history');
  }
  if (reasons.length === 0) {
    reasons.push('no significant risk indicators');
  }

  const text =
    totalCommits === 0
      ? `No indexed history for "${normalized}". The file may not exist in this demo's window.`
      : `Risk: ${level.toUpperCase()} (score ${score.toFixed(2)}) — ${normalized}`;

  return {
    text,
    data: {
      risk: {
        path: normalized,
        level,
        score,
        reasons,
        inputs: {
          busFactor,
          soleOwnerSharePercent: soleOwnerShare,
          ownerInactiveDays,
          recentCommits90d,
          totalCommits,
          contributorCount: contributors.length,
          isGhostCode: ownerInactiveDays > 365,
        },
      },
      busFactor: {
        path: normalized,
        totalCommits,
        totalLinesChanged: totalLines,
        busFactor,
        contributors,
        soleOwner:
          contributors.length === 1 || (contributors[0]?.sharePercent ?? 0) >= 80
            ? contributors[0] ?? null
            : null,
      },
    },
  };
}

function countRecentCommitsForPath(
  db: Database,
  exact: string,
  pattern: string,
  days: number,
): number {
  const row = queryAll<{ c: number }>(
    db,
    `SELECT COUNT(DISTINCT cf.commit_hash) AS c
     FROM commit_files cf
     INNER JOIN commits c ON c.hash = cf.commit_hash
     WHERE (cf.path = ? OR cf.path LIKE ?)
       AND c.committed_at >= ?
       AND c.category NOT IN ('merge', 'bot', 'formatting')`,
    [exact, pattern, Date.now() - days * 24 * 60 * 60 * 1000],
  )[0];
  return row?.c ?? 0;
}

// ─── Related (Co-change) ────────────────────────────────────────────────

interface CoChangeRow {
  other_path: string;
  co_commits: number;
  other_total: number;
}

function buildRelated(
  db: Database,
  path: string,
  minCoCommits: number,
  limit: number,
): RelatedResponse {
  const normalized = path.replace(/\\/g, '/');
  const baseRow = queryAll<{ c: number }>(
    db,
    `SELECT COUNT(DISTINCT cf.commit_hash) AS c
     FROM commit_files cf
     INNER JOIN commits c ON c.hash = cf.commit_hash
     WHERE cf.path = ?
       AND c.category NOT IN ('merge', 'bot', 'formatting')`,
    [normalized],
  )[0];
  const thisFileCommits = baseRow?.c ?? 0;
  if (thisFileCommits === 0) {
    return {
      text: `No co-changing files found for "${normalized}". Either the path has no indexed history, or no other files have co-changed at least ${minCoCommits} times.`,
      data: [],
    };
  }

  const rows = queryAll<CoChangeRow>(
    db,
    `SELECT cf2.path AS other_path,
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
     WHERE cf1.path = ?
       AND c.category NOT IN ('merge', 'bot', 'formatting')
     GROUP BY cf2.path
     HAVING co_commits >= ?
     ORDER BY co_commits DESC
     LIMIT ?`,
    [normalized, minCoCommits, limit],
  );

  const data = rows.map((r) => ({
    path: r.other_path,
    coCommits: r.co_commits,
    thisFileCommits,
    otherFileCommits: r.other_total,
    forwardConfidence: r.co_commits / thisFileCommits,
    jaccardLike:
      r.other_total > 0 ? r.co_commits / Math.sqrt(thisFileCommits * r.other_total) : 0,
  }));

  return {
    text:
      data.length === 0
        ? `No co-changing files found for "${normalized}".`
        : `Files that change with "${normalized}" (in ${thisFileCommits} commits of indexed history)`,
    data,
  };
}

// ─── History ────────────────────────────────────────────────────────────

interface HistoryRow {
  hash: string;
  short_hash: string;
  author_name: string;
  committed_at: number;
  message: string;
  category: string;
  enriched_summary: string | null;
}

function buildHistory(db: Database, path: string, limit: number): HistoryResponse {
  const normalized = path.replace(/\\/g, '/');
  const pattern = normalized.endsWith('/') ? `${normalized}%` : normalized;
  const rows = queryAll<HistoryRow>(
    db,
    `SELECT DISTINCT c.hash, c.short_hash, c.author_name, c.committed_at, c.message, c.category, c.enriched_summary
     FROM commits c
     INNER JOIN commit_files f ON f.commit_hash = c.hash
     WHERE f.path = ? OR f.path LIKE ?
     ORDER BY c.committed_at DESC
     LIMIT ?`,
    [normalized, pattern, limit],
  );

  if (rows.length === 0) {
    return {
      text: `No indexed commits found for path "${normalized}".`,
      data: [],
    };
  }

  const data: HistoryCommit[] = rows.map((r) => ({
    commitHash: r.hash,
    shortHash: r.short_hash,
    authorName: r.author_name,
    date: new Date(r.committed_at).toISOString(),
    category: r.category,
    originalMessage: r.message,
    enrichedSummary: r.enriched_summary,
  }));

  return {
    text: `History for "${normalized}" (${rows.length} commits, most recent first)`,
    data,
  };
}

// ─── Paths (autocomplete) ───────────────────────────────────────────────

function buildPaths(db: Database, q: string, limit: number): { paths: string[] } {
  const trimmed = q.trim();
  if (trimmed === '') {
    const rows = queryAll<{ path: string }>(
      db,
      `SELECT path FROM commit_files
       GROUP BY path
       ORDER BY MAX(rowid) DESC
       LIMIT ?`,
      [limit],
    );
    return { paths: rows.map((r) => r.path) };
  }
  const rows = queryAll<{ path: string }>(
    db,
    `SELECT DISTINCT path FROM commit_files
     WHERE path LIKE '%' || ? || '%'
     ORDER BY
       CASE WHEN path LIKE ? || '%' THEN 0 ELSE 1 END,
       path
     LIMIT ?`,
    [trimmed, trimmed, limit],
  );
  return { paths: rows.map((r) => r.path) };
}
