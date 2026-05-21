import { randomUUID } from 'node:crypto';
import { runIndexCommand } from '../cli/commands/index-command.js';
import type { IndexProgress, IndexResult } from '../indexer/indexer.js';
import { logger } from '../utils/logger.js';

/**
 * Singleton in-process job manager for `gitwhy index` triggered from the web UI.
 *
 * Why singleton: indexing writes to the SQLite file and burns LLM budget; running
 * two concurrent jobs against the same repo would corrupt progress accounting
 * and double-bill the user. So at most one job can be active per gitwhy serve
 * process.
 *
 * Why in-memory: jobs are short-lived (seconds to minutes) and only meaningful
 * while gitwhy serve is running. No persistence needed — if the user kills
 * the server, the job dies with it (and SIGINT is honored via AbortController
 * so SQLite stays consistent).
 *
 * Why an event log + listener set: clients connect via SSE; a tab that opens
 * mid-indexing should still see the progress that already happened. We keep
 * a bounded history (MAX_HISTORY events) so reconnecting clients don't lose
 * context, but old events are evicted to avoid unbounded memory growth.
 */

export type JobState = 'running' | 'done' | 'cancelled' | 'failed';

export type JobEvent =
  | { type: 'started'; jobId: string; startedAt: number; total: number | null }
  | { type: 'progress'; progress: IndexProgress }
  | { type: 'done'; result: IndexResult }
  | { type: 'cancelled'; lastProgress: IndexProgress | null }
  | { type: 'failed'; message: string };

export interface PublicJob {
  id: string;
  state: JobState;
  startedAt: number;
  endedAt: number | null;
  progress: IndexProgress | null;
  result: IndexResult | null;
  error: string | null;
  options: Pick<StartJobOptions, 'provider' | 'model' | 'budgetUsd' | 'since' | 'until' | 'maxCount'>;
}

export interface StartJobOptions {
  cwd: string;
  provider?: 'openai' | 'gemini' | 'mock';
  model?: string;
  budgetUsd?: number;
  since?: string;
  until?: string;
  maxCount?: number;
}

type Listener = (event: JobEvent) => void;

const MAX_HISTORY = 200;

interface InternalJob {
  id: string;
  state: JobState;
  startedAt: number;
  endedAt: number | null;
  options: StartJobOptions;
  progress: IndexProgress | null;
  result: IndexResult | null;
  error: string | null;
  abort: AbortController;
  listeners: Set<Listener>;
  history: JobEvent[];
}

let current: InternalJob | null = null;

function publicView(j: InternalJob): PublicJob {
  const { provider, model, budgetUsd, since, until, maxCount } = j.options;
  return {
    id: j.id,
    state: j.state,
    startedAt: j.startedAt,
    endedAt: j.endedAt,
    progress: j.progress,
    result: j.result,
    error: j.error,
    options: {
      ...(provider !== undefined && { provider }),
      ...(model !== undefined && { model }),
      ...(budgetUsd !== undefined && { budgetUsd }),
      ...(since !== undefined && { since }),
      ...(until !== undefined && { until }),
      ...(maxCount !== undefined && { maxCount }),
    },
  };
}

function emit(j: InternalJob, event: JobEvent): void {
  j.history.push(event);
  if (j.history.length > MAX_HISTORY) {
    // Keep the 'started' event always (it's how clients reconstruct
    // initial state) and trim from index 1 onwards.
    j.history.splice(1, j.history.length - MAX_HISTORY);
  }
  for (const fn of j.listeners) {
    try {
      fn(event);
    } catch (err) {
      logger.warn(`SSE listener threw: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/**
 * Start a new indexing job. Returns the public view immediately; the job
 * runs in the background and emits events through subscribers. Refuses
 * to start if another job is already running (returns { ok: false }).
 */
export function startJob(options: StartJobOptions): { ok: true; job: PublicJob } | { ok: false; reason: 'already_running'; job: PublicJob } {
  if (current?.state === 'running') {
    return { ok: false, reason: 'already_running', job: publicView(current) };
  }

  const job: InternalJob = {
    id: randomUUID(),
    state: 'running',
    startedAt: Date.now(),
    endedAt: null,
    options,
    progress: null,
    result: null,
    error: null,
    abort: new AbortController(),
    listeners: new Set(),
    history: [],
  };
  current = job;

  emit(job, { type: 'started', jobId: job.id, startedAt: job.startedAt, total: null });

  // Fire-and-forget. The job lives as long as the gitwhy serve process.
  void run(job);

  return { ok: true, job: publicView(job) };
}

async function run(job: InternalJob): Promise<void> {
  try {
    const result = await runIndexCommand({
      cwd: job.options.cwd,
      ...(job.options.provider !== undefined && { provider: job.options.provider }),
      ...(job.options.model !== undefined && { model: job.options.model }),
      ...(job.options.budgetUsd !== undefined && { budgetUsd: job.options.budgetUsd }),
      ...(job.options.since !== undefined && { since: job.options.since }),
      ...(job.options.until !== undefined && { until: job.options.until }),
      ...(job.options.maxCount !== undefined && { maxCount: job.options.maxCount }),
      signal: job.abort.signal,
      onProgress: (p) => {
        // Snapshot so later mutations of `p` (which the indexer reuses) don't
        // poison earlier listeners' references.
        job.progress = { ...p };
        emit(job, { type: 'progress', progress: { ...p } });
      },
    });

    job.result = result;
    job.endedAt = Date.now();
    if (result.stoppedReason === 'cancelled') {
      job.state = 'cancelled';
      emit(job, { type: 'cancelled', lastProgress: job.progress });
    } else {
      job.state = 'done';
      emit(job, { type: 'done', result });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    job.state = 'failed';
    job.endedAt = Date.now();
    job.error = message;
    emit(job, { type: 'failed', message });
  }
}

/** Cancel the running job if any. Returns true if a job was running. */
export function cancelJob(): boolean {
  if (current?.state !== 'running') return false;
  current.abort.abort();
  return true;
}

/** Snapshot of the most recent job (running or completed). */
export function getCurrentJob(): PublicJob | null {
  return current ? publicView(current) : null;
}

/**
 * Subscribe to events. Returns:
 *  - the history of events so far (so the new subscriber catches up)
 *  - an unsubscribe function
 *
 * Returns null if no job exists.
 */
export function subscribe(listener: Listener): { history: JobEvent[]; unsubscribe: () => void } | null {
  if (!current) return null;
  current.listeners.add(listener);
  // Important: snapshot the history at subscribe time so the caller can
  // replay without racing with new events being appended.
  const history = current.history.slice();
  const job = current;
  return {
    history,
    unsubscribe: () => {
      job.listeners.delete(listener);
    },
  };
}

/** Exposed for tests — never call from request handlers. */
export function _resetForTests(): void {
  if (current?.state === 'running') {
    current.abort.abort();
  }
  current = null;
}
