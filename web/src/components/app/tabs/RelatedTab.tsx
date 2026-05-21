import { useState } from 'react';
import { api, type RelatedResponse } from '../lib/api';
import { Card } from '../ui/Card';
import { ErrorCard, PathInputCard } from './RiskTab';

export function RelatedTab() {
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RelatedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!path.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.related({ path: path.trim(), minCoCommits: 1 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Co-changing files</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Which files historically change together with the file you're about to edit.
          Forward confidence = probability the other file changes when this one does.
        </p>
      </div>

      <PathInputCard
        label="File path"
        placeholder="e.g. src/payment.ts"
        value={path}
        onChange={setPath}
        onSubmit={submit}
        loading={loading}
        buttonLabel="Find related"
      />

      {error && <ErrorCard message={error} />}

      {result && (
        <Card>
          {result.data.length === 0 ? (
            <p className="text-sm text-gw-text-dim">{result.text}</p>
          ) : (
            <ul className="space-y-2">
              {result.data.map((rel) => {
                const conf = Math.round(rel.forwardConfidence * 100);
                return (
                  <li
                    key={rel.path}
                    className="flex items-center gap-3 rounded-md border border-gw-border bg-gw-surface px-3 py-2"
                  >
                    <code className="flex-1 text-sm text-gw-text">{rel.path}</code>
                    <span className="text-xs text-gw-text-faint">
                      {rel.coCommits}/{rel.thisFileCommits} commits
                    </span>
                    <div className="flex w-24 items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-gw-border">
                        <div
                          className="h-full rounded-full bg-gw-accent"
                          style={{ width: `${conf}%` }}
                        />
                      </div>
                      <span className="gw-mono w-8 text-right text-xs text-gw-text">
                        {conf}%
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}
