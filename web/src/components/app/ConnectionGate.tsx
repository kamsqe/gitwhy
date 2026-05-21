import { useState } from 'react';
import { getBackendUrl, setBackendUrl } from './lib/api';
import { Button } from './ui/Button';
import { Card } from './ui/Card';
import { Spinner } from './ui/Spinner';
import type { BackendStatus } from './lib/useBackend';

interface ConnectionGateProps {
  status: BackendStatus;
  onRefresh: () => void;
}

export function ConnectionGate({ status, onRefresh }: ConnectionGateProps) {
  const [urlDraft, setUrlDraft] = useState(getBackendUrl());
  const [showSettings, setShowSettings] = useState(false);

  if (status.kind === 'checking') {
    return (
      <CenteredScreen>
        <div className="flex flex-col items-center gap-3">
          <Spinner size={32} />
          <p className="text-gw-text-dim">looking for local backend…</p>
          <p className="gw-mono text-xs text-gw-text-faint">{getBackendUrl()}</p>
        </div>
      </CenteredScreen>
    );
  }

  return (
    <CenteredScreen>
      <Card className="w-full max-w-2xl">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-500" aria-hidden />
          <h2 className="text-lg font-semibold">Local backend not running</h2>
        </div>

        <p className="mt-3 text-sm text-gw-text-dim">
          The web UI talks to a local <code>gitwhy</code> server on your machine.
          That's how your repo data and LLM API key never leave your computer.
          Start the server from inside your repository:
        </p>

        <pre className="mt-3"><code>{`# inside your git repo
npx gitwhy serve

# or globally
gitwhy serve --port 3787`}</code></pre>

        <p className="mt-3 text-sm text-gw-text-dim">
          Once it's running you'll see <code className="text-gw-text">listening on http://127.0.0.1:3787</code>. Then click below.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={onRefresh}>Retry connection</Button>
          <Button variant="ghost" onClick={() => setShowSettings((v) => !v)}>
            {showSettings ? 'Hide' : 'Change'} backend URL
          </Button>
        </div>

        {showSettings && (
          <div className="mt-4 rounded-md border border-gw-border bg-gw-surface p-3">
            <label className="block text-xs uppercase tracking-wider text-gw-text-dim">
              Backend URL
            </label>
            <div className="mt-2 flex gap-2">
              <input
                type="text"
                value={urlDraft}
                onChange={(e) => setUrlDraft(e.target.value)}
                className="flex-1 rounded-md border border-gw-border bg-gw-surface px-3 py-1.5 text-sm gw-mono"
                placeholder="http://127.0.0.1:3787"
              />
              <Button
                variant="secondary"
                onClick={() => {
                  setBackendUrl(urlDraft);
                  onRefresh();
                }}
              >
                Save
              </Button>
            </div>
            <p className="mt-2 text-xs text-gw-text-faint">
              Persisted to localStorage. Default: <code>http://127.0.0.1:3787</code>
            </p>
          </div>
        )}

        <details className="mt-4">
          <summary className="cursor-pointer text-xs text-gw-text-faint hover:text-gw-text-dim">
            Why this design?
          </summary>
          <p className="mt-2 text-xs text-gw-text-dim leading-relaxed">
            GitWhy uses "Bring Your Own Backend" — the heavy lifting (git access,
            SQLite index, LLM calls with your API key) runs locally on your
            machine. The page you're looking at is just a UI shell. Nothing
            about your code or credentials ever touches{' '}
            <code className="text-gw-text">gitwhy.pages.dev</code>.
          </p>
        </details>

        {status.kind === 'offline' && (
          <p className="mt-4 gw-mono text-xs text-gw-text-faint">
            error: {status.error}
          </p>
        )}
      </Card>
    </CenteredScreen>
  );
}

function CenteredScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}
