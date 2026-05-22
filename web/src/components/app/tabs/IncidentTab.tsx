import { useState } from 'react';
import {
  api,
  type IncidentResponse,
  type IncidentSuspect,
} from '../lib/api';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { DiffViewer } from '../ui/DiffViewer';
import { MegaDecompositionView } from '../ui/MegaDecompositionView';
import { Spinner } from '../ui/Spinner';
import { ErrorCard } from './RiskTab';

/**
 * "What landed in the window when this thing broke?"
 *
 * Honest framing matters here. The tab surfaces candidates ranked by a
 * computed suspicion score — it does NOT claim causation. The disclaimer
 * is part of the UI on purpose: AI tools that confidently assign blame
 * to a commit are dangerous; tools that surface evidence and let humans
 * decide are useful.
 */
export function IncidentTab() {
  // Default the input to "right now" so users can dive in immediately.
  // Stored as a "datetime-local"-shaped string in the input element's
  // expected format (YYYY-MM-DDTHH:mm).
  const [atLocal, setAtLocal] = useState<string>(() => {
    const now = new Date();
    now.setSeconds(0, 0);
    return now.toISOString().slice(0, 16);
  });
  const [windowHours, setWindowHours] = useState('4');
  const [afterHours, setAfterHours] = useState('1');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IncidentResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // datetime-local doesn't include a timezone, so the browser
      // interpolates the user's local zone. new Date() handles that.
      const at = new Date(atLocal).toISOString();
      const winMin = Math.max(1, Math.round(Number.parseFloat(windowHours) * 60));
      const afterMin = Math.max(0, Math.round(Number.parseFloat(afterHours) * 60));
      setResult(
        await api.incident({
          at,
          windowMinutes: winMin,
          afterMinutes: afterMin,
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Incident archaeologist</h1>
        <p className="mt-1 text-sm text-gw-text-dim">
          Surface commits that landed around an incident timestamp, ranked by
          how risky they look. <span className="text-gw-text">
            This tool does not assign blame — causal attribution is yours.
          </span>{' '}
          It just helps you find candidates faster than scrolling through
          git log.
        </p>
      </div>

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
              Incident timestamp
            </label>
            <input
              type="datetime-local"
              value={atLocal}
              onChange={(e) => setAtLocal(e.target.value)}
              className="mt-1 w-full rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
              Look-back window (hours)
            </label>
            <input
              type="number"
              min="0.1"
              step="0.5"
              value={windowHours}
              onChange={(e) => setWindowHours(e.target.value)}
              className="mt-1 w-full rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={loading}
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wider text-gw-text-faint">
              Hot-fix window (hours, after)
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={afterHours}
              onChange={(e) => setAfterHours(e.target.value)}
              className="mt-1 w-full rounded-md border border-gw-border bg-gw-surface px-3 py-2 text-sm gw-mono focus:border-gw-accent"
              disabled={loading}
            />
          </div>
          <div className="flex items-end">
            <Button onClick={() => void submit()} disabled={loading} className="w-full">
              {loading ? (
                <>
                  <Spinner size={14} /> Analyzing…
                </>
              ) : (
                'Investigate'
              )}
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-gw-text-faint">
          Single-repo only. If the cause might be in a different service
          (microservices, sibling repos, third-party deps), this tool
          can't see it.
        </p>
      </Card>

      {error && <ErrorCard message={error} />}

      {result && <IncidentReport result={result} />}
    </div>
  );
}

function IncidentReport({ result }: { result: IncidentResponse }) {
  return (
    <div className="space-y-4">
      <Card className="border-amber-900/60 bg-amber-950/20">
        <p className="text-xs uppercase tracking-wider text-amber-300">Window analyzed</p>
        <p className="mt-1 text-sm text-gw-text">
          {formatRange(result.windowStart, result.windowEnd)}
          {result.hotfixes.length > 0 &&
            ` · hot-fix watch through ${formatTime(result.hotfixWindowEnd)}`}
        </p>
        <p className="mt-2 text-xs text-gw-text-faint">
          {result.suspects.length} candidate{result.suspects.length === 1 ? '' : 's'} before
          ·{' '}
          {result.hotfixes.length} commit{result.hotfixes.length === 1 ? '' : 's'} shipped after
        </p>
      </Card>

      {result.suspects.length === 0 ? (
        <Card>
          <p className="text-sm text-gw-text-dim">
            No commits landed in the look-back window. Either the cause was
            outside this repo, or further back in time — try widening the
            window or check other services.
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-gw-text-faint">
            Suspects (ranked by suspicion — review, don't blame)
          </p>
          {result.suspects.map((s) => (
            <SuspectCard key={s.commitHash} suspect={s} variant="suspect" />
          ))}
        </div>
      )}

      {result.hotfixes.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-gw-text-faint">
            Shipped after (potential mitigations / hot-fixes)
          </p>
          {result.hotfixes.map((s) => (
            <SuspectCard key={s.commitHash} suspect={s} variant="hotfix" />
          ))}
        </div>
      )}
    </div>
  );
}

function SuspectCard({
  suspect,
  variant,
}: {
  suspect: IncidentSuspect;
  variant: 'suspect' | 'hotfix';
}) {
  // Suspicion score tinting — only on suspects. Hotfixes are uniformly
  // "informational" (they didn't cause the incident, they responded to it).
  const tone =
    variant === 'hotfix'
      ? 'border-gw-border'
      : suspect.suspicionScore >= 0.55
        ? 'border-red-900/60 bg-red-950/20'
        : suspect.suspicionScore >= 0.35
          ? 'border-amber-900/60 bg-amber-950/20'
          : 'border-gw-border';

  return (
    <Card className={`!p-3 ${tone}`}>
      <div className="flex flex-wrap items-baseline gap-2 text-xs">
        <code className="rounded bg-gw-accent/15 px-1.5 py-0.5 text-gw-accent">
          {suspect.shortHash}
        </code>
        <span className="text-gw-text-dim">{suspect.authorName}</span>
        <span className="text-gw-text-faint">·</span>
        <span className="text-gw-text-faint">{formatTime(suspect.date)}</span>
        <CategoryBadge category={suspect.category} />
        {variant === 'suspect' && (
          <span
            className="ml-auto gw-mono text-xs text-gw-text-dim"
            title="Combined churn × bus-factor × category penalty. Higher = warrants closer look."
          >
            suspicion {(suspect.suspicionScore * 100).toFixed(0)}%
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gw-text-faint">
        <span>
          <span className="gw-mono text-gw-text-dim">
            +{suspect.linesAdded}/-{suspect.linesRemoved}
          </span>{' '}
          lines
        </span>
        <span>
          <span className="gw-mono text-gw-text-dim">{suspect.filesChanged}</span> file
          {suspect.filesChanged === 1 ? '' : 's'} touched
        </span>
        {suspect.maxBusFactor !== null && (
          <span
            title={`Max bus-factor exposure across the files this commit touched. 1 = single point of failure.`}
          >
            max bus factor{' '}
            <span
              className={`gw-mono ${suspect.maxBusFactor === 1 ? 'text-red-300' : 'text-gw-text-dim'}`}
            >
              {suspect.maxBusFactor}
            </span>
          </span>
        )}
      </div>

      {suspect.enrichedSummary ? (
        <MegaDecompositionView
          enrichedSummary={suspect.enrichedSummary}
          category={suspect.category}
        />
      ) : (
        <p className="mt-2 text-sm italic text-gw-text-dim">
          {suspect.originalMessage.split('\n', 1)[0]}
        </p>
      )}

      <DiffViewer hash={suspect.commitHash} />
    </Card>
  );
}

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
    <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      {category}
    </span>
  );
}

function formatRange(start: string, end: string): string {
  return `${formatTime(start)} → ${formatTime(end)}`;
}

function formatTime(iso: string): string {
  // YYYY-MM-DD HH:mm (local). Don't bother with the timezone label — the
  // user knows what timezone their browser is in.
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
