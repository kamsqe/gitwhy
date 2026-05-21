import { useState } from 'react';
import { api, type RiskResponse } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PathAutocomplete } from '../ui/PathAutocomplete';
import { Spinner } from '../ui/Spinner';

export function RiskTab() {
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RiskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.risk({ path: path.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Risk assessment</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Pure SQL over indexed metadata. Bus factor, ownership share, hotspot status.
          No LLM call, instant.
        </p>
      </div>

      <PathInputCard
        label="File or directory path"
        placeholder="e.g. src/payment.ts or src/auth/"
        value={path}
        onChange={setPath}
        onSubmit={submit}
        loading={loading}
        buttonLabel="Analyze"
      />

      {error && <ErrorCard message={error} />}
      {result && <RiskView result={result} />}
    </div>
  );
}

function RiskView({ result }: { result: RiskResponse }) {
  const r = result.data.risk;
  const bf = result.data.busFactor;
  const levelStyles = {
    high: 'bg-red-900/30 text-red-300 border-red-800',
    medium: 'bg-amber-900/30 text-amber-300 border-amber-800',
    low: 'bg-emerald-900/30 text-emerald-300 border-emerald-800',
  };

  // No data for this path — render an explicit empty state rather than a
  // misleading default "medium 0.4" badge. The backend returns the same
  // default risk shape whether the file is missing or just outside the
  // indexed window; we trust `result.text` to explain which.
  if (r.inputs.totalCommits === 0) {
    return (
      <Card>
        <p className="text-xs uppercase tracking-wider text-gw-text-faint">
          No risk data
        </p>
        <code className="mt-2 block text-sm text-gw-text">{r.path}</code>
        <p className="mt-3 text-sm text-gw-text-dim">{result.text}</p>
        <p className="mt-3 text-xs text-gw-text-faint">
          Try running <code className="text-gw-text">gitwhy index</code> to expand
          the window, or verify the path exists in your repo.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${levelStyles[r.level]}`}
          >
            {r.level} risk
          </span>
          <span className="gw-mono text-xs text-gw-text-faint">
            score {r.score.toFixed(2)}
          </span>
        </div>
        <code className="mt-3 block text-sm text-gw-text">{r.path}</code>
        <ul className="mt-3 space-y-1.5 text-sm text-gw-text-dim">
          {r.reasons.map((reason, i) => (
            <li key={i}>• {reason}</li>
          ))}
        </ul>
      </Card>

      {bf.contributors.length > 0 && (
        <Card>
          <p className="mb-3 text-xs uppercase tracking-wider text-gw-text-faint">
            Ownership · bus factor {bf.busFactor} of {bf.contributors.length}
          </p>
          <BusFactorBar contributors={bf.contributors} />
          <ul className="mt-4 space-y-2 text-sm">
            {bf.contributors.slice(0, 6).map((c, i) => (
              <li
                key={c.authorEmail}
                className="flex items-center gap-3 text-gw-text-dim"
              >
                <span
                  className={`inline-block h-3 w-3 rounded-sm ${
                    i < bf.busFactor ? 'bg-gw-accent' : 'bg-gw-border'
                  }`}
                  aria-hidden
                />
                <span className="flex-1 text-gw-text">{c.authorName}</span>
                <span className="gw-mono text-xs">{formatShare(c.sharePercent)}</span>
                <span className="text-xs text-gw-text-faint">
                  last {c.lastCommit.slice(0, 10)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

/**
 * Format a sharePercent for display in the contributor list.
 * Tiny contributors (e.g. 0.4% on a heavily owned file) round to "0%" with
 * toFixed(0), which looks like a UI bug next to "1 commits". Show "<1%"
 * instead so they read as real-but-tiny.
 */
function formatShare(pct: number): string {
  if (pct < 1 && pct > 0) return '<1%';
  return `${pct.toFixed(0)}%`;
}

function BusFactorBar({
  contributors,
}: {
  contributors: Array<{ authorName: string; sharePercent: number }>;
}) {
  const palette = [
    '#2a6fc9',
    '#3a86d0',
    '#5a9adb',
    '#7daee5',
    '#9bbeec',
    '#b9cef3',
  ];
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-md border border-gw-border">
      {contributors.slice(0, 6).map((c, i) => (
        <div
          key={c.authorName + i}
          style={{
            width: `${Math.max(c.sharePercent, 0.5)}%`,
            background: palette[i] ?? '#1f2937',
          }}
          title={`${c.authorName} · ${c.sharePercent.toFixed(0)}%`}
        />
      ))}
    </div>
  );
}

export function PathInputCard({
  label,
  placeholder,
  value,
  onChange,
  onSubmit,
  loading,
  buttonLabel,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  loading: boolean;
  buttonLabel: string;
}) {
  return (
    <Card>
      <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
        {label}
      </label>
      <div className="mt-2 flex gap-2">
        <PathAutocomplete
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          placeholder={placeholder}
          disabled={loading}
        />
        <Button onClick={onSubmit} disabled={loading || !value.trim()}>
          {loading ? <Spinner size={14} /> : buttonLabel}
        </Button>
      </div>
    </Card>
  );
}

export function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="border-red-900 bg-red-950/40">
      <p className="text-sm text-red-300">
        <span className="font-medium">Error:</span> {message}
      </p>
    </Card>
  );
}
