import { createFileRoute } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Server, Shield, Cpu, Eye, Radio, Database } from 'lucide-react';
import { resolveApiBaseUrl } from '../api';
import { ensureHeyApiConfigured } from '../api/heyapi';

interface StakingNode {
  node_id: string;
  role: number;
  address: string;
  networking_address: string;
  tokens_staked: number;
  tokens_committed: number;
  tokens_unstaking: number;
  tokens_unstaked: number;
  tokens_rewarded: number;
  delegator_count: number;
  epoch: number;
}

const ROLE_MAP: Record<number, { label: string; icon: typeof Server; color: string }> = {
  1: { label: 'Collection', icon: Database, color: 'text-blue-400' },
  2: { label: 'Consensus', icon: Shield, color: 'text-purple-400' },
  3: { label: 'Execution', icon: Cpu, color: 'text-orange-400' },
  4: { label: 'Verification', icon: Eye, color: 'text-green-400' },
  5: { label: 'Access', icon: Radio, color: 'text-cyan-400' },
};

async function fetchNodes(): Promise<StakingNode[]> {
  await ensureHeyApiConfigured();
  const baseURL = await resolveApiBaseUrl();
  const res = await fetch(`${baseURL}/status/nodes?limit=2000`);
  if (!res.ok) return [];
  const json = await res.json();
  return json?.data ?? [];
}

export const Route = createFileRoute('/nodes')({
  component: NodesPage,
  loader: async () => {
    const nodes = await fetchNodes();
    return { nodes };
  },
});

