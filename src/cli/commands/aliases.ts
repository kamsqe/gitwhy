import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { suggestAliases } from '../../config/aliases.js';
import { resolvePaths } from '../../config/loader.js';
import { openDatabase } from '../../storage/sqlite.js';
import { c } from '../../utils/colors.js';

/**
 * `gitwhy aliases list`
 *
 * Pretty-prints the configured aliases. Useful for sanity-checking what
 * the bus-factor calculator will treat as one human.
 */
export function runAliasesList(options: { cwd: string }): void {
  const path = join(options.cwd, '.gitwhy', 'aliases.json');
  if (!existsSync(path)) {
    process.stdout.write(
      `${c.dim('no aliases.json configured')} (looked at ${c.dim(path)})\n`,
    );
    process.stdout.write(
      `\nCreate one at ${c.bold('.gitwhy/aliases.json')} with shape:\n`,
    );
    process.stdout.write(
      `${c.dim('  { "version": 1, "aliases": { "canonical@example.com": ["alt@example.com"] } }')}\n`,
    );
    return;
  }

  let parsed: { aliases?: Record<string, string[]> };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8')) as typeof parsed;
  } catch (err) {
    process.stderr.write(
      `${c.fail('error')} could not parse ${path}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }

  const map = parsed.aliases ?? {};
  const entries = Object.entries(map);
  if (entries.length === 0) {
    process.stdout.write(`${c.dim('aliases.json is empty')}\n`);
    return;
  }
  process.stdout.write(`${c.bold(`${entries.length} canonical author(s):`)}\n\n`);
  for (const [canonical, list] of entries) {
    process.stdout.write(`  ${c.cyan(canonical)}\n`);
    for (const alias of list) {
      process.stdout.write(`    ${c.dim('= ')} ${alias}\n`);
    }
  }
}

/**
 * `gitwhy aliases suggest`
 *
 * Scans the index for authors sharing a name across different emails.
 * Outputs human-reviewable groups — never auto-merges (two humans can
 * share a name; the model can't tell). Copy into aliases.json by hand.
 */
export function runAliasesSuggest(options: { cwd: string }): void {
  const paths = resolvePaths(options.cwd);
  if (!existsSync(paths.commitsDb)) {
    process.stderr.write(
      `${c.fail('error')} gitwhy is not initialized at ${options.cwd}. Run \`gitwhy init\` and \`gitwhy index\` first.\n`,
    );
    process.exit(1);
  }
  const db = openDatabase({ path: paths.commitsDb });
  const rows = db
    .prepare(
      `SELECT author_name, author_email, COUNT(*) AS commits
       FROM commits
       GROUP BY author_email`,
    )
    .all() as Array<{ author_name: string; author_email: string; commits: number }>;
  db.close();

  const suggestions = suggestAliases(
    rows.map((r) => ({ name: r.author_name, email: r.author_email, commits: r.commits })),
  );
  if (suggestions.length === 0) {
    process.stdout.write(
      `${c.dim('no name-based alias candidates found in the indexed history.')}\n`,
    );
    return;
  }
  process.stdout.write(
    `${c.bold(`${suggestions.length} suggested alias group(s):`)} ${c.dim('(review and add to .gitwhy/aliases.json)')}\n\n`,
  );
  for (const s of suggestions) {
    process.stdout.write(`  ${c.cyan(s.name)}\n`);
    for (const e of s.emails) {
      process.stdout.write(
        `    ${c.dim(`(${e.commits} commit${e.commits === 1 ? '' : 's'})`)} ${e.email}\n`,
      );
    }
    process.stdout.write('\n');
  }
  process.stdout.write(
    `${c.dim('Example aliases.json block:')}\n${c.dim('  {')}\n${c.dim('    "version": 1,')}\n${c.dim('    "aliases": {')}\n`,
  );
  const first = suggestions[0];
  if (first) {
    const canonical = first.emails[0]?.email ?? '';
    const others = first.emails.slice(1).map((e) => `"${e.email}"`);
    process.stdout.write(
      `${c.dim(`      "${canonical}": [${others.join(', ')}]`)}\n`,
    );
  }
  process.stdout.write(`${c.dim('    }')}\n${c.dim('  }')}\n`);
}
