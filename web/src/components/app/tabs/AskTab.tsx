import { useState } from 'react';
import { api, type WhyResponse } from '../lib/api';
import { formatElapsedHint, useElapsed } from '../lib/useElapsed';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { ConfidenceBadge } from '../ui/ConfidenceBadge';
import { Spinner } from '../ui/Spinner';

export function AskTab() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<WhyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const elapsedHint = formatElapsedHint(useElapsed(loading));

  const submit = async (): Promise<void> => {
    if (!question.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.why({ question: question.trim() });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Ask your repo a question</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Get a citation-backed answer synthesized from AI-enriched commit summaries.
          Examples: <em>"why does this file have a 30-second timeout?"</em>,{' '}
          <em>"why was the workflow security hardened?"</em>
        </p>
      </div>

      <Card>
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void submit();
          }}
          rows={3}
          placeholder="Ask anything about the git history…"
          className="w-full resize-none border-0 bg-transparent text-gw-text outline-none placeholder:text-gw-text-faint"
          disabled={loading}
        />
        <div className="mt-3 flex items-center justify-between">
          <p className="text-xs text-gw-text-faint">
            <kbd className="rounded border border-gw-border bg-gw-surface px-1.5 py-0.5 text-[10px]">⌘ Enter</kbd>{' '}
            to submit
            {question.length > 1800 && (
              <span className={`ml-3 gw-mono ${question.length > 2000 ? 'text-red-400' : 'text-amber-400'}`}>
                {question.length}/2000
              </span>
            )}
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

      {error && (
        <Card className="border-red-900 bg-red-950/40">
          <p className="text-sm text-red-300">
            <span className="font-medium">Error:</span> {error}
          </p>
        </Card>
      )}

      {result && <AnswerView result={result} />}
    </div>
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
            {result.cached && ' · cached'}
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
              {c.enrichedSummary && (
                <p className="mt-2 text-sm leading-relaxed text-gw-text">{c.enrichedSummary}</p>
              )}
              {!c.enrichedSummary && (
                <p className="mt-2 text-sm italic text-gw-text-dim">
                  {c.originalMessage}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
