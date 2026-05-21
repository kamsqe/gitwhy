import type { Hono } from 'hono';
import { z } from 'zod';
import { runEstimate } from '../../cli/commands/estimate.js';
import { searchTool } from '../../mcp/tools/search.js';
import { requireInitialized } from '../app.js';

/**
 * LLM-dependent endpoints: ask (why), search, estimate.
 *
 * - `/api/why` is the headline endpoint, returns answer + citations + confidence.
 * - `/api/search` is a vector-only fallback (no LLM synthesis, just ranked hits).
 * - `/api/estimate` is LLM-free dry-run cost projection.
 */
export function registerQueryRoutes(app: Hono): void {
  const whySchema = z.object({
    // Cap question length to keep LLM cost predictable. 2000 chars is plenty
    // for any realistic natural-language question — anything longer is likely
    // a paste accident or abuse. The local server still charges the user's
    // own API key, so this is a guardrail, not a security boundary.
    question: z.string().min(1).max(2000),
    topK: z.number().int().min(1).max(20).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    noCache: z.boolean().optional(),
  });

  app.post('/api/why', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = whySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const runtime = appCtx.runtime.get();
    const result = await runtime.knowledge.ask(parsed.data.question, {
      ...(parsed.data.topK !== undefined && { topK: parsed.data.topK }),
      ...(parsed.data.minConfidence !== undefined && { minConfidence: parsed.data.minConfidence }),
      ...(parsed.data.noCache !== undefined && { noCache: parsed.data.noCache }),
    });

    return c.json(result);
  });

  const searchSchema = z.object({
    // Embedding queries should be short keyword phrases, not essays. 500 char
    // cap mirrors what real ranking queries look like in practice and keeps
    // embedding cost trivial.
    query: z.string().min(1).max(500),
    topK: z.number().int().min(1).max(50).optional(),
  });

  app.post('/api/search', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = searchSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = await searchTool.handler(parsed.data, {
      cwd: appCtx.cwd,
      runtime: appCtx.runtime,
    });
    return c.json({ text: result.content[0]?.text ?? '' });
  });

  const estimateSchema = z.object({
    since: z.string().min(1).optional(),
    until: z.string().min(1).optional(),
    maxCount: z.number().int().min(1).optional(),
  });

  app.post('/api/estimate', async (c) => {
    const appCtx = c.get('appCtx');
    // Estimate doesn't need an indexed DB — it only reads git.
    const parsed = estimateSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = await runEstimate({
      cwd: appCtx.cwd,
      ...(parsed.data.since !== undefined && { since: parsed.data.since }),
      ...(parsed.data.until !== undefined && { until: parsed.data.until }),
      ...(parsed.data.maxCount !== undefined && { maxCount: parsed.data.maxCount }),
    });
    return c.json(result);
  });
}
