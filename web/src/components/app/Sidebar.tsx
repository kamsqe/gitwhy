import type { ReactNode } from 'react';

export interface Tab {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
}

export const TABS: Tab[] = [
  {
    id: 'ask',
    label: 'Ask',
    description: 'Q&A with citations',
    icon: <Icon path="M12 8.25c-2.485 0-4.5 2.015-4.5 4.5 0 .814.218 1.578.6 2.236L6 17.25h6c2.485 0 4.5-2.015 4.5-4.5s-2.015-4.5-4.5-4.5z" />,
  },
  {
    id: 'risk',
    label: 'Risk',
    description: 'bus factor + hotspots',
    icon: <Icon path="M12 9v3.75m9-1.5a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />,
  },
  {
    id: 'related',
    label: 'Related',
    description: 'co-change matrix',
    icon: <Icon path="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />,
  },
  {
    id: 'history',
    label: 'History',
    description: 'file timeline',
    icon: <Icon path="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />,
  },
  {
    id: 'catchup',
    label: 'Catchup',
    description: 'recent activity',
    icon: <Icon path="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />,
  },
  {
    id: 'search',
    label: 'Search',
    description: 'semantic search',
    icon: <Icon path="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />,
  },
  {
    id: 'estimate',
    label: 'Estimate',
    description: 'projected index cost',
    icon: <Icon path="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />,
  },
  {
    id: 'index',
    label: 'Index',
    description: 'build / refresh index',
    icon: <Icon path="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />,
  },
  {
    id: 'incident',
    label: 'Incident',
    description: 'what landed in the window',
    icon: <Icon path="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />,
  },
  {
    id: 'onboarding',
    label: 'Onboarding',
    description: 'reading list for new devs',
    icon: <Icon path="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />,
  },
];

// Secondary tabs — meta/info, not analysis tools. Separated visually so the
// primary 7 tools stay focused.
export const SECONDARY_TABS: Tab[] = [
  {
    id: 'status',
    label: 'Status',
    description: 'index health · hotspots',
    icon: <Icon path="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />,
  },
];

function Icon({ path }: { path: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={1.6}
      stroke="currentColor"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={path} />
    </svg>
  );
}

export function Sidebar({ active, onSelect, warningCount = 0 }: SidebarProps) {
  return (
    <nav className="w-56 shrink-0 border-r border-gw-border bg-gw-surface px-3 py-4">
      <p className="px-2 pb-2 text-[10px] uppercase tracking-wider text-gw-text-faint">Tools</p>
      <TabList tabs={TABS} active={active} onSelect={onSelect} />

      <p className="mt-6 px-2 pb-2 text-[10px] uppercase tracking-wider text-gw-text-faint">Info</p>
      <TabList
        tabs={SECONDARY_TABS}
        active={active}
        onSelect={onSelect}
        warningCount={warningCount}
      />
    </nav>
  );
}

interface SidebarProps {
  active: string;
  onSelect: (id: string) => void;
  warningCount?: number;
}

function TabList({
  tabs,
  active,
  onSelect,
  warningCount = 0,
}: {
  tabs: Tab[];
  active: string;
  onSelect: (id: string) => void;
  warningCount?: number;
}) {
  return (
    <ul className="space-y-0.5">
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        const showWarningBadge = tab.id === 'status' && warningCount > 0;
        return (
          <li key={tab.id}>
            <button
              type="button"
              onClick={() => onSelect(tab.id)}
              className={`flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                isActive
                  ? 'bg-gw-accent/15 text-gw-text'
                  : 'text-gw-text-dim hover:bg-gw-surface-2 hover:text-gw-text'
              }`}
            >
              <span className={isActive ? 'text-gw-accent' : 'text-gw-text-faint mt-0.5'}>
                {tab.icon}
              </span>
              <span className="flex flex-1 flex-col">
                <span className="flex items-center gap-2 font-medium">
                  {tab.label}
                  {showWarningBadge && (
                    <span
                      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500/20 px-1 text-[10px] font-semibold text-amber-300"
                      title={`${warningCount} warning${warningCount === 1 ? '' : 's'}`}
                    >
                      {warningCount}
                    </span>
                  )}
                </span>
                <span className="text-[11px] text-gw-text-faint">{tab.description}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
