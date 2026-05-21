import { useEffect, useState } from 'react';

/**
 * Reports elapsed seconds while `loading` is true. Resets to 0 when
 * loading flips back to false. Used to give the user visibility when
 * an LLM-backed request takes >3s — concurrent /api/why calls serialize
 * through the LLM rate limiter, so a second-issued question can look
 * stuck even though it's just queued.
 *
 * Tick interval is 1s; the hook only schedules a timer while loading,
 * so idle tabs cost nothing.
 */
export function useElapsed(loading: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!loading) {
      setElapsed(0);
      return;
    }
    const start = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [loading]);

  return elapsed;
}

/**
 * Formats elapsed seconds for display alongside a spinner. Returns null
 * for the first few seconds so the indicator only appears once a request
 * is actually slow (avoids a flicker of "0s" on fast responses).
 */
export function formatElapsedHint(elapsed: number): string | null {
  if (elapsed < 3) return null;
  if (elapsed < 60) return `${elapsed}s`;
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  return `${min}m ${sec}s`;
}
