import { useState } from 'react';
import { api, type SearchResponse } from '../lib/api';
import { formatElapsedHint, useElapsed } from '../lib/useElapsed';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DiffViewer } from '../ui/DiffViewer';
import { MegaDecompositionView } from '../ui/MegaDecompositionView';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

export function SearchTab() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsedHint = formatElapsedHint(useElapsed(loading));

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
          Ranked search over AI-enriched commit summaries. Returns raw hits —
          for synthesized answers with reasoning, use Ask.
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
            className="flex-1 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm focus:border-gw-accent"
            disabled={loading}
          />
          <Button onClick={() => void submit()} disabled={loading || !query.trim()}>
            {loading ? (
              <>
                <Spinner size={14} />
                {elapsedHint && <span className="ml-2 gw-mono opacity-70">{elapsedHint}</span>}
              </>
            ) : (
              'Search'
            )}
          </Button>
        </div>
      </Card>

      {error && <ErrorCard message={error} />}

      {result && (
        result.data.length === 0 ? (
          <Card>
            <p className="text-sm text-gw-text-dim">{result.text}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-gw-text-faint">
              {result.data.length} commit{result.data.length === 1 ? '' : 's'} ranked by semantic similarity
            </p>
            {result.data.map((hit) => (
              <Card key={hit.commitHash} className="!p-3">
                <div className="flex items-baseline gap-3 text-xs">
                  <code className="rounded bg-gw-accent/15 px-1.5 py-0.5 text-gw-accent">
                    {hit.shortHash}
                  </code>
                  <span className="text-gw-text-dim">{hit.authorName}</span>
                  <span className="text-gw-text-faint">·</span>
                  <span className="text-gw-text-faint">{hit.date.slice(0, 10)}</span>
                  <span className="ml-auto gw-mono text-gw-text-faint">
                    {(hit.score * 100).toFixed(0)}% similar
                  </span>
                </div>
                {hit.enrichedSummary ? (
                  <MegaDecompositionView
                    enrichedSummary={hit.enrichedSummary}
                    category={hit.category}
                  />
                ) : (
                  <p className="mt-2 text-sm italic text-gw-text-dim">
                    {hit.originalMessage.split('\n', 1)[0]}
                  </p>
                )}
                <DiffViewer hash={hit.commitHash} />
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
