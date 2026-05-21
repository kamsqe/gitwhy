import { useEffect, useState } from 'react';
import { api, type HealthResponse, GitWhyOfflineError } from './api';

export type BackendStatus =
  | { kind: 'checking' }
  | { kind: 'online'; health: HealthResponse }
  | { kind: 'offline'; error: string };

/**
 * Probes /api/health on mount; on success returns the health payload,
 * on failure returns an offline state with the error message.
 *
 * Caller can `refresh()` to re-probe (e.g. after the user starts the
 * backend without leaving the page).
 */
export function useBackendStatus(): { status: BackendStatus; refresh: () => void } {
  const [status, setStatus] = useState<BackendStatus>({ kind: 'checking' });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: 'checking' });
    void api
      .health()
      .then((health) => {
        if (!cancelled) setStatus({ kind: 'online', health });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof GitWhyOfflineError
            ? 'gitwhy backend is not reachable at this URL'
            : err instanceof Error
              ? err.message
              : String(err);
        setStatus({ kind: 'offline', error: message });
      });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { status, refresh: () => setTick((n) => n + 1) };
}
