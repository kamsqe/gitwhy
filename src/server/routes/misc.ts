import type { Hono } from 'hono';
import { z } from 'zod';
import { runCommitCommand } from '../../cli/commands/commit.js';
import {
  recentFeedback,
  submitFeedback,
  summarizeFeedback,
} from '../../cli/commands/feedback.js';
import { contextForPrTool } from '../../mcp/tools/context-for-pr.js';
import { requireInitialized } from '../app.js';

/**
 * Endpoints that don't fit Insight/Query/Health: feedback CRUD,
 * context-for-pr, suggest-commit.
 */
export function registerMiscRoutes(app: Hono): void {
  const feedbackSchema = z.object({
    rating: z.enum(['up', 'down']),
    question: z.string().min(1),
    answer: z.string().optional(),
    confidence: z.number().min(0).max(1).optional(),
    citations: z.array(z.string()).optional(),
    note: z.string().optional(),
  });

  app.post('/api/feedback', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = feedbackSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const id = submitFeedback({ cwd: appCtx.cwd, ...parsed.data });
    return c.json({ id });
  });

  app.get('/api/feedback/summary', (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);
    return c.json(summarizeFeedback(appCtx.cwd));
  });

  app.get('/api/feedback/list', (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const limitRaw = c.req.query('limit');
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    const ratingRaw = c.req.query('rating');
    const rating = ratingRaw === 'up' || ratingRaw === 'down' ? ratingRaw : undefined;

    return c.json(
      recentFeedback({
        cwd: appCtx.cwd,
        ...(limit !== undefined && !Number.isNaN(limit) && { limit }),
        ...(rating !== undefined && { rating }),
      }),
    );
  });

  const contextForPrSchema = z
    .object({
      branch: z.string().min(1).optional(),
      base: z.string().min(1).optional(),
      files: z.array(z.string().min(1)).max(50).optional(),
    })
    .refine((v) => v.branch !== undefined || (v.files !== undefined && v.files.length > 0), {
      message: 'Provide either `branch` or non-empty `files` array.',
    });

  app.post('/api/context-for-pr', async (c) => {
    const appCtx = c.get('appCtx');
    const guard = requireInitialized(appCtx);
    if (!guard.ok) return c.json({ error: guard.error }, 412);

    const parsed = contextForPrSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = await contextForPrTool.handler(parsed.data, {
      cwd: appCtx.cwd,
      runtime: appCtx.runtime,
    });
    return c.json({ text: result.content[0]?.text ?? '', isError: result.isError === true });
  });

  /**
   * POST /api/suggest-commit — generate a commit message from staged diff.
   * Works without `.gitwhy/` init (it only needs LLM creds + a git repo).
   */
  const commitSchema = z.object({
    style: z.enum(['conventional', 'plain']).optional(),
    scope: z.string().optional(),
  });

  app.post('/api/suggest-commit', async (c) => {
    const appCtx = c.get('appCtx');
    const parsed = commitSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    try {
      const result = await runCommitCommand({
        cwd: appCtx.cwd,
        ...(parsed.data.style !== undefined && { style: parsed.data.style }),
        ...(parsed.data.scope !== undefined && { scope: parsed.data.scope }),
      });
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // "No staged changes" is a user-fixable condition, not an error.
      if (message.includes('No staged changes')) {
        return c.json({ error: message }, 400);
      }
      throw err;
    }
  });
}
