import type { Hono } from 'hono';
import { z } from 'zod';
import { buildFileGraph } from '../../agents/insight/file-graph.js';
import { loadAliases } from '../../config/aliases.js';
import { resolvePaths } from '../../config/loader.js';
import { openDatabase } from '../../storage/sqlite.js';
import { requireInitialized } from '../app.js';

/**
 * POST /api/graph
 *
 * Returns a file co-change graph for visualization: top-N most-active
 * files as nodes, plus edges between pairs that co-changed >= minCo times.
 * Pure SQL — no LLM call. .gitwhyignore'd files are already filtered.
 */
export function registerGraphRoutes(app: Hono): void {
  const graphSchema = z.object({
    maxNodes: z.number().int().min(5).max(200).optional(),
    minCoCommits: z.number().int().min(1).max(100).optional(),
  });

  app.post('/api/graph', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = graphSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const paths = resolvePaths(appCtx.cwd);
    const db = openDatabase({ path: paths.commitsDb });
    const aliases = loadAliases(appCtx.cwd);
    try {
      const result = buildFileGraph(db, parsed.data, aliases);
      return c.json(result);
    } finally {
      db.close();
    }
  });
}
