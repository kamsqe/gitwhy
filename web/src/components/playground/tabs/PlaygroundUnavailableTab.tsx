import { Card } from '../../app/ui/Card';

interface PlaygroundUnavailableTabProps {
  title: string;
  summary: string;
  /** Tab the user can switch to that gives the closest available capability. */
  ctaTab: string;
}

/**
 * Shown in the playground for tabs whose features genuinely can't run
 * client-side (Ask, Search, Catchup). Explains why and points the user
 * either to the local app or to a working alternative tab.
 */
export function PlaygroundUnavailableTab({
  title,
  summary,
  ctaTab,
}: PlaygroundUnavailableTabProps) {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card>
        <p className="text-sm text-gw-text-dim">{summary}</p>
        <p className="mt-4 text-sm text-gw-text-dim">
          Want it anyway? Install gitwhy locally and run it against your own
          repo:
        </p>
        <pre className="mt-2"><code>{`git clone https://github.com/kamsqe/gitwhy.git
cd gitwhy
pnpm install && pnpm build
pnpm link --global

cd /path/to/your/repo
gitwhy init && gitwhy index
gitwhy serve   # then open /app/ in your browser`}</code></pre>
        <p className="mt-4 text-sm text-gw-text-dim">
          Or try the{' '}
          <a href={`#${ctaTab}`} className="text-gw-accent underline decoration-dotted">
            {ctaTab}
          </a>{' '}
          tab — it gives related insights and runs client-side.
        </p>
      </Card>
    </div>
  );
}
