import { useState } from 'react';
import { api, type SimpleTextResponse } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

const PRESETS = [
  '1 week ago',
  '2 weeks ago',
  '1 month ago',
  '3 months ago',
  '6 months ago',
];

export function CatchupTab() {
  const [since, setSince] = useState('1 month ago');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimpleTextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (value: string): Promise<void> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.catchup({ since: value, limit: 100 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">What happened recently</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Narrated summary of recent activity, grouped by category.
          Bots filtered, micros clustered, megas decomposed.
        </p>
      </div>

      <Card>
        <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
          Look back
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                setSince(p);
                void submit(p);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                since === p
                  ? 'border-gw-accent bg-gw-accent/15 text-gw-text'
                  : 'border-gw-border text-gw-text-dim hover:border-gw-text-faint'
              }`}
              disabled={loading}
            >
              {p}
            </button>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={since}
            onChange={(e) => setSince(e.target.value)}
            placeholder='ISO date or "1 week ago"'
            className="flex-1 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono outline-none focus:border-gw-accent"
          />
          <Button onClick={() => void submit(since)} disabled={loading}>
            {loading ? <Spinner size={14} /> : 'Show'}
          </Button>
        </div>
      </Card>

      {error && <ErrorCard message={error} />}

      {result && (
        <Card>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">
            <code>{result.text}</code>
          </pre>
        </Card>
      )}
    </div>
  );
}
