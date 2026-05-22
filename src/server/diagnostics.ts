import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import type { Database as DatabaseType } from 'better-sqlite3';
import { resolvePaths } from '../config/loader.js';
import { openDatabase } from '../storage/sqlite.js';
import type { AppContext } from './app.js';

export type DiagnosticStatus = 'ok' | 'warn' | 'fail' | 'info';

export interface Diagnostic {
  /** Stable id — useful for skip-lists in client code. */
  id: string;
  label: string;
  status: DiagnosticStatus;
  detail: string;
  /** Actionable next step when status is warn/fail. */
  hint?: string;
}

export interface DiagnosticsResult {
  /** True when no check is `fail`. Warns are still "okay overall". */
  ok: boolean;
  checks: Diagnostic[];
}

/**
 * Run a battery of cheap health checks against the local gitwhy setup.
 * Surfaces the kind of issues users currently discover only by reading
 * error messages — env var typos, missing index, schema drift, etc.
 *
 * Each check is independent: one failing doesn't skip the others, so the
 * UI can render a triage list. No LLM calls — these run instantly even
 * when the provider is down.
 */
export function runDiagnostics(ctx: AppContext): DiagnosticsResult {
  const checks: Diagnostic[] = [];
  checks.push(checkProviderKeys(ctx));
  checks.push(checkProviderConfig(ctx));
  checks.push(checkGitRepo(ctx));
  const dbCheck = checkDatabase(ctx);
  checks.push(...dbCheck);
  return {
    ok: checks.every((c) => c.status !== 'fail'),
    checks,
  };
}

function checkProviderKeys(ctx: AppContext): Diagnostic {
  // Look at env vars only — never print values. Detect at least one of
  // the expected keys per provider, since gitwhy's env resolver is
  // case-insensitive.
  const env = (name: string): boolean =>
    process.env[name] !== undefined || process.env[name.toLowerCase()] !== undefined;
  const hasOpenAi = env('OPENAI_API_KEY');
  const hasGemini = env('GEMINI_API_KEY') || env('GOOGLE_API_KEY');

  const found: string[] = [];
  if (hasOpenAi) found.push('OpenAI');
  if (hasGemini) found.push('Gemini');

  if (found.length === 0) {
    return {
      id: 'provider_keys',
      label: 'LLM provider keys',
      status: 'warn',
      detail: 'No API keys detected in environment.',
      hint: 'Set GEMINI_API_KEY or OPENAI_API_KEY (in .env or shell) before running enrichment commands. Indexing/queries with a real model will fail until one is present.',
    };
  }

  return {
    id: 'provider_keys',
    label: 'LLM provider keys',
    status: 'ok',
    detail: `Detected: ${found.join(', ')}.`,
  };
}

function checkProviderConfig(ctx: AppContext): Diagnostic {
  const provider = ctx.config.provider;
  return {
    id: 'provider_config',
    label: 'Configured provider',
    status: 'info',
    detail: `${provider.llm} · indexing=${provider.indexingModel} · query=${provider.queryModel} · embedding=${provider.embeddingModel}`,
  };
}

