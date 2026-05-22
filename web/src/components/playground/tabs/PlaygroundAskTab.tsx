import { useEffect, useState } from 'react';
import type { WhyResponse } from '../../app/lib/api';
import type { PlaygroundApi } from '../lib/playgroundApi';
import { formatElapsedHint, useElapsed } from '../../app/lib/useElapsed';
import { clearStoredKey, getStoredKey, setStoredKey } from '../lib/geminiClient';
import { Button } from '../../app/ui/Button';
import { Card } from '../../app/ui/Card';
import { ConfidenceBadge } from '../../app/ui/ConfidenceBadge';
import { Spinner } from '../../app/ui/Spinner';

export function PlaygroundAskTab({ api }: { api: PlaygroundApi }) {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WhyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsedHint = formatElapsedHint(useElapsed(loading));

  // Read the key once on mount. Stored only client-side; we never POST
  // it to our origin.
  useEffect(() => {
    setApiKey(getStoredKey());
  }, []);

  const submit = async (): Promise<void> => {
    if (!apiKey || !question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.ask({ question: question.trim(), apiKey, topK: 5 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Ask the repo a question</h1>
          <p className="mt-1 text-sm text-gw-text-dim">
            Synthesizes an answer from indexed commits using your own Gemini
            API key. The key stays in your browser — it's sent only to
            Google's API, never to our origin.
          </p>
        </div>
      </div>

      <KeyManager apiKey={apiKey} onChange={setApiKey} />

      {apiKey && (
        <Card>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
            }}
            rows={3}
            placeholder="e.g. why was the persist middleware refactored?"
            className="w-full resize-none border-0 bg-transparent text-gw-text outline-none placeholder:text-gw-text-faint"
            disabled={loading}
          />
          <div className="mt-3 flex items-center justify-between">
            <p className="text-xs text-gw-text-faint">
              <kbd className="rounded border border-gw-border bg-gw-surface px-1.5 py-0.5 text-[10px]">⌘ Enter</kbd>{' '}
              to submit
            </p>
            <Button onClick={() => void submit()} disabled={loading || !question.trim()}>
              {loading ? (
                <>
                  <Spinner size={14} />
                  Thinking…{elapsedHint && <span className="ml-1 gw-mono opacity-70">{elapsedHint}</span>}
                </>
              ) : (
                'Ask'
              )}
            </Button>
          </div>
        </Card>
      )}

      {error && (
        <Card className="border-red-900 bg-red-950/40">
          <p className="text-sm text-red-300">
            <span className="font-medium">Error:</span> {error}
          </p>
          {/^401|invalid api key|api key not valid/i.test(error) && (
            <p className="mt-2 text-xs text-gw-text-faint">
              Looks like a key issue. Double-check it at{' '}
              <a
                href="https://aistudio.google.com/apikey"
                target="_blank"
                rel="noreferrer noopener"
                className="text-gw-accent underline decoration-dotted"
              >
                aistudio.google.com/apikey
              </a>{' '}
              and re-paste below.
            </p>
          )}
        </Card>
      )}

      {result && <AnswerView result={result} />}
    </div>
  );
}

function KeyManager({
  apiKey,
  onChange,
}: {
  apiKey: string | null;
  onChange: (k: string | null) => void;
}) {
  const [editing, setEditing] = useState(!apiKey);
  const [draft, setDraft] = useState('');

  const save = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setStoredKey(trimmed);
    onChange(trimmed);
    setDraft('');
    setEditing(false);
  };

  const remove = (): void => {
    clearStoredKey();
    onChange(null);
    setEditing(true);
  };

  if (apiKey && !editing) {
    return (
      <Card className="border-emerald-900/60 bg-emerald-950/20">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm">
            <span className="text-emerald-300">Key configured</span>{' '}
            <span className="gw-mono text-xs text-gw-text-faint">
              · {apiKey.slice(0, 6)}…{apiKey.slice(-4)}
            </span>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
            <Button variant="ghost" onClick={remove}>
              Remove
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-gw-text-faint">
          Stored in <code>localStorage</code> on this device only. Open DevTools
          → Application → Local Storage to inspect / delete manually.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm text-gw-text-dim">
        To synthesize answers, paste a Gemini API key. Get a free one at{' '}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer noopener"
          className="text-gw-accent underline decoration-dotted"
        >
          aistudio.google.com/apikey
        </a>
        . The free tier covers comfortably what this playground needs.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
          }}
          placeholder="AIza…"
          autoComplete="off"
          spellCheck={false}
          className="flex-1 rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono outline-none focus:border-gw-accent"
        />
        <Button onClick={save} disabled={!draft.trim()}>
          Save key
        </Button>
        {apiKey && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
      <p className="mt-3 text-xs text-gw-text-faint">
        We never send the key to our origin. It goes directly from your
        browser to <code>generativelanguage.googleapis.com</code>. You can
        revoke it any time from the AI Studio dashboard.
      </p>
    </Card>
  );
}

function AnswerView({ result }: { result: WhyResponse }) {
  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex items-center gap-3">
          <ConfidenceBadge confidence={result.confidence} idk={result.idk} />
          <span className="text-xs text-gw-text-faint">
            {result.retrieved} commit{result.retrieved === 1 ? '' : 's'} considered
            {result.usage.completionTokens > 0 &&
              ` · ${result.usage.promptTokens + result.usage.completionTokens} tokens`}
          </span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed text-gw-text">{result.answer}</p>
      </Card>

      {result.citations.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-gw-text-faint">
            {result.idk ? 'Closest matches (no answer synthesized)' : 'Citations'}
          </p>
          {result.citations.map((c) => (
            <Card key={c.commitHash} className="!p-3">
              <div className="flex items-baseline gap-3 text-xs">
                <code className="rounded bg-gw-accent/15 px-1.5 py-0.5 text-gw-accent">
                  {c.shortHash}
                </code>
                <span className="text-gw-text-dim">{c.authorName}</span>
                <span className="text-gw-text-faint">·</span>
                <span className="text-gw-text-faint">{c.date.slice(0, 10)}</span>
                <span className="ml-auto gw-mono text-gw-text-faint">
                  {(c.score * 100).toFixed(0)}% similar
                </span>
              </div>
              {c.enrichedSummary ? (
                <p className="mt-2 text-sm leading-relaxed text-gw-text">{c.enrichedSummary}</p>
              ) : (
                <p className="mt-2 text-sm italic text-gw-text-dim">
                  {c.originalMessage.split('\n', 1)[0]}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
