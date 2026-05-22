import { useState } from 'react';
import { useIndexJob } from '../lib/useIndexJob';
import type { HealthResponse, IndexJob, IndexProgress } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

interface IndexTabProps {
  health: HealthResponse;
  onIndexed?: () => void;
}

/**
 * Live indexing — replaces the CLI `gitwhy index` for users who'd rather
 * stay in the browser. Streams /api/index/stream via EventSource and
 * shows a real-time progress bar + current commit + running cost.
 *
 * This is the same flow whether the repo has never been indexed (cold)
 * or already has an index that's incremental-friendly (warm). The
 * indexer itself dedupes against already-indexed hashes, so reruns are
 * idempotent.
 */
export function IndexTab({ health, onIndexed }: IndexTabProps) {
  const { job, progress, error, start, cancel, streaming } = useIndexJob();
  const [budgetInput, setBudgetInput] = useState('');
  const [fullReindex, setFullReindex] = useState(false);
  const [busy, setBusy] = useState(false);

  const onStart = async (): Promise<void> => {
    setBusy(true);
    try {
      const budget = budgetInput.trim() ? Number.parseFloat(budgetInput) : undefined;
      await start({
        ...(budget !== undefined && !Number.isNaN(budget) && budget > 0 && { budgetUsd: budget }),
        ...(fullReindex && { full: true }),
      });
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await cancel();
    } finally {
      setBusy(false);
    }
  };

  const isRunning = job?.state === 'running';
  const lastDone = job && job.state === 'done';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Index this repo</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Build the AI-enriched commit index from the browser. Same machinery
          as <code>gitwhy index</code> on the CLI — runs locally, your API key
          and repo data never leave this machine.
        </p>
      </div>

      {error && <ErrorCard message={error} />}

      {!isRunning && !lastDone && (
        <Card>
          <p className="text-sm text-gw-text-dim">
            Provider: <code className="text-gw-text">{health.provider}</code> ·
            indexing model: <code className="text-gw-text">{health.models.indexing}</code>
          </p>
          <p className="mt-3 text-sm text-gw-text-dim">
            Override these by setting <code>GEMINI_API_KEY</code> /{' '}
            <code>OPENAI_API_KEY</code> before starting <code>gitwhy serve</code>,
            or run <code>gitwhy init</code> to switch providers.
          </p>
          <label className="mt-4 block text-xs uppercase tracking-wider text-gw-text-faint">
            Budget cap (optional, USD)
          </label>
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={budgetInput}
              onChange={(e) => setBudgetInput(e.target.value)}
              placeholder="e.g. 0.50  (skip to use default)"
              className="flex-1 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={busy}
            />
            <Button onClick={() => void onStart()} disabled={busy}>
              {busy ? <Spinner size={14} /> : 'Start indexing'}
            </Button>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs text-gw-text-dim">
            <input
              type="checkbox"
              checked={fullReindex}
              onChange={(e) => setFullReindex(e.target.checked)}
              disabled={busy}
              className="accent-gw-accent"
            />
            <span>
              Full re-walk (default is <em>incremental</em> — only new commits since last
              index). Use this after force-push, rebase, or to refresh stale enrichments.
            </span>
          </label>
          <p className="mt-3 text-xs text-gw-text-faint">
            Tip: hit the{' '}
            <a href="#estimate" className="text-gw-accent underline decoration-dotted">
              Estimate tab
            </a>{' '}
            first to preview cost.
          </p>
        </Card>
      )}

      {isRunning && progress && (
        <RunningView progress={progress} onCancel={() => void onCancel()} busy={busy} streaming={streaming} />
      )}

      {job && (job.state === 'done' || job.state === 'cancelled' || job.state === 'failed') && (
        <ResultView job={job} onRestart={() => start({})} onIndexed={onIndexed} />
      )}
    </div>
  );
}

function RunningView({
  progress,
  onCancel,
  busy,
  streaming,
}: {
  progress: IndexProgress;
  onCancel: () => void;
  busy: boolean;
  streaming: boolean;
}) {
  const pct = progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;
  return (
    <Card>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <Spinner size={14} />
          <span className="text-gw-text">Indexing in progress</span>
          {!streaming && (
            <span className="text-xs text-amber-300" title="Stream disconnected — values may be stale">
              · reconnecting…
            </span>
          )}
        </div>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>

      <div className="mt-4">
        <div className="flex items-baseline justify-between text-xs text-gw-text-faint">
          <span>
            <span className="gw-mono text-gw-text">{progress.processed.toLocaleString()}</span> of{' '}
            <span className="gw-mono text-gw-text">{progress.total.toLocaleString()}</span> commits
          </span>
          <span className="gw-mono text-gw-text">{pct}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-gw-border">
          <div
            className="h-full bg-gw-accent transition-all"
            style={{ width: `${Math.max(pct, 1)}%` }}
          />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label="enriched" value={progress.enriched.toLocaleString()} />
        <Stat label="skipped" value={progress.skipped.toLocaleString()} />
        <Stat
          label="errors"
          value={progress.errors.toLocaleString()}
          tone={progress.errors > 0 ? 'warn' : undefined}
        />
        <Stat label="spent" value={`$${progress.costUsd.toFixed(3)}`} />
      </dl>

      {progress.currentHash && (
        <p className="mt-3 truncate text-xs text-gw-text-faint">
          processing{' '}
          <code className="gw-mono text-gw-text-dim">{progress.currentHash.slice(0, 12)}</code>
        </p>
      )}
    </Card>
  );
}

function ResultView({
  job,
  onRestart,
  onIndexed,
}: {
  job: IndexJob;
  onRestart: () => void;
  onIndexed?: () => void;
}) {
  const isDone = job.state === 'done';
  const tone = isDone
    ? 'border-emerald-900 bg-emerald-950/30'
    : job.state === 'cancelled'
      ? 'border-amber-900 bg-amber-950/30'
      : 'border-red-900 bg-red-950/30';

  const summary = job.result?.progress;

  return (
    <Card className={tone}>
      <p className="text-xs uppercase tracking-wider text-gw-text-faint">
        Last job — {job.state}
      </p>
      {summary && (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label="processed" value={summary.processed.toLocaleString()} />
          <Stat label="enriched" value={summary.enriched.toLocaleString()} />
          <Stat
            label="errors"
            value={summary.errors.toLocaleString()}
            tone={summary.errors > 0 ? 'warn' : undefined}
          />
          <Stat label="cost" value={`$${summary.costUsd.toFixed(3)}`} />
        </dl>
      )}
      {job.result?.stoppedReason === 'budget' && (
        <p className="mt-3 text-sm text-amber-200">
          Stopped early: budget cap reached. Rerun with a higher budget to continue.
        </p>
      )}
      {job.error && (
        <p className="mt-3 text-sm text-red-300">
          <span className="font-medium">Error:</span> {job.error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void onRestart()}>
          {isDone ? 'Re-index' : 'Try again'}
        </Button>
        {isDone && onIndexed && (
          <Button variant="ghost" onClick={() => onIndexed()}>
            Refresh app state
          </Button>
        )}
      </div>
    </Card>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn';
}) {
  return (
    <div>
      <dt className="text-xs text-gw-text-faint">{label}</dt>
      <dd className={`gw-mono ${tone === 'warn' ? 'text-amber-300' : 'text-gw-text'}`}>{value}</dd>
    </div>
  );
}
