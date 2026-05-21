import type { Hono } from 'hono';
import { runStatusCommand } from '../../cli/commands/status.js';
import { requireInitialized } from '../app.js';

const VERSION = '0.0.1';

export function registerHealthRoutes(app: Hono): void {
  /**
   * GET /api/health — always succeeds. Used by the web UI to detect "is
   * there a local gitwhy backend running?" without requiring init.
   */
  app.get('/api/health', (c) => {
    const ctx = c.get('appCtx');
    return c.json({
      ok: true,
      version: VERSION,
      cwd: ctx.cwd,
      initialized: ctx.isInitialized,
      provider: ctx.config.provider.llm,
      models: {
        indexing: ctx.config.provider.indexingModel,
        query: ctx.config.provider.queryModel,
        embedding: ctx.config.provider.embeddingModel,
      },
    });
  });

  /**
   * GET /api/status — index coverage, token spend, hotspots. Requires init.
   */
  app.get('/api/status', async (c) => {
    const ctx = c.get('appCtx');
    const guard = requireInitialized(ctx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const result = await runStatusCommand({ cwd: ctx.cwd });
    return c.json(result);
  });
}