function NodesPage() {
  const { nodes } = Route.useLoaderData();
  const [roleFilter, setRoleFilter] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredNodes = useMemo(() => {
    let result = nodes;
    if (roleFilter !== null) {
      result = result.filter((n) => n.role === roleFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (n) =>
          n.node_id.toLowerCase().includes(q) ||
          n.address.toLowerCase().includes(q) ||
          n.networking_address.toLowerCase().includes(q)
      );
    }
    return result;
  }, [nodes, roleFilter, searchQuery]);

  // Summary stats
  const totalStaked = useMemo(() => nodes.reduce((sum, n) => sum + n.tokens_staked, 0), [nodes]);
  const totalDelegators = useMemo(() => nodes.reduce((sum, n) => sum + n.delegator_count, 0), [nodes]);
  const roleBreakdown = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const n of nodes) {
      counts[n.role] = (counts[n.role] || 0) + 1;
    }
    return counts;
  }, [nodes]);

  // Count validators (nodes with tokens_staked > 0)
  const validatorCount = useMemo(() => nodes.filter(n => n.tokens_staked > 0).length, [nodes]);

  return (
    <div className="container mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-center justify-between"
      >
        <div className="flex items-center space-x-4">
          <div className="p-3 bg-nothing-green/10 rounded-sm">
            <Server className="w-6 h-6 text-nothing-green" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-zinc-900 dark:text-white uppercase tracking-tighter">
              Network Nodes
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {nodes.length > 0 ? `Epoch ${nodes[0].epoch} — ${nodes.length} nodes` : 'Loading...'}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Summary Stats */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4"
      >
        <StatCard label="Nodes" value={nodes.length.toLocaleString()} />
        <StatCard label="Validators" value={validatorCount.toLocaleString()} />
        <StatCard label="Total Staked" value={formatFlowCompact(totalStaked)} suffix="FLOW" />
        <StatCard label="Delegators" value={totalDelegators.toLocaleString()} />
      </motion.div>

      {/* Filter Bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-4 rounded-sm shadow-sm dark:shadow-none flex flex-col sm:flex-row items-start sm:items-center gap-3"
      >
        <input
          type="text"
          placeholder="Search by node ID or address..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 w-full sm:w-auto bg-transparent border border-zinc-200 dark:border-white/10 px-3 py-2 rounded-sm text-sm font-mono text-zinc-900 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-nothing-green/30"
        />
        <div className="flex flex-wrap gap-1.5">
          <FilterPill
            label={`All (${nodes.length})`}
            active={roleFilter === null}
            onClick={() => setRoleFilter(null)}
          />
          {Object.entries(ROLE_MAP).map(([role, { label }]) => {
            const count = roleBreakdown[Number(role)] || 0;
            if (count === 0) return null;
            return (
              <FilterPill
                key={role}
                label={`${label} (${count})`}
                active={roleFilter === Number(role)}
                onClick={() => setRoleFilter(roleFilter === Number(role) ? null : Number(role))}
              />
            );
          })}
        </div>
      </motion.div>

      {/* Table */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 rounded-sm overflow-hidden shadow-sm dark:shadow-none"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-zinc-200 dark:border-white/5 bg-zinc-50/50 dark:bg-white/5">
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">
                  Node ID
                </th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider">
                  Role
                </th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Staked
                </th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Committed
                </th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Rewarded
                </th>
                <th className="p-4 text-xs font-semibold text-zinc-500 dark:text-gray-400 uppercase tracking-wider text-right">
                  Delegators
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredNodes.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-12 text-center text-zinc-400 text-sm">
                    {nodes.length === 0 ? 'No node data available yet.' : 'No nodes match your filter.'}
                  </td>
                </tr>
              ) : (
                filteredNodes.map((node, i) => (
                  <motion.tr
                    key={node.node_id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(i * 0.008, 0.4) }}
                    className="border-b border-zinc-100 dark:border-white/5 group hover:bg-zinc-50 dark:hover:bg-white/5 transition-colors"
                  >
                    <td className="p-4">
                      <span
                        className="font-mono text-sm text-nothing-green-dark dark:text-nothing-green cursor-default"
                        title={node.node_id}
                      >
                        {node.node_id.slice(0, 16)}...
                      </span>
                    </td>
                    <td className="p-4">
                      <RoleBadge role={node.role} />
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-zinc-900 dark:text-white">
                      {formatFlowAmount(node.tokens_staked)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-zinc-600 dark:text-zinc-400">
                      {formatFlowAmount(node.tokens_committed)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-zinc-600 dark:text-zinc-400">
                      {formatFlowAmount(node.tokens_rewarded)}
                    </td>
                    <td className="p-4 text-right font-mono text-sm text-zinc-900 dark:text-white">
                      {node.delegator_count}
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-zinc-200 dark:border-white/5 flex items-center justify-between">
          <span className="text-xs text-zinc-500 dark:text-zinc-400 font-mono">
            {filteredNodes.length} of {nodes.length} nodes
          </span>
        </div>
      </motion.div>
    </div>
  );
}

function StatCard({ label, value, suffix }: { label: string; value: string; suffix?: string }) {
  return (
    <div className="bg-white dark:bg-nothing-dark border border-zinc-200 dark:border-white/10 p-6 rounded-sm shadow-sm dark:shadow-none">
      <p className="text-xs text-zinc-500 dark:text-gray-400 uppercase tracking-widest mb-1 font-mono">
        {label}
      </p>
      <p className="text-3xl font-bold font-mono text-zinc-900 dark:text-white">
        {value}
        {suffix && <span className="text-sm text-zinc-400 ml-1.5 font-normal">{suffix}</span>}
      </p>
    </div>
  );
}

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 border rounded-sm text-xs uppercase tracking-widest font-semibold transition-colors ${
        active
          ? 'bg-nothing-green/10 border-nothing-green/30 text-nothing-green'
          : 'border-zinc-200 dark:border-white/10 bg-zinc-50 dark:bg-black/30 hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-700 dark:text-zinc-200'
      }`}
    >
      {label}
    </button>
  );
}

function RoleBadge({ role }: { role: number }) {
  const info = ROLE_MAP[role];
  if (!info) {
    return (
      <span className="font-mono text-sm bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded-sm text-zinc-500">
        Role {role}
      </span>
    );
  }
  const Icon = info.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs bg-zinc-100 dark:bg-white/10 px-2 py-1 rounded-sm ${info.color}`}>
      <Icon className="w-3.5 h-3.5" />
      {info.label}
    </span>
  );
}

function formatFlowAmount(amount: number): string {
  if (amount === 0) return '0.00';
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(2);
}

function formatFlowCompact(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(2);
}
