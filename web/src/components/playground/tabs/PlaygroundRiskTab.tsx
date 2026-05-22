import { useState } from 'react';
import type { RiskResponse } from '../../app/lib/api';
import type { PlaygroundApi } from '../lib/playgroundApi';
import { Button } from '../../app/ui/Button';
import { Card } from '../../app/ui/Card';
import { PlaygroundPathInput } from './PlaygroundPathInput';

export function PlaygroundRiskTab({ api }: { api: PlaygroundApi }) {
  const [path, setPath] = useState('');
  const [result, setResult] = useState<RiskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (!path.trim()) return;
    setError(null);
    try {
      setResult(api.risk({ path: path.trim() }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Risk assessment</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Pure SQL over indexed metadata. Bus factor, ownership share, hotspot
          status. Try <code>src/middleware/persist.ts</code> or{' '}
          <code>docs/reference/middlewares/persist.md</code>.
        </p>
      </div>

      <Card>
        <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
          File or directory path
        </label>
        <div className="mt-2 flex gap-2">
          <PlaygroundPathInput
            api={api}
            value={path}
            onChange={setPath}
            onSubmit={submit}
            placeholder="e.g. src/middleware/persist.ts"
          />
          <Button onClick={submit} disabled={!path.trim()}>
            Analyze
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="border-red-900 bg-red-950/40">
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      )}

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

  if (r.inputs.totalCommits === 0) {
    return (
      <Card>
        <p className="text-xs uppercase tracking-wider text-gw-text-faint">No risk data</p>
        <code className="mt-2 block text-sm text-gw-text">{r.path}</code>
        <p className="mt-3 text-sm text-gw-text-dim">{result.text}</p>
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
          <span className="gw-mono text-xs text-gw-text-faint">score {r.score.toFixed(2)}</span>
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
                <span className="gw-mono text-xs">
                  {c.sharePercent < 1 && c.sharePercent > 0 ? '<1%' : `${c.sharePercent.toFixed(0)}%`}
                </span>
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

function BusFactorBar({
  contributors,
}: {
  contributors: Array<{ authorName: string; sharePercent: number }>;
}) {
  const palette = ['#2a6fc9', '#3a86d0', '#5a9adb', '#7daee5', '#9bbeec', '#b9cef3'];
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
