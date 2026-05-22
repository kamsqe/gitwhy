import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '../utils/logger.js';

/**
 * Author aliases — merges multiple email addresses belonging to the same
 * human into a single canonical identity. Without this, the same person
 * shows up as several contributors and bus factor lies.
 *
 * File location: `.gitwhy/aliases.json`
 *
 * Format:
 * {
 *   "version": 1,
 *   "aliases": {
 *     "alice@example.com": [
 *       "alice@oldcompany.com",
 *       "12345+alice@users.noreply.github.com"
 *     ]
 *   }
 * }
 *
 * Semantics:
 * - Keys are canonical emails (the one we want to display).
 * - Values are arrays of aliases that resolve to the canonical email.
 * - An email not listed anywhere resolves to itself.
 * - Case-insensitive on the email comparison (GitHub noreply emails are
 *   sometimes mixed-case).
 */

const ALIASES_FILE = 'aliases.json';

interface AliasesFile {
  version: number;
  aliases: Record<string, string[]>;
}

export interface AliasResolver {
  /** Returns the canonical email for `email`, or `email` itself if no alias maps to it. */
  resolve(email: string): string;
  /** Returns true when at least one alias is configured. */
  readonly hasAliases: boolean;
}

const IDENTITY_RESOLVER: AliasResolver = {
  resolve: (email) => email,
  hasAliases: false,
};

/**
 * Load aliases from `.gitwhy/aliases.json`. Returns the identity resolver
 * when the file doesn't exist or is malformed (with a warning logged so
 * users notice when they typo something).
 */
export function loadAliases(cwd: string): AliasResolver {
  const path = join(cwd, '.gitwhy', ALIASES_FILE);
  if (!existsSync(path)) return IDENTITY_RESOLVER;

  let parsed: AliasesFile;
  try {
    const content = readFileSync(path, 'utf-8');
    parsed = JSON.parse(content) as AliasesFile;
  } catch (err) {
    logger.warn(
      `Could not parse ${path}: ${err instanceof Error ? err.message : String(err)} — proceeding without aliases.`,
    );
    return IDENTITY_RESOLVER;
  }

  if (!parsed.aliases || typeof parsed.aliases !== 'object') {
    return IDENTITY_RESOLVER;
  }

  return createResolver(parsed.aliases);
}

/**
 * Build a resolver from a raw aliases object. Exported for tests + for code
 * paths that have the data in-memory already (e.g. constructed from a
 * suggestions UI rather than loaded from disk).
 */
export function createResolver(aliases: Record<string, string[]>): AliasResolver {
  // Flatten: { canonical: [a1, a2] } → { a1: canonical, a2: canonical, canonical: canonical }.
  // Use lowercased keys so lookup is case-insensitive (matches GitHub's behavior).
  const lookup = new Map<string, string>();
  let count = 0;
  for (const [canonical, aliasList] of Object.entries(aliases)) {
    const canonicalLower = canonical.toLowerCase();
    lookup.set(canonicalLower, canonical);
    for (const alias of aliasList) {
      lookup.set(alias.toLowerCase(), canonical);
      count++;
    }
  }
  return {
    resolve: (email) => lookup.get(email.toLowerCase()) ?? email,
    hasAliases: count > 0,
  };
}

/**
 * Suggest aliases by clustering authors whose name matches but whose
 * emails differ. Returns groups for the user to review — never merges
 * automatically because two humans really can share a name.
 *
 * Group key: lower-cased trimmed name. Skipped: groups where every email
 * is identical (already a single person) and groups of size 1.
 */
export interface AliasSuggestion {
  name: string;
  emails: ReadonlyArray<{ email: string; commits: number }>;
}

export function suggestAliases(
  contributors: ReadonlyArray<{ name: string; email: string; commits: number }>,
): AliasSuggestion[] {
  const byName = new Map<string, Map<string, number>>();
  for (const c of contributors) {
    const key = c.name.trim().toLowerCase();
    if (!key) continue;
    let bucket = byName.get(key);
    if (!bucket) {
      bucket = new Map();
      byName.set(key, bucket);
    }
    bucket.set(c.email, (bucket.get(c.email) ?? 0) + c.commits);
  }
  const out: AliasSuggestion[] = [];
  for (const [, bucket] of byName) {
    if (bucket.size < 2) continue;
    const emails = Array.from(bucket.entries())
      .map(([email, commits]) => ({ email, commits }))
      .sort((a, b) => b.commits - a.commits);
    const firstEmail = emails[0]?.email;
    if (firstEmail === undefined) continue;
    // Use the email from the most-active variant as the suggested canonical.
    const sample = contributors.find((c) => c.email === firstEmail);
    if (!sample) continue;
    out.push({ name: sample.name, emails });
  }
  // Order suggestions by total commit count so the most-impactful merges are first.
  out.sort((a, b) => {
    const aCommits = a.emails.reduce((s, e) => s + e.commits, 0);
    const bCommits = b.emails.reduce((s, e) => s + e.commits, 0);
    return bCommits - aCommits;
  });
  return out;
}
