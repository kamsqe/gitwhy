import { useEffect, useState } from 'react';
import { api, type OnboardingCommit, type OnboardingResponse } from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DiffViewer } from '../ui/DiffViewer';
import { MegaDecompositionView } from '../ui/MegaDecompositionView';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

/**
 * "Show me the commits a new dev should read."
 *
 * Honest framing matters. The ranking is NOT impact-by-line-count — that
 * surfaces mega-refactors, which are the LEAST useful for onboarding. We
 * filter to category=normal commits with substantive AI summaries that
 * touch a sweet-spot file count (2-15), and score by signal density:
 * detailed summaries, thoughtful messages, concept-introducing additions.
 *
 * Disclaimer copy is part of the UI on purpose — automated curation can
 * miss what the team would consider the "real" foundational commits.
 */
export function OnboardingTab() {
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<OnboardingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async (lim: number): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setResult(await api.onboarding({ limit: lim }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load(limit);
    // Only fire on mount — limit changes are handled via the input's onBlur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Reading list for new devs</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          A curated short list of commits that explain how this codebase
          came to be. Ranked by signal density — detailed summaries,
          thoughtful commit messages, sweet-spot file counts. Mega
          refactors and lockfile bumps are deliberately excluded.
        </p>
        <p className="mt-2 text-xs text-gw-text-faint">
          <strong className="text-amber-300">Caveat:</strong> automated
          curation can miss what your team considers foundational. Treat
          this as a starting point, not a syllabus.
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[150px]">
            <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
              How many to recommend
            </label>
            <input
              type="number"
              min="1"
              max="50"
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(50, Number.parseInt(e.target.value, 10) || 10)))}
              onBlur={() => void load(limit)}
              className="mt-1 w-full rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={loading}
            />
          </div>
          <Button onClick={() => void load(limit)} disabled={loading}>
            {loading ? (
              <>
                <Spinner size={14} /> Loading…
              </>
            ) : (
              'Refresh'
            )}
          </Button>
        </div>
        {result && (
          <p className="mt-3 text-xs text-gw-text-faint">
            Picked {result.recommendations.length} from{' '}
            {result.candidatesConsidered.toLocaleString()} qualifying candidate
            {result.candidatesConsidered === 1 ? '' : 's'} (out of{' '}
            {result.totalCommits.toLocaleString()} total indexed commits).
          </p>
        )}
      </Card>

      {error && <ErrorCard message={error} />}

      {result && result.recommendations.length === 0 && (
        <Card>
          <p className="text-sm text-gw-text-dim">
            Couldn't find enough commits that match the curation criteria.
            That usually means the repo is very young, has few commits with
            AI-enriched summaries, or is mostly tiny single-file changes.
          </p>
          <p className="mt-2 text-xs text-gw-text-faint">
            If you just indexed, try widening the index window (
            <code>gitwhy index --since "5 years ago"</code>) so more
            foundational commits are available.
          </p>
        </Card>
      )}

      {result && result.recommendations.length > 0 && (
        <div className="space-y-3">
          {result.recommendations.map((c, i) => (
            <OnboardingCard key={c.commitHash} commit={c} index={i + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardingCard({
  commit,
  index,
}: {
  commit: OnboardingCommit;
  index: number;
}) {
  return (
    <Card className="!p-4">
      <div className="flex items-start gap-4">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gw-accent/15 text-sm font-semibold text-gw-accent"
          aria-hidden
        >
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2 text-xs">
            <code className="rounded bg-gw-accent/15 px-1.5 py-0.5 text-gw-accent">
              {commit.shortHash}
            </code>
            <span className="text-gw-text-dim">{commit.authorName}</span>
            <span className="text-gw-text-faint">·</span>
            <span className="text-gw-text-faint">{commit.date.slice(0, 10)}</span>
            <span className="ml-auto gw-mono text-xs text-gw-text-faint" title="Curation score (higher = denser signal)">
              score {(commit.score * 100).toFixed(0)}
            </span>
          </div>

          <p className="mt-1 text-xs text-gw-text-faint">
            <span className="text-gw-text-dim">Why this:</span> {commit.reason}
            {' · '}
            {commit.filesChanged} file{commit.filesChanged === 1 ? '' : 's'}
            {commit.filesAdded > 0 && ` (${commit.filesAdded} new)`}
          </p>

          <MegaDecompositionView
            enrichedSummary={commit.enrichedSummary}
            category={commit.category}
          />

          <p className="mt-2 text-xs italic text-gw-text-faint">
            {commit.originalMessage.split('\n', 1)[0]}
          </p>

          <DiffViewer hash={commit.commitHash} />
        </div>
      </div>
    </Card>
  );
}
