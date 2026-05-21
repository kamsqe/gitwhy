import { useState } from 'react';
import { api, type HistoryCommit, type HistoryResponse } from '../lib/api';
import { Card } from '../ui/Card';
import { ErrorCard, PathInputCard } from './RiskTab';

export function HistoryTab() {
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.history({ path: path.trim(), limit: 20 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">File history</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Timeline of commits that touched a file or directory, most recent
          first. Each row shows the AI-enriched summary when available.
        </p>
      </div>

      <PathInputCard
        label="File or directory path"
        placeholder="e.g. src/payment.ts or src/auth/"
        value={path}
        onChange={setPath}
        onSubmit={submit}
        loading={loading}
        buttonLabel="Show history"
      />

      {error && <ErrorCard message={error} />}

      {result && (
        result.data.length === 0 ? (
          <Card>
            <p className="text-sm text-gw-text-dim">{result.text}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-gw-text-faint">
              {result.data.length} commit{result.data.length === 1 ? '' : 's'} for{' '}
              <code className="text-gw-text">{path.trim()}</code>
            </p>
            {result.data.map((c) => (
              <CommitCard key={c.commitHash} commit={c} />
            ))}
          </div>
        )
      )}
    </div>
  );
}

function CommitCard({ commit }: { commit: HistoryCommit }) {
  return (
    <Card className="!p-3">
      <div className="flex items-baseline gap-3 text-xs">
        <code className="rounded bg-gw-accent/15 px-1.5 py-0.5 text-gw-accent">
          {commit.shortHash}
        </code>
        <span className="text-gw-text-dim">{commit.authorName}</span>
        <span className="text-gw-text-faint">·</span>
        <span className="text-gw-text-faint">{commit.date.slice(0, 10)}</span>
        <CategoryBadge category={commit.category} />
      </div>
      {commit.enrichedSummary && (
        <p className="mt-2 text-sm leading-relaxed text-gw-text">
          {commit.enrichedSummary}
        </p>
      )}
      <p className={`text-xs italic ${commit.enrichedSummary ? 'mt-2 text-gw-text-faint' : 'mt-2 text-gw-text-dim'}`}>
        {commit.originalMessage.split('\n', 1)[0]}
      </p>
    </Card>
  );
}

/**
 * Categories come from the indexer (micro/normal/mega/merge/bot/revert/initial).
 * Tinted so unusual categories pop visually — mega + revert are the most
 * interesting to spot in a timeline.
 */
function CategoryBadge({ category }: { category: string }) {
  const styles: Record<string, string> = {
    mega: 'border-amber-800 bg-amber-900/30 text-amber-300',
    revert: 'border-red-800 bg-red-900/30 text-red-300',
    bot: 'border-gw-border bg-gw-surface text-gw-text-faint',
    merge: 'border-gw-border bg-gw-surface text-gw-text-faint',
    micro: 'border-gw-border bg-gw-surface text-gw-text-faint',
    initial: 'border-emerald-800 bg-emerald-900/30 text-emerald-300',
    normal: 'border-gw-border bg-gw-surface-2 text-gw-text-dim',
  };
  const cls = styles[category] ?? styles['normal'];
  return (
    <span className={`ml-auto rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      {category}
    </span>
  );
}
