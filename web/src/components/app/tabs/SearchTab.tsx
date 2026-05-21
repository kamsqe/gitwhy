import { useState } from 'react';
import { api, type SimpleTextResponse } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

export function SearchTab() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimpleTextResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.search({ query: query.trim(), topK: 10 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Semantic search</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Ranked search over AI-enriched commit summaries. Returns raw hits — for synthesized answers, use Ask.
        </p>
      </div>

      <Card>
        <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
          Query
        </label>
        <div className="mt-2 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            placeholder='e.g. "dependency updates" or "timeout handling"'
            className="flex-1 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm outline-none focus:border-gw-accent"
            disabled={loading}
          />
          <Button onClick={() => void submit()} disabled={loading || !query.trim()}>
            {loading ? <Spinner size={14} /> : 'Search'}
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
