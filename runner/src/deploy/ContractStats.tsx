// ---------------------------------------------------------------------------
// ContractStats — row of 4 stat cards for the contract detail page
// ---------------------------------------------------------------------------

import { Users, GitFork, Hash, Clock } from 'lucide-react';

interface Props {
  holders: number;
  dependents: number;
  version: number;
  firstDeployed: string; // block height or date string
}

const stats = (p: Props) => [
  { label: 'Holders', value: p.holders.toLocaleString(), icon: Users },
  { label: 'Dependents', value: p.dependents.toLocaleString(), icon: GitFork },
  { label: 'Version', value: `v${p.version}`, icon: Hash },
  { label: 'First Deployed', value: p.firstDeployed, icon: Clock },
];

export default function ContractStats(props: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {stats(props).map((s) => (
        <div
          key={s.label}
          className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
        >
          <div className="flex items-center gap-2 mb-2">
            <s.icon className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-500">{s.label}</span>
          </div>
          <p className="text-lg font-semibold text-zinc-100">{s.value}</p>
        </div>
      ))}
    </div>
  );
}
