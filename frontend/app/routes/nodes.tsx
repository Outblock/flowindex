import { createFileRoute } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Server, Shield, Cpu, Eye, Radio, Database } from 'lucide-react';
import NumberFlow from '@number-flow/react';
import { ensureHeyApiConfigured } from '../api/heyapi';
import { resolveApiBaseUrl } from '../api';

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

  return (
    <div className="min-h-screen">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8"
        >
          <h1 className="text-3xl font-black tracking-tight text-zinc-900 dark:text-white flex items-center gap-3">
            <Server className="w-8 h-8 text-nothing-green" />
            Network Nodes
          </h1>
          <p className="text-zinc-500 dark:text-zinc-400 mt-1">
            {nodes.length > 0 ? `Epoch ${nodes[0].epoch}` : 'Loading...'}
          </p>
        </motion.div>

        {/* Summary Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8"
        >
          <SummaryCard label="Total Nodes" value={nodes.length} />
          <SummaryCard label="Total Staked" value={totalStaked} format="flow" />
          <SummaryCard label="Total Delegators" value={totalDelegators} />
          <SummaryCard label="Roles" value={Object.keys(roleBreakdown).length} />
        </motion.div>

        {/* Role Breakdown */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex flex-wrap gap-2 mb-6"
        >
          <button
            onClick={() => setRoleFilter(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
              roleFilter === null
                ? 'bg-nothing-green text-black'
                : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
            }`}
          >
            All ({nodes.length})
          </button>
          {Object.entries(ROLE_MAP).map(([role, { label, color }]) => {
            const count = roleBreakdown[Number(role)] || 0;
            if (count === 0) return null;
            return (
              <button
                key={role}
                onClick={() => setRoleFilter(roleFilter === Number(role) ? null : Number(role))}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                  roleFilter === Number(role)
                    ? 'bg-nothing-green text-black'
                    : `bg-zinc-100 dark:bg-zinc-800 ${color} hover:bg-zinc-200 dark:hover:bg-zinc-700`
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </motion.div>

        {/* Search */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-6"
        >
          <input
            type="text"
            placeholder="Search by node ID, address, or networking address..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full max-w-md px-4 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white text-sm placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-nothing-green/50"
          />
        </motion.div>

        {/* Nodes Table */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Node ID
                  </th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Role
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Staked
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Delegators
                  </th>
                  <th className="text-right px-4 py-3 text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
                    Rewarded
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredNodes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-12 text-center text-zinc-400">
                      {nodes.length === 0 ? 'No node data available yet.' : 'No nodes match your filter.'}
                    </td>
                  </tr>
                ) : (
                  filteredNodes.map((node, i) => <NodeRow key={node.node_id} node={node} index={i} />)
                )}
              </tbody>
            </table>
          </div>
        </motion.div>

        <div className="mt-4 text-xs text-zinc-400 text-right">
          Showing {filteredNodes.length} of {nodes.length} nodes
        </div>
      </div>
    </div>
  );
}

function NodeRow({ node, index }: { node: StakingNode; index: number }) {
  const role = ROLE_MAP[node.role] || { label: `Role ${node.role}`, icon: Server, color: 'text-zinc-400' };
  const RoleIcon = role.icon;

  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: Math.min(index * 0.01, 0.5) }}
      className="border-b border-zinc-100 dark:border-zinc-800/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/30 transition-colors"
    >
      <td className="px-4 py-3">
        <span className="font-mono text-xs text-zinc-700 dark:text-zinc-300" title={node.node_id}>
          {node.node_id.slice(0, 16)}...
        </span>
      </td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${role.color}`}>
          <RoleIcon className="w-3.5 h-3.5" />
          {role.label}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {formatFlow(node.tokens_staked)}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {node.delegator_count}
      </td>
      <td className="px-4 py-3 text-right font-mono text-xs text-zinc-700 dark:text-zinc-300">
        {formatFlow(node.tokens_rewarded)}
      </td>
    </motion.tr>
  );
}

function SummaryCard({ label, value, format }: { label: string; value: number; format?: 'flow' }) {
  const displayValue = format === 'flow' ? Math.round(value) : value;

  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4">
      <div className="text-xs text-zinc-500 dark:text-zinc-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-zinc-900 dark:text-white">
        <NumberFlow value={displayValue} />
        {format === 'flow' && <span className="text-xs text-zinc-400 ml-1">FLOW</span>}
      </div>
    </div>
  );
}

function formatFlow(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toFixed(2);
}
