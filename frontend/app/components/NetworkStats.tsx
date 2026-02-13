import { useState, useEffect } from 'react';
import { Lock, Server } from 'lucide-react';
import { motion } from 'framer-motion';

const FALLBACK_TOTAL_SUPPLY = 1_630_000_000;

function formatCompact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toLocaleString();
}

export function NetworkStats({ totalStaked, totalSupply, activeNodes }: {
  totalStaked?: number;
  totalSupply?: number;
  activeNodes?: number;
}) {
  if (!totalStaked) {
    return (
      <div className="grid grid-cols-2 gap-4 h-full">
        {[1, 2].map((i) => (
          <div key={i} className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 flex flex-col justify-between animate-pulse">
            <div className="p-1.5 w-8 h-8 bg-zinc-100 dark:bg-white/5 rounded-sm mb-4" />
            <div className="space-y-2">
              <div className="h-3 w-16 bg-zinc-100 dark:bg-white/5 rounded-sm" />
              <div className="h-6 w-24 bg-zinc-100 dark:bg-white/5 rounded-sm" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  const supply = (totalSupply && totalSupply > 0) ? totalSupply : FALLBACK_TOTAL_SUPPLY;
  const pct = Math.min((totalStaked / supply) * 100, 100);

  return (
    <div className="grid grid-cols-2 gap-4 h-full">
      {/* Staked — progress bar from bottom */}
      <StakeCard staked={totalStaked} supply={supply} pct={pct} />

      {/* Active Nodes */}
      <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 flex flex-col justify-between hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 hover:shadow-sm dark:hover:border-white/30 transition-all duration-300 relative overflow-hidden group">
        <div className="absolute top-0 right-0 w-16 h-16 bg-nothing-green/5 dark:bg-white/5 blur-2xl rounded-full group-hover:bg-nothing-green/10 dark:group-hover:bg-white/10 transition-colors" />
        <div className="flex justify-between items-start mb-2">
          <div className="p-1.5 rounded-sm bg-orange-500/10 border-orange-500/20 border">
            <Server className="w-4 h-4 text-orange-400" />
          </div>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 dark:text-gray-500 uppercase tracking-widest mb-1">Active Nodes</p>
          <p className="text-xl font-mono font-bold text-zinc-900 dark:text-white">{activeNodes}</p>
        </div>
      </div>
    </div>
  );
}

function StakeCard({ staked, supply, pct }: { staked: number; supply: number; pct: number }) {
  const [animPct, setAnimPct] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimPct(pct), 150);
    return () => clearTimeout(t);
  }, [pct]);

  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 flex flex-col justify-between hover:border-nothing-green-dark/30 dark:hover:border-nothing-green/30 hover:shadow-sm dark:hover:border-white/30 transition-all duration-300 relative overflow-hidden group">
      {/* Progress fill from bottom */}
      <motion.div
        className="absolute bottom-0 left-0 right-0"
        initial={{ height: '0%' }}
        animate={{ height: `${animPct}%` }}
        transition={{ duration: 1.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{
          background: 'linear-gradient(0deg, rgba(0,229,153,0.12) 0%, rgba(0,229,153,0.04) 100%)',
        }}
      />
      {/* Shimmer line at top of fill */}
      <motion.div
        className="absolute left-0 right-0 h-px"
        initial={{ bottom: '0%' }}
        animate={{ bottom: `${animPct}%` }}
        transition={{ duration: 1.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{
          background: 'linear-gradient(90deg, transparent 0%, rgba(0,229,153,0.5) 50%, transparent 100%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10">
        <div className="flex justify-between items-start mb-2">
          <div className="p-1.5 rounded-sm bg-purple-500/10 border-purple-500/20 border">
            <Lock className="w-4 h-4 text-purple-400" />
          </div>
          <span className="text-lg font-mono font-bold text-nothing-green-dark dark:text-nothing-green">
            {pct.toFixed(1)}%
          </span>
        </div>
        <div>
          <p className="text-[10px] text-zinc-500 dark:text-gray-500 uppercase tracking-widest mb-1">Network Staked</p>
          <p className="text-xl font-mono font-bold text-zinc-900 dark:text-white">
            {formatCompact(staked)}
            <span className="text-xs text-zinc-400 font-normal ml-1.5">/ {formatCompact(supply)} FLOW</span>
          </p>
        </div>
      </div>
    </div>
  );
}
