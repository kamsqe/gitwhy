import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Built-in default patterns that get filtered out of aggregation queries
 * (bus factor, co-change matrix, hotspot ranking).
 *
 * The rule of thumb: include a pattern here only if changes to it tell us
 * nothing about the human authorship of the codebase. Lockfiles co-change
 * with everything (so they distort co-change). Generated files have only
 * the build's identity (so they distort bus factor).
 *
 * Users can extend this with their own .gitwhyignore (gitignore-style
 * syntax) at the repo root. Removing a default pattern is currently not
 * supported — file an issue if you need it.
 */
export const DEFAULT_IGNORE_PATTERNS: readonly string[] = [
  // Lockfiles — change every dependency bump, co-change with everything
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock',
  '**/bun.lockb',
  '**/Cargo.lock',
  '**/Gemfile.lock',
  '**/composer.lock',
  '**/poetry.lock',
  '**/Pipfile.lock',
  '**/uv.lock',
  '**/go.sum',
  // Generated bundles (when committed accidentally or intentionally)
  'dist/**',
  'build/**',
  'out/**',
  '.next/**',
  '.nuxt/**',
  '.output/**',
  // Vendored dependencies committed to repo
  'node_modules/**',
  'vendor/**',
  // Minified output
  '**/*.min.js',
  '**/*.min.css',
  // Source maps
  '**/*.js.map',
  '**/*.css.map',
  // Compiled artifacts
  '**/*.pyc',
  '**/*.class',
  '**/*.o',
];

/** Compiled matcher — call `isExcluded(path)` per file. */
export interface IgnoreMatcher {
  isExcluded(path: string): boolean;
  /** Patterns that contributed to the decision-tree, for debugging/transparency. */
  readonly patterns: readonly string[];
}

/**
 * Load user patterns from `.gitwhyignore` at `cwd`, combined with the
 * built-in defaults. Missing file is fine — defaults still apply.
 *
 * Pattern syntax is gitignore-style, but simplified — we don't implement
 * the full gitignore spec, just the parts that matter for filename
 * filtering:
 *   - Lines starting with `#` are comments
 *   - Empty lines ignored
 *   - `*` matches anything except `/`
 *   - `**` matches anything including `/`
 *   - Trailing `/` means directory (treated as `dir/**`)
 *   - Leading `/` anchors to repo root
 *   - `!` prefix to negate is NOT supported (keeps semantics simple)
 */
export function loadIgnoreMatcher(cwd: string): IgnoreMatcher {
  const userPatterns: string[] = [];
  const userPath = join(cwd, '.gitwhyignore');
  if (existsSync(userPath)) {
    const content = readFileSync(userPath, 'utf-8');
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (line === '' || line.startsWith('#')) continue;
      userPatterns.push(line);
    }
  }
  return createMatcher([...DEFAULT_IGNORE_PATTERNS, ...userPatterns]);
}

/**
 * Build a matcher from an explicit pattern list, no filesystem access.
 * Used by tests and by code paths that already know the patterns.
 */
export function createMatcher(patterns: readonly string[]): IgnoreMatcher {
  const regexes = patterns.map(patternToRegex);
  return {
    patterns: patterns.slice(),
    isExcluded(path) {
      const normalized = path.replace(/\\/g, '/');
      for (const re of regexes) {
        if (re.test(normalized)) return true;
      }
      return false;
    },
  };
}

/**
 * Convert a gitignore-style pattern to a regex anchored against a relative
 * path. We only implement the parts of the spec we actually need — see
 * loadIgnoreMatcher's JSDoc for the supported subset.
 */
function patternToRegex(pattern: string): RegExp {
  let p = pattern;
  // Trailing slash → match directory (and everything inside).
  if (p.endsWith('/')) p = `${p}**`;
  // Leading slash anchors to root; without it, match anywhere.
  const anchorRoot = p.startsWith('/');
  if (anchorRoot) p = p.slice(1);

  // Escape regex specials, then replace ** and * (in that order) with
  // their wildcard equivalents.
  let regexStr = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    const next = p[i + 1];
    if (c === '*' && next === '*') {
      regexStr += '.*';
      i += 2;
      // Eat a following slash so `**/foo` matches both root and nested.
      if (p[i] === '/') i++;
      continue;
    }
    if (c === '*') {
      regexStr += '[^/]*';
      i += 1;
      continue;
    }
    if (c === '?') {
      regexStr += '[^/]';
      i += 1;
      continue;
    }
    if (/[.+^${}()|[\]\\]/.test(c ?? '')) {
      regexStr += `\\${c}`;
      i += 1;
      continue;
    }
    regexStr += c;
    i += 1;
  }

  // Anchor: root-anchored patterns must match from the start. Others can
  // match at any path depth — prefix with `(^|.*/)`.
  const prefix = anchorRoot ? '^' : '(?:^|.*/)';
  return new RegExp(`${prefix}${regexStr}$`);
}
