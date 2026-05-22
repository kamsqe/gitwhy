import { useEffect, useState } from 'react';
import { ConnectionGate } from './ConnectionGate';
import { Header } from './Header';
import { Sidebar, SECONDARY_TABS, TABS } from './Sidebar';
import { api, type HealthResponse, type StatusResponse } from './lib/api';
import { useBackendStatus } from './lib/useBackend';
import { AskTab } from './tabs/AskTab';
import { CatchupTab } from './tabs/CatchupTab';
import { EstimateTab } from './tabs/EstimateTab';
import { HistoryTab } from './tabs/HistoryTab';
import { IncidentTab } from './tabs/IncidentTab';
import { IndexTab } from './tabs/IndexTab';
import { OnboardingTab } from './tabs/OnboardingTab';
import { RelatedTab } from './tabs/RelatedTab';
import { RiskTab } from './tabs/RiskTab';
import { SearchTab } from './tabs/SearchTab';
import { StatusTab } from './tabs/StatusTab';

const ALL_TAB_IDS = [...TABS, ...SECONDARY_TABS].map((t) => t.id);

/**
 * Read tab from URL hash (e.g. #risk) so views are shareable.
 * Falls back to 'ask' if none.
 */
function readTabFromHash(): string {
  if (typeof window === 'undefined') return 'ask';
  const hash = window.location.hash.replace(/^#/, '');
  return ALL_TAB_IDS.includes(hash) ? hash : 'ask';
}

export function App() {
  const { status, refresh } = useBackendStatus();
  const [activeTab, setActiveTab] = useState<string>(readTabFromHash);
  // Cached /api/status so the sidebar warning badge and StatusTab can share
  // one fetch. Initial null = unknown; refetched when the active tab is
  // Status or when initialization flips on.
  const [indexStatus, setIndexStatus] = useState<StatusResponse | null>(null);

  useEffect(() => {
    const onHashChange = (): void => setActiveTab(readTabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const onlineHealth = status.kind === 'online' ? status.health : null;
  useEffect(() => {
    if (!onlineHealth?.initialized) {
      setIndexStatus(null);
      return;
    }
    void api
      .status()
      .then(setIndexStatus)
      .catch(() => undefined);
  }, [onlineHealth?.initialized, activeTab]);

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
        <Sidebar
          active={activeTab}
          onSelect={selectTab}
          warningCount={indexStatus?.warnings.length ?? 0}
        />
        <main className="flex-1 overflow-y-auto">
          {/* Estimate + Index don't require an existing index — they're
              precisely how you go from "not indexed" to "indexed". Let them
              through even when uninitialized. */}
          {!status.health.initialized && activeTab !== 'estimate' && activeTab !== 'index' ? (
            <NotInitializedView />
          ) : (
            <TabBody id={activeTab} health={status.health} onIndexed={refresh} />
          )}
        </main>
      </div>
    </div>
  );
}

function TabBody({
  id,
  health,
  onIndexed,
}: {
  id: string;
  health: HealthResponse;
  onIndexed: () => void;
}) {
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
    case 'estimate':
      return <EstimateTab />;
    case 'index':
      return <IndexTab health={health} onIndexed={onIndexed} />;
    case 'incident':
      return <IncidentTab />;
    case 'onboarding':
      return <OnboardingTab />;
    case 'status':
      return <StatusTab health={health} />;
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
        hasn't been indexed. Two ways to fix that:
      </p>
      <div className="space-y-3">
        <div className="rounded-md border border-gw-accent/40 bg-gw-accent/5 p-4">
          <p className="text-sm font-medium text-gw-text">In the browser</p>
          <p className="mt-1 text-sm text-gw-text-dim">
            Hit the{' '}
            <a href="#estimate" className="text-gw-accent underline decoration-dotted">
              Estimate
            </a>{' '}
            tab to preview cost, then the{' '}
            <a href="#index" className="text-gw-accent underline decoration-dotted">
              Index
            </a>{' '}
            tab to actually build the index — live progress, cancel any time.
          </p>
        </div>
        <div className="rounded-md border border-gw-border p-4">
          <p className="text-sm font-medium text-gw-text">From the CLI</p>
          <pre className="mt-2"><code>{`gitwhy init
gitwhy estimate
gitwhy index --provider gemini
`}</code></pre>
        </div>
      </div>
    </div>
  );
}
