import { useEffect, useState } from 'react';
import { ConnectionGate } from './ConnectionGate';
import { Header } from './Header';
import { Sidebar, TABS } from './Sidebar';
import { useBackendStatus } from './lib/useBackend';
import { AskTab } from './tabs/AskTab';
import { CatchupTab } from './tabs/CatchupTab';
import { HistoryTab } from './tabs/HistoryTab';
import { RelatedTab } from './tabs/RelatedTab';
import { RiskTab } from './tabs/RiskTab';
import { SearchTab } from './tabs/SearchTab';

/**
 * Read tab from URL hash (e.g. #risk) so views are shareable.
 * Falls back to 'ask' if none.
 */
function readTabFromHash(): string {
  if (typeof window === 'undefined') return 'ask';
  const hash = window.location.hash.replace(/^#/, '');
  return TABS.some((t) => t.id === hash) ? hash : 'ask';
}

export function App() {
  const { status, refresh } = useBackendStatus();
  const [activeTab, setActiveTab] = useState<string>(readTabFromHash);

  useEffect(() => {
    const onHashChange = (): void => setActiveTab(readTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const selectTab = (id: string): void => {
    setActiveTab(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  if (status.kind !== 'online') {
    return <ConnectionGate status={status} onRefresh={refresh} />;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header health={status.health} />
      <div className="flex flex-1">
        <Sidebar active={activeTab} onSelect={selectTab} />
        <main className="flex-1 overflow-y-auto">
          {!status.health.initialized ? <NotInitializedView /> : <TabBody id={activeTab} />}
        </main>
      </div>
    </div>
  );
}

function TabBody({ id }: { id: string }) {
  switch (id) {
    case 'ask':
      return <AskTab />;
    case 'risk':
      return <RiskTab />;
    case 'related':
      return <RelatedTab />;
    case 'history':
      return <HistoryTab />;
    case 'catchup':
      return <CatchupTab />;
    case 'search':
      return <SearchTab />;
    default:
      return <AskTab />;
  }
}

function NotInitializedView() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">Repo not indexed yet</h1>
      <p className="text-sm text-gw-text-dim">
        The local backend is connected, but the repository at this path
        hasn't been indexed. Run these commands in the repo:
      </p>
      <pre><code>{`gitwhy init
gitwhy estimate                          # check projected cost first
gitwhy index --provider gemini           # or openai, or mock
`}</code></pre>
      <p className="text-xs text-gw-text-faint">
        Once indexing completes, refresh this page.
      </p>
    </div>
  );
}
