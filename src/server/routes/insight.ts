import type { Hono } from 'hono';
import { z } from 'zod';
import { catchupTool } from '../../mcp/tools/catchup.js';
import { historyTool } from '../../mcp/tools/history.js';
import { relatedTool } from '../../mcp/tools/related.js';
import { riskTool } from '../../mcp/tools/risk.js';
import { requireInitialized } from '../app.js';
import type { AppContext } from '../app.js';

/**
 * The Insight endpoints reuse the existing MCP tool handlers — same code
 * path as the MCP integration, but transported over HTTP. The handlers
 * return both:
 *   - `data` (structured object via the agent layer when possible)
 *   - `text` (the human-readable string the MCP tool produces, useful
 *     for chat-style UIs that just want to render text).
 */
export function registerInsightRoutes(app: Hono): void {
  const riskSchema = z.object({
    path: z.string().min(1),
  });

  app.post('/api/risk', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = riskSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const runtime = appCtx.runtime.get();
    const text = await callTool(riskTool, parsed.data, appCtx);
    const score = runtime.insight.riskScore(parsed.data.path);
    const busFactor = runtime.insight.busFactor(parsed.data.path);

    return c.json({
      text,
      data: {
        risk: score,
        busFactor,
      },
    });
  });

  const relatedSchema = z.object({
    path: z.string().min(1),
    limit: z.number().int().min(1).max(50).optional(),
    minCoCommits: z.number().int().min(1).max(100).optional(),
  });

  app.post('/api/related', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = relatedSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const runtime = appCtx.runtime.get();
    const text = await callTool(relatedTool, parsed.data, appCtx);
    const data = runtime.insight.relatedFiles(parsed.data.path, {
      ...(parsed.data.limit !== undefined && { limit: parsed.data.limit }),
      ...(parsed.data.minCoCommits !== undefined && { minCoCommits: parsed.data.minCoCommits }),
    });

    return c.json({ text, data });
  });

  /**
   * GET /api/history?path=...&limit=...
   *
   * Uses query params (not JSON body) for ergonomics — easy to share as a link.
   */
  app.get('/api/history', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const path = c.req.query('path');
    if (!path) return c.json({ error: 'path query parameter is required' }, 400);
    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;

    const text = await callTool(historyTool, { path, ...(limit !== undefined && !Number.isNaN(limit) && { limit }) }, appCtx);
    return c.json({ text });
  });

  const catchupSchema = z.object({
    since: z.string().min(1),
    limit: z.number().int().min(1).max(200).optional(),
  });

  app.post('/api/catchup', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = catchupSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const text = await callTool(catchupTool, parsed.data, appCtx);
    return c.json({ text });
  });
}

async function callTool<T>(
  tool: { handler: (input: T, ctx: { cwd: string; runtime: AppContext['runtime'] }) => Promise<{ content: Array<{ text: string }>; isError?: boolean }> },
  input: T,
  appCtx: AppContext,
): Promise<string> {
  const result = await tool.handler(input, { cwd: appCtx.cwd, runtime: appCtx.runtime });
  return result.content[0]?.text ?? '';
}
