import { Files, GitBranch, Settings } from 'lucide-react';

export type SidebarTab = 'files' | 'github' | 'settings';

interface ActivityBarProps {
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  hasGitHub: boolean;
  gitChangesCount?: number;
}

const tabs: { id: SidebarTab; icon: typeof Files; label: string }[] = [
  { id: 'files', icon: Files, label: 'Explorer' },
  { id: 'github', icon: GitBranch, label: 'Source Control' },
  { id: 'settings', icon: Settings, label: 'Settings' },
];

export default function ActivityBar({ activeTab, onTabChange, hasGitHub, gitChangesCount }: ActivityBarProps) {
  return (
    <div className="flex flex-col items-center w-[42px] shrink-0 bg-zinc-900 border-r border-zinc-700/50">
      {tabs.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          onClick={() => onTabChange(id)}
          className={`relative flex items-center justify-center w-full h-[42px] transition-colors ${
            activeTab === id
              ? 'text-zinc-100 border-l-2 border-emerald-400 bg-zinc-800/60'
              : 'text-zinc-500 hover:text-zinc-300 border-l-2 border-transparent'
          }`}
          title={label}
        >
          <Icon className="w-[18px] h-[18px]" />
          {id === 'github' && gitChangesCount != null && gitChangesCount > 0 && (
            <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 flex items-center justify-center text-[10px] font-bold bg-emerald-500 text-white rounded-full px-1">
              {gitChangesCount}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
