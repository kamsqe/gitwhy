import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type TraceKind =
  | 'llm_call'
  | 'mcp_tool'
  | 'agent_op'
  | 'indexer'
  | 'cli'
  | 'error';

export interface TraceEvent {
  readonly timestamp: number;
  readonly kind: TraceKind;
  readonly durationMs?: number;
  readonly data: Record<string, unknown>;
}

export interface Tracer {
  emit(event: Omit<TraceEvent, 'timestamp'>): void;
  /**
   * Wrap an async operation: emit one event after it resolves (or rejects)
   * with the captured duration. The event kind + base data are merged with
   * any `extra` returned from the operation; errors are emitted with
   * kind=error and the original kind under `data.parentKind`.
   */
  withSpan<T>(
    kind: TraceKind,
    data: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T>;
  close(): void;
}

export function createNullTracer(): Tracer {
  return {
    emit() {},
    async withSpan<T>(_kind: TraceKind, _data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
      return fn();
    },
    close() {},
  };
}

export function createNdjsonTracer(filePath: string): Tracer {
  mkdirSync(dirname(filePath), { recursive: true });

  return {
    emit(event) {
      const full: TraceEvent = { timestamp: Date.now(), ...event };
      try {
        appendFileSync(filePath, `${JSON.stringify(full)}\n`, 'utf8');
      } catch {
        // Tracing must never break the caller.
      }
    },
    async withSpan<T>(kind: TraceKind, data: Record<string, unknown>, fn: () => Promise<T>): Promise<T> {
      const start = Date.now();
      try {
        const result = await fn();
        try {
          appendFileSync(
            filePath,
            `${JSON.stringify({
              timestamp: Date.now(),
              kind,
              durationMs: Date.now() - start,
              data,
            })}\n`,
            'utf8',
          );
        } catch {
          // ignore
        }
        return result;
      } catch (err) {
        try {
          appendFileSync(
            filePath,
            `${JSON.stringify({
              timestamp: Date.now(),
              kind: 'error',
              durationMs: Date.now() - start,
              data: {
                parentKind: kind,
                ...data,
                error: err instanceof Error ? err.message : String(err),
              },
            })}\n`,
            'utf8',
          );
        } catch {
          // ignore
        }
        throw err;
      }
    },
    close() {},
  };
}

/**
 * Build a tracer based on env flags:
 *   GITWHY_TRACE=1   → NDJSON file at `.gitwhy/traces/<session>.ndjson`
 *   otherwise        → null tracer (no-op).
 */
export function createDefaultTracer(traceFilePath: string | null): Tracer {
  if (process.env['GITWHY_TRACE'] === '1' && traceFilePath !== null) {
    return createNdjsonTracer(traceFilePath);
  }
  return createNullTracer();
}
