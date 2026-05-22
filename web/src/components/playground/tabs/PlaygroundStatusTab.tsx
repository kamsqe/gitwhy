import { useMemo } from 'react';
import { Card } from '../../app/ui/Card';
import type { PlaygroundApi } from '../lib/playgroundApi';

export function PlaygroundStatusTab({ api }: { api: PlaygroundApi }) {
  const status = useMemo(() => api.status(), [api]);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Index status</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Snapshot of the pre-indexed database loaded in your browser.
        </p>
      </div>

      <Card>
        <p className="text-xs uppercase tracking-wider text-gw-text-faint">Coverage</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="gw-mono text-2xl font-semibold text-gw-text">
            {status.indexedCommits.toLocaleString()}
          </span>
          <span className="text-sm text-gw-text-dim">commits indexed</span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Stat label="embeddings" value={status.embeddings.toLocaleString()} />
          <Stat label="LLM calls" value={status.llmCalls.toLocaleString()} />
          <Stat label="indexed cost" value={`$${status.costUsd.toFixed(3)}`} />
        </dl>
        {status.lastIndexedAt && (
          <p className="mt-3 text-xs text-gw-text-faint">
            most recent commit indexed at {new Date(status.lastIndexedAt).toLocaleString()}
          </p>
        )}
      </Card>

      {status.topHotspots.length > 0 && (
        <Card>
          <p className="mb-3 text-xs uppercase tracking-wider text-gw-text-faint">
            Top hotspots (last 90 days)
          </p>
          <ul className="space-y-1.5">
            {status.topHotspots.map((h) => (
              <li key={h.path} className="flex items-baseline gap-3 text-sm">
                <code className="flex-1 truncate text-gw-text">{h.path}</code>
                <span className="gw-mono text-xs text-gw-text-faint">
                  {h.recentCommits} commits
                </span>
                <a
                  href="#risk"
                  className="text-xs text-gw-accent underline decoration-dotted"
                >
                  risk →
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gw-text-faint">{label}</dt>
      <dd className="gw-mono text-gw-text">{value}</dd>
    </div>
  );
}
