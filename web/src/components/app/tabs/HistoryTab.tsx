import { useState } from 'react';
import { api, type SimpleTextResponse } from '../lib/api';
import { Card } from '../ui/Card';
import { ErrorCard, PathInputCard } from './RiskTab';

export function HistoryTab() {
  const [path, setPath] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimpleTextResponse | null>(null);
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
          Timeline of commits that touched a file or directory, with AI-enriched summaries.
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
        <Card>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">
            <code>{result.text}</code>
          </pre>
        </Card>
      )}
    </div>
  );
}
