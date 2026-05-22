import { useState } from 'react';
import { api } from '../lib/api';
import { Spinner } from './Spinner';

interface DiffViewerProps {
  hash: string;
  /** Optional className passed to the toggle button's container. */
  className?: string;
}

/**
 * Collapsible inline diff viewer for a commit hash. Used inside citation
 * cards so users can verify a model's claim against the actual diff —
 * the core trust primitive for AI-synthesized answers.
 *
 * State machine: idle → loading → (loaded | error).
 * Caches the loaded diff in component state so re-opening the same
 * citation is instant. We don't preserve state across remounts on
 * purpose — keeping it light, no global cache.
 */
export function DiffViewer({ hash, className = '' }: DiffViewerProps) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'loaded'; diff: string; truncated: boolean; maxBytes: number }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [open, setOpen] = useState(false);

  const toggle = (): void => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    if (state.kind === 'idle' || state.kind === 'error') {
      void load();
    }
  };

  const load = async (): Promise<void> => {
    setState({ kind: 'loading' });
    try {
      const res = await api.diff({ hash });
      setState({ kind: 'loaded', diff: res.diff, truncated: res.truncated, maxBytes: res.maxBytes });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  return (
    <div className={`mt-2 ${className}`}>
      <button
        type="button"
        onClick={toggle}
        className="inline-flex items-center gap-1.5 text-xs text-gw-accent underline decoration-dotted hover:decoration-solid"
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span>
        {open ? 'Hide diff' : 'Show diff'}
      </button>

      {open && state.kind === 'loading' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-gw-text-dim">
          <Spinner size={12} />
          <span>loading diff…</span>
        </div>
      )}

      {open && state.kind === 'error' && (
        <div className="mt-2 rounded-md border border-red-900/60 bg-red-950/30 px-3 py-2 text-xs">
          <p className="text-red-300">
            <span className="font-medium">Could not load diff:</span> {state.message}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-1 text-xs text-gw-accent underline decoration-dotted"
          >
            Retry
          </button>
        </div>
      )}

      {open && state.kind === 'loaded' && (
        <div className="mt-2 overflow-hidden rounded-md border border-gw-border bg-gw-surface-2">
          <pre className="overflow-x-auto px-3 py-2 text-[11px] leading-relaxed">
            <code>{renderDiff(state.diff)}</code>
          </pre>
          {state.truncated && (
            <p className="border-t border-gw-border bg-gw-surface px-3 py-1.5 text-[10px] text-gw-text-faint">
              Diff truncated at {Math.round(state.maxBytes / 1024)} KB. Use{' '}
              <code className="text-gw-text-dim">git show {hash.slice(0, 7)}</code> in your
              terminal for the full output.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Render a unified-diff string with per-line colorization. Plain JSX
 * spans rather than a real syntax-highlight library — keeps the bundle
 * small and the result legible.
 */
function renderDiff(text: string): React.ReactNode {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    let cls = 'text-gw-text-dim';
    if (line.startsWith('diff --git') || line.startsWith('index ')) cls = 'text-gw-text-faint';
    else if (line.startsWith('@@')) cls = 'text-gw-accent';
    else if (line.startsWith('+++') || line.startsWith('---')) cls = 'text-gw-text font-medium';
    else if (line.startsWith('+')) cls = 'text-emerald-300';
    else if (line.startsWith('-')) cls = 'text-red-300';
    return (
      <span key={i} className={`block ${cls}`}>
        {line || ' '}
      </span>
    );
  });
}
