import { useState } from 'react';
import type { RelatedResponse } from '../../app/lib/api';
import type { PlaygroundApi } from '../lib/playgroundApi';
import { Button } from '../../app/ui/Button';
import { Card } from '../../app/ui/Card';
import { PlaygroundPathInput } from './PlaygroundPathInput';

export function PlaygroundRelatedTab({ api }: { api: PlaygroundApi }) {
  const [path, setPath] = useState('');
  const [result, setResult] = useState<RelatedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (!path.trim()) return;
    setError(null);
    try {
      setResult(api.related({ path: path.trim(), minCoCommits: 1 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setResult(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Co-changing files</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Which files historically change together with the file you're about
          to edit. Forward confidence = probability the other file changes when
          this one does.
        </p>
      </div>

      <Card>
        <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
          File path
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
            Find related
          </Button>
        </div>
      </Card>

      {error && (
        <Card className="border-red-900 bg-red-950/40">
          <p className="text-sm text-red-300">{error}</p>
        </Card>
      )}

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
