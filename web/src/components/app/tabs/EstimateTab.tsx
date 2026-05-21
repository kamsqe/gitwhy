import { useState } from 'react';
import { api, type EstimateResponse } from '../lib/api';
import { formatElapsedHint, useElapsed } from '../lib/useElapsed';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

/**
 * Surfaces /api/estimate — projects what `gitwhy index` will cost in
 * LLM tokens and dollars before the user actually spends anything.
 * The endpoint walks the entire git log and classifies commits (normal,
 * micro, mega, merge, bot, revert, initial), so on big repos it can
 * take 10-20s. That's why we lean on the elapsed-time indicator.
 */
export function EstimateTab() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<EstimateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsedHint = formatElapsedHint(useElapsed(loading));

  const submit = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.estimate());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Estimate indexing cost</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Dry-run cost projection before committing to <code>gitwhy index</code>.
          No LLM calls. On large repos this can take ~10-20s to walk the git log
          and classify every commit.
        </p>
      </div>

      <Card>
        <p className="text-sm text-gw-text-dim">
          Projects the cost of indexing the full git history with your current
          configured model. Use this to budget before running{' '}
          <code className="text-gw-text">gitwhy index</code>.
        </p>
        <div className="mt-4">
          <Button onClick={() => void submit()} disabled={loading}>
            {loading ? (
              <>
                <Spinner size={14} />
                Walking git log…{elapsedHint && <span className="ml-2 gw-mono opacity-70">{elapsedHint}</span>}
              </>
            ) : (
              'Run estimate'
            )}
          </Button>
        </div>
      </Card>

      {error && <ErrorCard message={error} />}

      {result && <EstimateView result={result} />}
    </div>
  );
}

function EstimateView({ result }: { result: EstimateResponse }) {
  // Sort categories by descending cost so users see the cost drivers first.
  const sorted = [...result.byCategory].sort((a, b) => b.estimatedUsd - a.estimatedUsd);
  const planned = result.grandTotal.llmCallsPlanned;
  const skipped = result.byCategory
    .filter((c) => c.llmCallsPlanned === 0)
    .reduce((acc, c) => acc + c.count, 0);

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-xs uppercase tracking-wider text-gw-text-faint">Grand total</p>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <span className="gw-mono text-3xl font-semibold text-gw-text">
            ${result.grandTotal.usd.toFixed(2)}
          </span>
          <span className="text-sm text-gw-text-dim">
            using <code className="text-gw-text">{result.enrichmentModel}</code>
          </span>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Stat label="commits" value={result.totalCommits.toLocaleString()} />
          <Stat label="LLM calls" value={planned.toLocaleString()} />
          <Stat
            label="prompt tokens"
            value={formatTokens(result.grandTotal.promptTokens)}
          />
          <Stat
            label="completion"
            value={formatTokens(result.grandTotal.completionTokens)}
          />
        </dl>
        {skipped > 0 && (
          <p className="mt-3 text-xs text-gw-text-faint">
            {skipped.toLocaleString()} commit{skipped === 1 ? '' : 's'} skipped
            free (bots, merges, micro-changes, reverts, initial).
          </p>
        )}
      </Card>

      <Card>
        <p className="mb-3 text-xs uppercase tracking-wider text-gw-text-faint">
          By category
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gw-text-faint">
                <th className="pb-2 pr-3 font-medium">Category</th>
                <th className="pb-2 pr-3 text-right font-medium">Commits</th>
                <th className="pb-2 pr-3 text-right font-medium">Calls</th>
                <th className="pb-2 pr-3 text-right font-medium">Tokens</th>
                <th className="pb-2 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gw-border">
              {sorted.map((cat) => {
                const totalTokens =
                  cat.estimatedPromptTokens + cat.estimatedCompletionTokens;
                const isFree = cat.llmCallsPlanned === 0;
                return (
                  <tr key={cat.category} className={isFree ? 'opacity-50' : ''}>
                    <td className="py-2 pr-3 text-gw-text">
                      {cat.category}
                    </td>
                    <td className="py-2 pr-3 gw-mono text-right text-gw-text-dim">
                      {cat.count.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 gw-mono text-right text-gw-text-dim">
                      {isFree ? '—' : cat.llmCallsPlanned.toLocaleString()}
                    </td>
                    <td className="py-2 pr-3 gw-mono text-right text-gw-text-dim">
                      {isFree ? '—' : formatTokens(totalTokens)}
                    </td>
                    <td className="py-2 gw-mono text-right text-gw-text">
                      {isFree ? '$0.00' : `$${cat.estimatedUsd.toFixed(3)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="border-gw-accent/30 bg-gw-accent/5">
        <p className="text-sm text-gw-text-dim">
          Ready to commit? Run this in your repo:
        </p>
        <pre className="mt-2"><code>{`gitwhy index --budget ${result.grandTotal.usd.toFixed(2)}`}</code></pre>
        <p className="mt-2 text-xs text-gw-text-faint">
          The <code>--budget</code> flag is a hard cap. Indexing stops if cost
          exceeds it, so you can't accidentally spend more than this estimate.
        </p>
      </Card>
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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
