import { useEffect, useMemo, useState } from 'react';
import type { Database } from 'sql.js';
import { createPlaygroundApi, type PlaygroundApi } from './lib/playgroundApi';
import { PlaygroundAskTab } from './tabs/PlaygroundAskTab';
import { PlaygroundRiskTab } from './tabs/PlaygroundRiskTab';
import { PlaygroundRelatedTab } from './tabs/PlaygroundRelatedTab';
import { PlaygroundHistoryTab } from './tabs/PlaygroundHistoryTab';
import { PlaygroundStatusTab } from './tabs/PlaygroundStatusTab';
import { PlaygroundUnavailableTab } from './tabs/PlaygroundUnavailableTab';

const TABS = [
  { id: 'ask', label: 'Ask', description: 'Q&A (bring your own key)' },
  { id: 'risk', label: 'Risk', description: 'bus factor + hotspots' },
  { id: 'related', label: 'Related', description: 'co-change matrix' },
  { id: 'history', label: 'History', description: 'file timeline' },
  { id: 'status', label: 'Status', description: 'index health · hotspots' },
] as const;

const UNAVAILABLE_TABS = [
  { id: 'search', label: 'Search', reason: 'available in the local app' },
  { id: 'catchup', label: 'Catchup', reason: 'available in the local app' },
] as const;

interface PlaygroundShellProps {
  db: Database;
  demoName: string;
}

export function PlaygroundShell({ db, demoName }: PlaygroundShellProps) {
  const api = useMemo(() => createPlaygroundApi(db, demoName), [db, demoName]);
  const [active, setActive] = useState<string>(readHash);

  useEffect(() => {
    const onHash = () => setActive(readHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const select = (id: string): void => {
    setActive(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    <div className="flex flex-1">
      <Sidebar active={active} onSelect={select} />
      <main className="flex-1 overflow-y-auto">
        <TabBody id={active} api={api} />
      </main>
    </div>
  );
}

function readHash(): string {
  if (typeof window === 'undefined') return 'risk';
  const hash = window.location.hash.replace(/^#/, '');
  if (TABS.some((t) => t.id === hash)) return hash;
  if (UNAVAILABLE_TABS.some((t) => t.id === hash)) return hash;
  return 'risk';
}

function Sidebar({ active, onSelect }: { active: string; onSelect: (id: string) => void }) {
  return (
    <nav className="w-56 shrink-0 border-r border-gw-border bg-gw-surface px-3 py-4">
      <p className="px-2 pb-2 text-[10px] uppercase tracking-wider text-gw-text-faint">
        Available
      </p>
      <ul className="space-y-0.5">
        {TABS.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                active === tab.id
                  ? 'bg-gw-accent/15 text-gw-text'
                  : 'text-gw-text-dim hover:bg-gw-surface-2 hover:text-gw-text'
              }`}
            >
              <span className="font-medium">{tab.label}</span>
              <span className="text-[11px] text-gw-text-faint">{tab.description}</span>
            </button>
          </li>
        ))}
      </ul>

      <p className="mt-6 px-2 pb-2 text-[10px] uppercase tracking-wider text-gw-text-faint">
        Local-install only
      </p>
      <ul className="space-y-0.5">
        {UNAVAILABLE_TABS.map((tab) => (
          <li key={tab.id}>
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              className={`flex w-full flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                active === tab.id
                  ? 'bg-gw-surface-2 text-gw-text'
                  : 'text-gw-text-faint hover:bg-gw-surface-2 hover:text-gw-text-dim'
              }`}
            >
              <span className="font-medium">{tab.label}</span>
              <span className="text-[11px] text-gw-text-faint">requires backend</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function TabBody({ id, api }: { id: string; api: PlaygroundApi }) {
  switch (id) {
    case 'ask':
      return <PlaygroundAskTab api={api} />;
    case 'risk':
      return <PlaygroundRiskTab api={api} />;
    case 'related':
      return <PlaygroundRelatedTab api={api} />;
    case 'history':
      return <PlaygroundHistoryTab api={api} />;
    case 'status':
      return <PlaygroundStatusTab api={api} />;
    case 'search':
      return (
        <PlaygroundUnavailableTab
          title="Semantic search"
          summary="Search is similar to Ask — same retrieval, but no synthesis. The Ask tab covers this case and tells you which commits matched."
          ctaTab="ask"
        />
      );
    case 'catchup':
      return (
        <PlaygroundUnavailableTab
          title="Catchup"
          summary="Activity narration uses category-aware grouping over your full git log. Run gitwhy locally against your own repo to use it."
          ctaTab="history"
        />
      );
    default:
      return <PlaygroundAskTab api={api} />;
  }
}