function checkGitRepo(ctx: AppContext): Diagnostic {
  // Read-only git probes. Use try/catch around each because not every
  // user's PATH is sane and a shallow clone can confuse `git status`.
  try {
    const isRepo = execSync('git rev-parse --is-inside-work-tree', {
      cwd: ctx.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (isRepo !== 'true') {
      return {
        id: 'git_repo',
        label: 'Git repository',
        status: 'fail',
        detail: 'Not inside a git working tree.',
        hint: 'gitwhy expects to run from inside a `git init`-ed directory.',
      };
    }
  } catch {
    return {
      id: 'git_repo',
      label: 'Git repository',
      status: 'fail',
      detail: 'git command not available or not a repo.',
      hint: 'Verify `git --version` works in this shell and the cwd contains a .git directory.',
    };
  }

  let branch = 'unknown';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: ctx.cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
  } catch {
    // Empty repo — branch unknown, surface as warn rather than fail.
    return {
      id: 'git_repo',
      label: 'Git repository',
      status: 'warn',
      detail: 'Repo exists but has no commits yet.',
      hint: 'Make at least one commit before running `gitwhy index`.',
    };
  }

  let shallow = false;
  try {
    shallow =
      execSync('git rev-parse --is-shallow-repository', {
        cwd: ctx.cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim() === 'true';
  } catch {
    /* not all git versions support this; ignore */
  }

  if (shallow) {
    return {
      id: 'git_repo',
      label: 'Git repository',
      status: 'warn',
      detail: `On branch ${branch}, but the clone is shallow.`,
      hint: 'Shallow clones miss older history. Run `git fetch --unshallow` for full coverage.',
    };
  }

  return {
    id: 'git_repo',
    label: 'Git repository',
    status: 'ok',
    detail: `On branch ${branch}.`,
  };
}

function checkDatabase(ctx: AppContext): Diagnostic[] {
  const paths = resolvePaths(ctx.cwd);
  if (!existsSync(paths.commitsDb)) {
    return [
      {
        id: 'db_integrity',
        label: 'Index database',
        status: 'warn',
        detail: 'No index database found.',
        hint: 'Run `gitwhy init` then `gitwhy index` — or use the Index tab. Read-only features will be unavailable until this exists.',
      },
    ];
  }

  // Open in a separate handle so we don't poison the live one if the file
  // is somehow locked. better-sqlite3 opens in WAL by default, which is
  // multi-reader-safe.
  let db: DatabaseType;
  try {
    db = openDatabase({ path: paths.commitsDb });
  } catch (err) {
    return [
      {
        id: 'db_integrity',
        label: 'Index database',
        status: 'fail',
        detail: `Could not open: ${err instanceof Error ? err.message : String(err)}`,
        hint: 'The file may be corrupted or a stale lock is held. Stop other gitwhy processes and try again.',
      },
    ];
  }

  const out: Diagnostic[] = [];
  try {
    // SQLite integrity check — fast on small DBs, can take seconds on large
    // ones. Returns 'ok' string when fine, else a list of corruptions.
    const integrity = db
      .prepare(`PRAGMA integrity_check`)
      .all() as Array<{ integrity_check: string }>;
    const allOk =
      integrity.length === 1 && integrity[0]?.integrity_check === 'ok';
    out.push({
      id: 'db_integrity',
      label: 'Index database integrity',
      status: allOk ? 'ok' : 'fail',
      detail: allOk
        ? 'PRAGMA integrity_check passed.'
        : `Integrity issues: ${integrity.map((r) => r.integrity_check).join('; ')}`,
      ...(allOk ? {} : { hint: 'Rebuild the index: delete .gitwhy/index/commits.sqlite and rerun `gitwhy index --full`.' }),
    });

    // Schema version — info only.
    const versionRow = db
      .prepare(`SELECT value FROM schema_meta WHERE key = 'schema_version'`)
      .get() as { value: string } | undefined;
    if (versionRow) {
      out.push({
        id: 'schema_version',
        label: 'Index schema version',
        status: 'info',
        detail: `v${versionRow.value}`,
      });
    }

    // Embedding coverage — how many enriched commits actually have an
    // embedding row. Low coverage = semantic search will be incomplete.
    const enriched = (
      db
        .prepare(`SELECT COUNT(*) AS c FROM commits WHERE enriched_summary IS NOT NULL`)
        .get() as { c: number }
    ).c;
    const embedded = (
      db.prepare(`SELECT COUNT(*) AS c FROM commit_embeddings`).get() as { c: number }
    ).c;
    if (enriched > 0) {
      const pct = Math.round((embedded / enriched) * 100);
      if (pct >= 95) {
        out.push({
          id: 'embedding_coverage',
          label: 'Embedding coverage',
          status: 'ok',
          detail: `${embedded.toLocaleString()} / ${enriched.toLocaleString()} enriched commits embedded (${pct}%).`,
        });
      } else if (pct >= 50) {
        out.push({
          id: 'embedding_coverage',
          label: 'Embedding coverage',
          status: 'warn',
          detail: `${embedded.toLocaleString()} / ${enriched.toLocaleString()} enriched commits embedded (${pct}%).`,
          hint: 'Some commits are enriched but missing embeddings — Ask/Search results will be incomplete. Rerun `gitwhy index` (incremental).',
        });
      } else {
        out.push({
          id: 'embedding_coverage',
          label: 'Embedding coverage',
          status: 'fail',
          detail: `${embedded.toLocaleString()} / ${enriched.toLocaleString()} enriched commits embedded (${pct}%).`,
          hint: 'Most enriched commits have no embeddings. Run `gitwhy index --full` to repair, or check that your embedding provider is reachable.',
        });
      }
    }
  } finally {
    db.close();
  }

  return out;
}
