import { useEffect, useState } from 'react';
import { api, type HealthResponse, type StatusResponse } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

interface StatusTabProps {
  health: HealthResponse;
}

/**
 * Dashboard view of /api/status — surfaces the data the header doesn't
 * have room for: warnings, top hotspot files, embedding count, db size,
 * last-indexed timestamp. The header only shows a one-line summary;
 * this tab is where users come to understand the shape of their index.
 */
export function StatusTab({ health }: StatusTabProps) {
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setStatus(await api.status());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Index status</h1>
          <p className="mt-1 text-sm text-gw-text-dim">
            Coverage, hotspots, and warnings for the indexed repository at{' '}
            <code className="text-gw-text">{health.cwd}</code>.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void load()} disabled={loading}>
          {loading ? <Spinner size={14} /> : 'Refresh'}
        </Button>
      </div>

      {error && <ErrorCard message={error} />}

      {status && (
        <>
          {status.warnings.length > 0 && <WarningsCard warnings={status.warnings} />}
          <CoverageCard status={status} />
          <SpendCard status={status} health={health} />
          <HotspotsCard status={status} />
          <MetaCard status={status} />
        </>
      )}
    </div>
  );
}

function WarningsCard({ warnings }: { warnings: string[] }) {
  return (
    <Card className="border-amber-900/60 bg-amber-950/30">
      <p className="text-xs uppercase tracking-wider text-amber-300">
        {warnings.length === 1 ? 'Warning' : `${warnings.length} warnings`}
      </p>
      <ul className="mt-2 space-y-1.5 text-sm text-amber-100">
        {warnings.map((w, i) => (
          <li key={i}>• {w}</li>
        ))}
      </ul>
    </Card>
  );
}

function CoverageCard({ status }: { status: StatusResponse }) {
  const pct = Math.round(status.indexCoverage * 100);
  const tone =
    pct >= 95
      ? 'bg-emerald-500'
      : pct >= 50
        ? 'bg-amber-500'
        : 'bg-red-500';

  return (
    <Card>
      <div className="flex items-baseline justify-between">
        <p className="text-xs uppercase tracking-wider text-gw-text-faint">Coverage</p>
        <span className="gw-mono text-xs text-gw-text-dim">
          {status.indexedCommits.toLocaleString()} of{' '}
          {status.gitTotalCommits.toLocaleString()} commits
        </span>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gw-border">
          <div
            className={`h-full ${tone} transition-all`}
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
        <span className="gw-mono w-12 text-right text-sm text-gw-text">{pct}%</span>
      </div>
      <p className="mt-3 text-xs text-gw-text-faint">
        {status.embeddings.toLocaleString()} embeddings · last indexed{' '}
        {status.lastIndexedAt
          ? new Date(status.lastIndexedAt).toLocaleString()
          : 'never'}
      </p>
    </Card>
  );
}

function SpendCard({
  status,
  health,
}: {
  status: StatusResponse;
  health: HealthResponse;
}) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wider text-gw-text-faint">Spend so far</p>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span className="gw-mono text-2xl font-semibold text-gw-text">
          ${status.costUsd.toFixed(3)}
        </span>
        <span className="text-sm text-gw-text-dim">
          provider <code className="text-gw-text">{health.provider}</code>
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="LLM calls" value={status.llmCalls.toLocaleString()} />
        <Stat
          label="prompt tokens"
          value={formatTokens(status.promptTokens)}
        />
        <Stat
          label="completion"
          value={formatTokens(status.completionTokens)}
        />
      </dl>
    </Card>
  );
}

function HotspotsCard({ status }: { status: StatusResponse }) {
  if (status.topHotspots.length === 0) return null;
  return (
    <Card>
      <p className="mb-3 text-xs uppercase tracking-wider text-gw-text-faint">
        Top hotspots (last 90 days)
      </p>
      <ul className="space-y-1.5">
        {status.topHotspots.map((h) => (
          <li
            key={h.path}
            className="flex items-baseline gap-3 text-sm"
          >
            <code className="flex-1 truncate text-gw-text">{h.path}</code>
            <span className="gw-mono text-xs text-gw-text-faint">
              {h.recentCommits} commits
            </span>
            <a
              href={`#risk`}
              onClick={(e) => {
                e.preventDefault();
                // Use the public hashchange path so App's listener picks it up.
                window.location.hash = 'risk';
              }}
              className="text-xs text-gw-accent underline decoration-dotted"
            >
              risk →
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-gw-text-faint">
        These files change most frequently — review their bus factor before
        landing big changes.
      </p>
    </Card>
  );
}

function MetaCard({ status }: { status: StatusResponse }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wider text-gw-text-faint">Index file</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
        <Stat label="size on disk" value={formatBytes(status.dbSizeBytes)} />
        <Stat label="initialized" value={status.initialized ? 'yes' : 'no'} />
      </dl>
    </Card>
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} kB`;
  return `${n} B`;
}
