import type { Hono } from 'hono';
import { z } from 'zod';
import { analyzeIncidentWindow } from '../../agents/insight/incident-archaeologist.js';
import { loadAliases } from '../../config/aliases.js';
import { openDatabase } from '../../storage/sqlite.js';
import { resolvePaths } from '../../config/loader.js';
import { requireInitialized } from '../app.js';

/**
 * POST /api/incident
 *
 * "What landed in the window when this thing broke?"
 *
 * Input: an ISO timestamp (`at`) for when the incident started, plus
 * optional window/aftermath durations. Output: commits before the
 * timestamp ranked by suspicion, and commits after that may already
 * have addressed it.
 *
 * No LLM call — pure SQL + bus-factor agent. Runs instantly even on
 * big indexes. The endpoint surfaces facts; it deliberately does NOT
 * claim causation. That stays with the human.
 */
export function registerIncidentRoutes(app: Hono): void {
  const incidentSchema = z.object({
    at: z
      .string()
      .min(1)
      .refine((v) => !Number.isNaN(Date.parse(v)), {
        message: 'Could not parse `at` as a date — use ISO 8601 (e.g. "2026-05-15T14:30:00Z").',
      }),
    windowMinutes: z.number().int().min(1).max(60 * 24 * 7).optional(),
    afterMinutes: z.number().int().min(0).max(60 * 24).optional(),
    limitPerBucket: z.number().int().min(1).max(200).optional(),
  });

  app.post('/api/incident', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = incidentSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    // Re-open the DB on each request rather than reusing the runtime's
    // handle — the runtime is for LLM-bearing tools and we want to keep
    // the incident path lightweight. The applyMigrations call inside
    // openDatabase is idempotent so this is cheap.
    const paths = resolvePaths(appCtx.cwd);
    const db = openDatabase({ path: paths.commitsDb });
    const aliases = loadAliases(appCtx.cwd);

    try {
      const result = analyzeIncidentWindow(db, {
        atMs: Date.parse(parsed.data.at),
        ...(parsed.data.windowMinutes !== undefined && {
          windowMs: parsed.data.windowMinutes * 60 * 1000,
        }),
        ...(parsed.data.afterMinutes !== undefined && {
          afterMs: parsed.data.afterMinutes * 60 * 1000,
        }),
        ...(parsed.data.limitPerBucket !== undefined && {
          limitPerBucket: parsed.data.limitPerBucket,
        }),
      }, aliases);

      // Convert dates to ISO strings for the wire — the analyzer returns
      // Date objects for ergonomic in-process use, but JSON serialization
      // would otherwise be inconsistent across timezones.
      return c.json({
        windowStart: new Date(result.windowStartMs).toISOString(),
        windowEnd: new Date(result.windowEndMs).toISOString(),
        hotfixWindowEnd: new Date(result.hotfixWindowEndMs).toISOString(),
        suspects: result.suspects.map((s) => ({ ...s, date: s.date.toISOString() })),
        hotfixes: result.hotfixes.map((s) => ({ ...s, date: s.date.toISOString() })),
      });
    } finally {
      db.close();
    }
  });
}
