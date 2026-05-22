import type { Hono } from 'hono';
import { z } from 'zod';
import { selectOnboardingCommits } from '../../agents/insight/onboarding.js';
import { loadAliases } from '../../config/aliases.js';
import { resolvePaths } from '../../config/loader.js';
import { openDatabase } from '../../storage/sqlite.js';
import { requireInitialized } from '../app.js';

/**
 * POST /api/onboarding
 *
 * "What 10 commits should a new dev read to understand this codebase?"
 *
 * Pure SQL — no LLM. Honest ranking that DOESN'T just sort by lines
 * changed (which surfaces mega-refactors, the LEAST useful commits for
 * onboarding). See selectOnboardingCommits for the scoring logic.
 */
export function registerOnboardingRoutes(app: Hono): void {
  const onboardingSchema = z.object({
    limit: z.number().int().min(1).max(50).optional(),
    maxConsecutiveFromSameAuthor: z.number().int().min(1).max(20).optional(),
  });

  app.post('/api/onboarding', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = onboardingSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const paths = resolvePaths(appCtx.cwd);
    const db = openDatabase({ path: paths.commitsDb });
    const aliases = loadAliases(appCtx.cwd);
    try {
      const result = selectOnboardingCommits(db, parsed.data, aliases);
      return c.json({
        totalCommits: result.totalCommits,
        candidatesConsidered: result.candidatesConsidered,
        recommendations: result.recommendations.map((r) => ({
          ...r,
          date: r.date.toISOString(),
        })),
      });
    } finally {
      db.close();
    }
  });
}
