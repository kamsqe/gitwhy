import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  type IndexJob,
  type IndexJobEvent,
  type IndexProgress,
  type IndexStartInput,
} from './api';

interface UseIndexJobState {
  /** Current job snapshot. null = no job has ever started in this session. */
  job: IndexJob | null;
  /** Latest progress tick (more up-to-date than job.progress when running). */
  progress: IndexProgress | null;
  /** Connection state of the SSE stream. */
  streaming: boolean;
  /** Most recent error from start/cancel. */
  error: string | null;
}

interface UseIndexJobApi extends UseIndexJobState {
  start: (input: IndexStartInput) => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Reads the current indexing job from /api/index/status on mount, subscribes
 * to /api/index/stream for live updates, and exposes start/cancel helpers.
 *
 * EventSource auto-reconnects on flaky networks, so we don't have to manage
 * that ourselves. We just close the source when the job transitions to a
 * terminal state — there's nothing more to receive.
 */
export function useIndexJob(): UseIndexJobApi {
  const [state, setState] = useState<UseIndexJobState>({
    job: null,
    progress: null,
    streaming: false,
    error: null,
  });
  const esRef = useRef<EventSource | null>(null);

  const handleEvent = useCallback((event: IndexJobEvent) => {
    setState((prev) => {
      let job = prev.job;
      let progress = prev.progress;

      switch (event.type) {
        case 'started':
          // The server sends this when a new job is registered. We may
          // already have a stale snapshot from /api/index/status; bias to
          // the started event if the IDs differ.
          if (job?.id !== event.jobId) {
            job = {
              id: event.jobId,
              state: 'running',
              startedAt: event.startedAt,
              endedAt: null,
              progress: null,
              result: null,
              error: null,
              options: {},
            };
            progress = null;
          }
          break;
        case 'progress':
          progress = event.progress;
          if (job) job = { ...job, progress: event.progress };
          break;
        case 'done':
          if (job) job = { ...job, state: 'done', result: event.result, endedAt: Date.now() };
          progress = event.result.progress;
          break;
        case 'cancelled':
          if (job) job = { ...job, state: 'cancelled', endedAt: Date.now() };
          break;
        case 'failed':
          if (job) job = { ...job, state: 'failed', error: event.message, endedAt: Date.now() };
          break;
      }
      return { ...prev, job, progress };
    });
  }, []);

  const openStream = useCallback(() => {
    if (esRef.current) return;
    const es = api.indexStream();
    esRef.current = es;
    setState((s) => ({ ...s, streaming: true }));

    const onEvent = (e: MessageEvent<string>) => {
      try {
        handleEvent(JSON.parse(e.data) as IndexJobEvent);
      } catch {
        // Heartbeats and other non-JSON events fall through harmlessly.
      }
    };
    // Listen for each named event type the server emits.
    for (const type of ['started', 'progress', 'done', 'cancelled', 'failed']) {
      es.addEventListener(type, onEvent as EventListener);
    }
    es.addEventListener('error', () => {
      // EventSource will auto-reconnect; we only flip the flag when the
      // job is in a terminal state and we manually close.
      setState((s) => ({ ...s, streaming: !!esRef.current }));
    });
  }, [handleEvent]);

  const closeStream = useCallback(() => {
    esRef.current?.close();
    esRef.current = null;
    setState((s) => ({ ...s, streaming: false }));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const { job } = await api.indexStatus();
      setState((s) => ({ ...s, job, progress: job?.progress ?? null, error: null }));
      // Open the stream when there's an active job; otherwise no point
      // burning a connection waiting for something to happen.
      if (job?.state === 'running') openStream();
      else closeStream();
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    }
  }, [openStream, closeStream]);

  const start = useCallback(
    async (input: IndexStartInput) => {
      try {
        const { job } = await api.indexStart(input);
        setState((s) => ({ ...s, job, progress: null, error: null }));
        openStream();
      } catch (err) {
        setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
      }
    },
    [openStream],
  );

  const cancel = useCallback(async () => {
    try {
      await api.indexCancel();
    } catch (err) {
      setState((s) => ({ ...s, error: err instanceof Error ? err.message : String(err) }));
    }
  }, []);

  // Initial fetch + cleanup on unmount.
  useEffect(() => {
    void refresh();
    return closeStream;
  }, [refresh, closeStream]);

  // Auto-close the stream when the job transitions to a terminal state.
  useEffect(() => {
    if (state.job && state.job.state !== 'running') {
      closeStream();
    }
  }, [state.job?.state, closeStream]);

  return { ...state, start, cancel, refresh };
}
