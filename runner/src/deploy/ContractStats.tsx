// ---------------------------------------------------------------------------
// ContractStats — row of 4 stat cards for the contract detail page
// ---------------------------------------------------------------------------

import { Users, GitFork, Hash, Clock, Coins, Image } from 'lucide-react';

interface Props {
  holders: number;
  dependents: number;
  version: number;
  firstDeployed: string; // block height or date string
  totalSupply?: number;
  kind?: string;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

function buildStats(p: Props) {
  const items: { label: string; value: string; icon: typeof Users }[] = [
    { label: 'Holders', value: formatNumber(p.holders), icon: Users },
  ];

  if (p.totalSupply != null && p.totalSupply > 0) {
    items.push({
      label: p.kind === 'NFT' ? 'NFTs Minted' : 'Total Supply',
      value: formatNumber(p.totalSupply),
      icon: p.kind === 'NFT' ? Image : Coins,
    });
  }

  items.push(
    { label: 'Dependents', value: formatNumber(p.dependents), icon: GitFork },
    { label: 'Version', value: `v${p.version}`, icon: Hash },
    { label: 'First Deployed', value: p.firstDeployed, icon: Clock },
  );

  return items;
}

export default function ContractStats(props: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {buildStats(props).map((s) => (
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
