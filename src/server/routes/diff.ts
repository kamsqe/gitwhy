import type { Hono } from 'hono';
import { createGitReader, gitReaderOptionsFromConfig } from '../../indexer/git-reader.js';

const MAX_DIFF_BYTES = 200_000; // ~200KB — covers all but pathological mega-commits
const HASH_PATTERN = /^[0-9a-f]{7,40}$/i;

/**
 * GET /api/diff?hash=<commit_hash>
 *
 * Returns the unified diff for a single commit as plain text. Used by the
 * web UI's "show diff" toggle on citation cards — the trust primitive
 * that lets users verify the model didn't fabricate a claim about the
 * commit's contents.
 *
 * Why this is safe:
 *   - The hash must match HASH_PATTERN (hex, 7-40 chars), so we can't be
 *     coerced into running `git show <arbitrary>` with a path traversal.
 *   - simple-git escapes its arguments before shelling out anyway.
 *   - Output is truncated at MAX_DIFF_BYTES with a clear marker so we
 *     don't lock up the browser on a 5MB diff.
 *
 * Returns 404 with a JSON error when the hash isn't a real commit.
 */
export function registerDiffRoutes(app: Hono): void {
  app.get('/api/diff', async (c) => {
    const appCtx = c.get('appCtx');
    const hash = c.req.query('hash');
    if (!hash) {
      return c.json({ error: 'hash query parameter is required' }, 400);
    }
    if (!HASH_PATTERN.test(hash)) {
      return c.json(
        { error: 'hash must be a 7-40 character hex string' },
        400,
      );
    }

    const reader = createGitReader(gitReaderOptionsFromConfig(appCtx.cwd, appCtx.config.scope));
    try {
      let diff = await reader.loadDiff(hash);
      let truncated = false;
      // Use byte length for the truncation cutoff (Buffer.byteLength counts
      // UTF-8 bytes), but slice on character length — the diff is typically
      // ASCII so they're equivalent for our purposes, and overshooting the
      // cutoff in pathological UTF-8 cases is fine.
      if (Buffer.byteLength(diff, 'utf-8') > MAX_DIFF_BYTES) {
        truncated = true;
        diff = diff.slice(0, MAX_DIFF_BYTES);
      }
      return c.json({ hash, diff, truncated, maxBytes: MAX_DIFF_BYTES });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // simple-git surfaces "unknown revision" as part of the error text
      // when the hash isn't a real commit. Map that to 404 specifically so
      // the UI can render a "commit not found in this repo" hint rather
      // than the raw exception.
      if (/unknown revision|bad object|fatal: ambiguous argument/i.test(message)) {
        return c.json(
          { error: `Commit ${hash} not found in this repository.` },
          404,
        );
      }
      return c.json({ error: message }, 500);
    }
  });
}
