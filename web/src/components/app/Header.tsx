import { useEffect, useState } from 'react';
import { api, type StatusResponse } from './lib/api';
import type { HealthResponse } from './lib/api';

interface HeaderProps {
  health: HealthResponse;
}

export function Header({ health }: HeaderProps) {
  const [status, setStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    if (!health.initialized) return;
    void api.status().then(setStatus).catch(() => undefined);
  }, [health.initialized]);

  const coveragePct = status ? Math.round(status.indexCoverage * 100) : null;
  const coverageColor =
    coveragePct === null
      ? 'text-gw-text-faint'
      : coveragePct >= 95
        ? 'text-emerald-400'
        : coveragePct >= 50
          ? 'text-amber-400'
          : 'text-red-400';

  return (
    <header className="sticky top-0 z-10 border-b border-gw-border bg-gw-surface/95 backdrop-blur">
      <div className="flex items-center gap-6 px-6 py-3">
        <a
          href="/"
          className="flex items-center gap-2 text-gw-text no-underline hover:opacity-80"
        >
          <span className="inline-block h-6 w-6 rounded-full bg-gw-accent" aria-hidden />
          <span className="gw-display text-[1.0625rem] font-medium tracking-tight">GitWhy</span>
        </a>

        <div className="flex items-center gap-2 text-xs">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
          <span className="text-gw-text-dim">connected</span>
          <span className="text-gw-text-faint">·</span>
          <span className="gw-mono text-gw-text-faint">{health.cwd.split('/').slice(-2).join('/')}</span>
        </div>

        <div className="ml-auto flex items-center gap-4 text-xs text-gw-text-dim">
          {status && health.initialized && (
            <>
              <span>
                <span className="text-gw-text-faint">coverage </span>
                <span className={`gw-mono ${coverageColor}`}>{coveragePct}%</span>
              </span>
              <span className="text-gw-text-faint">·</span>
              <span>
                <span className="text-gw-text-faint">spent </span>
                <span className="gw-mono text-gw-text">${status.costUsd.toFixed(3)}</span>
              </span>
              <span className="text-gw-text-faint">·</span>
            </>
          )}
          <span>
            <span className="text-gw-text-faint">model </span>
            <span className="gw-mono text-gw-text">{health.models.query}</span>
          </span>
        </div>
      </div>
    </header>
  );
}
