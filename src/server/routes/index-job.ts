import type { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import {
  cancelJob,
  getCurrentJob,
  startJob,
  subscribe,
  type JobEvent,
} from '../index-job.js';

/**
 * HTTP surface for the indexing job manager.
 *
 *   POST /api/index/start    Begin a job. 409 if one is already running.
 *   POST /api/index/cancel   Cancel the running job. 404 if none is.
 *   GET  /api/index/status   Current snapshot of the job (or null).
 *   GET  /api/index/stream   SSE — replays history, then streams live events.
 *
 * The stream is what makes this useful in the browser: a tab connects via
 * EventSource and receives every progress tick + the final done/cancelled
 * /failed event. Reconnecting tabs replay history so they don't miss the
 * progress that already happened.
 */
export function registerIndexJobRoutes(app: Hono): void {
  const startSchema = z.object({
    provider: z.enum(['openai', 'gemini', 'mock']).optional(),
    model: z.string().min(1).max(200).optional(),
    budgetUsd: z.number().positive().max(1000).optional(),
    since: z.string().min(1).max(200).optional(),
    until: z.string().min(1).max(200).optional(),
    maxCount: z.number().int().min(1).max(100000).optional(),
    full: z.boolean().optional(),
  });

  app.post('/api/index/start', async (c) => {
    const appCtx = c.get('appCtx');
    const parsed = startSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);

    const result = startJob({ cwd: appCtx.cwd, ...parsed.data });
    if (!result.ok) {
      return c.json(
        {
          error: 'An indexing job is already running. Cancel it first.',
          job: result.job,
        },
        409,
      );
    }
    return c.json({ job: result.job });
  });

  app.post('/api/index/cancel', (c) => {
    const ok = cancelJob();
    if (!ok) {
      return c.json({ error: 'No indexing job is currently running.' }, 404);
    }
    return c.json({ ok: true });
  });

  app.get('/api/index/status', (c) => {
    const job = getCurrentJob();
    return c.json({ job });
  });

  /**
   * SSE event stream. Event types match JobEvent.type — clients can listen
   * for specific types (e.g. `evtSource.addEventListener('progress', ...)`)
   * or use the generic 'message' handler.
   *
   * On connect we replay the job's event history so a tab that opens
   * mid-indexing reconstructs the right state. After replay, we keep the
   * connection open and forward live events until the job ends (done,
   * cancelled, failed) — then a final empty data line lets the client
   * close gracefully.
   */
  app.get('/api/index/stream', (c) => {
    return streamSSE(c, async (stream) => {
      const subscription = subscribe((event) => {
        void writeEvent(stream, event);
      });

      if (!subscription) {
        await stream.writeSSE({
          event: 'no_job',
          data: JSON.stringify({
            message: 'No indexing job exists. POST /api/index/start to begin one.',
          }),
        });
        return;
      }

      // Replay history first so late subscribers see everything they missed.
      for (const event of subscription.history) {
        await writeEvent(stream, event);
      }

      // Keep the stream open until the job ends.
      await new Promise<void>((resolve) => {
        const interval = setInterval(() => {
          // 15s heartbeat keeps proxies / EventSource happy and detects
          // dead clients via the stream's auto-disconnect.
          void stream.writeSSE({ event: 'heartbeat', data: '' }).catch(() => {
            cleanup();
            resolve();
          });
          const job = getCurrentJob();
          if (job && job.state !== 'running') {
            cleanup();
            resolve();
          }
        }, 15000);

        const cleanup = (): void => {
          clearInterval(interval);
          subscription.unsubscribe();
        };

        stream.onAbort(() => {
          cleanup();
          resolve();
        });
      });
    });
  });
}

async function writeEvent(
  stream: { writeSSE: (data: { event: string; data: string }) => Promise<void> },
  event: JobEvent,
): Promise<void> {
  await stream.writeSSE({
    event: event.type,
    data: JSON.stringify(event),
  });
}
