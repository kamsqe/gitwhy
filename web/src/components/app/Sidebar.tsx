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

interface SidebarProps {
  active: string;
  onSelect: (id: string) => void;
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  return (
    <nav className="w-56 shrink-0 border-r border-gw-border bg-gw-surface px-3 py-4">
      <p className="px-2 pb-2 text-[10px] uppercase tracking-wider text-gw-text-faint">Tools</p>
      <ul className="space-y-0.5">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
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
                <span className="flex flex-col">
                  <span className="font-medium">{tab.label}</span>
                  <span className="text-[11px] text-gw-text-faint">{tab.description}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
