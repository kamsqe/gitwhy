import { useEffect, useState } from 'react';
import { PlaygroundShell } from './PlaygroundShell';
import { openRemoteDatabase } from './lib/sqljs';
import type { Database } from 'sql.js';

/**
 * Available demo databases. Each is a pre-indexed gitwhy SQLite file
 * shipped as a static asset alongside the playground page. We list
 * size + commit-count up front so users can decide whether to wait
 * for the download.
 */
interface Demo {
  id: string;
  name: string;
  description: string;
  url: string;
  approxSizeMb: number;
  commits: number;
}

const DEMOS: Demo[] = [
  {
    id: 'zustand',
    name: 'zustand',
    description:
      'Modern React state-management library by Daishi Kato — small index, demonstrates bus-factor risk patterns and recent maintenance activity.',
    url: '/playground/zustand.db',
    approxSizeMb: 1.2,
    commits: 88,
  },
];

// Repos that are queued / mid-indexing but not yet available in the playground.
// Surfaced separately so the page can announce upcoming demos without listing
// non-existent .db files that would 404.
interface PendingDemo {
  name: string;
  description: string;
  approxCommits: number;
  note: string;
}
const PENDING_DEMOS: PendingDemo[] = [
  {
    name: 'express',
    description: 'Node.js classic web framework. Full history since 2009.',
    approxCommits: 6146,
    note: 'Indexing in progress — full history takes a few hours on free-tier Gemini.',
  },
];

export function Playground() {
  const [selected, setSelected] = useState<string | null>(null);
  const [db, setDb] = useState<Database | null>(null);
  const [loadingState, setLoadingState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const demo = DEMOS.find((d) => d.id === selected) ?? null;

  useEffect(() => {
    if (!demo) return;
    setLoadingState('loading');
    setError(null);
    openRemoteDatabase(demo.url)
      .then((d) => {
        setDb(d);
        setLoadingState('ready');
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoadingState('error');
      });
    return () => {
      // Close previous DB if user switches demos.
      setDb((prev) => {
        prev?.close();
        return null;
      });
    };
  }, [demo]);

  if (!selected || !demo) {
    return <DemoPicker demos={DEMOS} onSelect={setSelected} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <PlaygroundHeader demo={demo} onChange={() => setSelected(null)} loadingState={loadingState} />
      {loadingState === 'loading' && <LoadingView demo={demo} />}
      {loadingState === 'error' && <ErrorView message={error ?? 'Unknown error'} />}
      {loadingState === 'ready' && db && <ReadyView db={db} demo={demo} />}
    </div>
  );
}

function DemoPicker({ demos, onSelect }: { demos: Demo[]; onSelect: (id: string) => void }) {
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-3xl font-semibold">GitWhy Playground</h1>
        <p className="mt-2 text-gw-text-dim">
          Pick a pre-indexed repository to explore. Everything runs in your
          browser via WebAssembly SQLite — no install, no backend, no upload of
          your data. Queries stay on this tab.
        </p>
      </div>

      <div className="space-y-3">
        {demos.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id)}
            className="flex w-full flex-col items-start gap-2 rounded-lg border border-gw-border bg-gw-surface p-4 text-left transition-colors hover:border-gw-accent hover:bg-gw-surface-2"
          >
            <div className="flex w-full items-baseline justify-between">
              <span className="text-lg font-semibold text-gw-text">{d.name}</span>
              <span className="gw-mono text-xs text-gw-text-faint">
                {d.commits.toLocaleString()} commits · ~{d.approxSizeMb} MB
              </span>
            </div>
            <p className="text-sm text-gw-text-dim">{d.description}</p>
          </button>
        ))}

        {PENDING_DEMOS.map((d) => (
          <div
            key={d.name}
            className="flex w-full flex-col items-start gap-2 rounded-lg border border-gw-border bg-gw-surface/50 p-4 opacity-60"
          >
            <div className="flex w-full items-baseline justify-between">
              <span className="text-lg font-semibold text-gw-text-dim">{d.name}</span>
              <span className="gw-mono text-xs text-gw-text-faint">
                ~{d.approxCommits.toLocaleString()} commits · indexing
              </span>
            </div>
            <p className="text-sm text-gw-text-dim">{d.description}</p>
            <p className="text-xs italic text-gw-text-faint">{d.note}</p>
          </div>
        ))}
      </div>

      <p className="text-xs text-gw-text-faint">
        Want to use GitWhy on <em>your own</em> repository? Use the{' '}
        <a href="/app/" className="text-gw-accent underline decoration-dotted">
          local app
        </a>{' '}
        instead — it talks to a gitwhy server running on your machine, so your
        code never leaves your laptop.
      </p>
    </div>
  );
}

function PlaygroundHeader({
  demo,
  onChange,
  loadingState,
}: {
  demo: Demo;
  onChange: () => void;
  loadingState: 'idle' | 'loading' | 'ready' | 'error';
}) {
  return (
    <header className="sticky top-0 z-10 border-b border-gw-border bg-gw-surface/95 backdrop-blur">
      <div className="flex items-center gap-4 px-6 py-3">
        <a
          href="/"
          className="flex items-center gap-2 text-gw-text no-underline hover:opacity-80"
        >
          <span className="inline-block h-6 w-6 rounded-full bg-gw-accent" aria-hidden />
          <span className="font-semibold">GitWhy</span>
          <span className="text-xs text-gw-text-faint">playground</span>
        </a>
        <div className="flex items-center gap-2 text-xs">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              loadingState === 'ready'
                ? 'bg-emerald-500'
                : loadingState === 'error'
                  ? 'bg-red-500'
                  : 'bg-amber-500'
            }`}
            aria-hidden
          />
          <span className="text-gw-text-dim">
            {loadingState === 'ready' ? 'loaded' : loadingState === 'error' ? 'error' : 'loading…'}
          </span>
          <span className="text-gw-text-faint">·</span>
          <span className="gw-mono text-gw-text-faint">{demo.name}</span>
        </div>
        <button
          type="button"
          onClick={onChange}
          className="ml-auto text-xs text-gw-text-faint underline decoration-dotted hover:text-gw-text-dim"
        >
          change repo
        </button>
      </div>
    </header>
  );
}

function LoadingView({ demo }: { demo: Demo }) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8 text-center">
      <p className="text-lg text-gw-text">Downloading {demo.name} index…</p>
      <p className="text-sm text-gw-text-dim">
        ~{demo.approxSizeMb} MB. This is a one-time download and runs entirely
        in your browser after that.
      </p>
      <div className="mx-auto h-1 w-48 overflow-hidden rounded-full bg-gw-border">
        <div className="h-full animate-pulse bg-gw-accent" />
      </div>
    </div>
  );
}

function ErrorView({ message }: { message: string }) {
  return (
    <div className="mx-auto max-w-xl space-y-4 p-8">
      <p className="text-lg text-red-300">Couldn't load the demo database</p>
      <p className="gw-mono text-xs text-gw-text-faint">{message}</p>
      <p className="text-sm text-gw-text-dim">
        Try reloading the page, or check the browser console for details.
      </p>
    </div>
  );
}

function ReadyView({ db, demo }: { db: Database; demo: Demo }) {
  return <PlaygroundShell db={db} demoName={demo.name} />;
}
