// ---------------------------------------------------------------------------
// DeployDashboard — main deploy page with address sidebar + contract grid
// ---------------------------------------------------------------------------

import { useState, useEffect } from 'react';
import {
  Link,
  useLocation,
  Routes,
  Route,
} from 'react-router-dom';
import { Loader2, LogOut, User, Inbox } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { useAddresses } from './useAddresses';
import { fetchContracts, fetchHolderCount } from './api';
import type { ContractInfo, VerifiedAddress } from './api';
import AddressSidebar from './AddressSidebar';
import ContractCard from './ContractCard';
import ContractDetail from './ContractDetail';

// ---------------------------------------------------------------------------
// ContractsGrid — main grid view (index route)
// ---------------------------------------------------------------------------

function ContractsGrid({
  selectedAddress,
  contracts,
  contractsLoading,
  holderCounts,
  hasAddresses,
}: {
  selectedAddress: VerifiedAddress | null;
  contracts: ContractInfo[];
  contractsLoading: boolean;
  holderCounts: Map<string, number>;
  hasAddresses: boolean;
}) {
  // No addresses at all
  if (!hasAddresses) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Inbox className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-zinc-400">
            No addresses added yet
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            Connect a wallet in the sidebar to see your contracts
          </p>
        </div>
      </div>
    );
  }

  // Loading contracts
  if (contractsLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
      </div>
    );
  }

  // No contracts found for selected address
  if (selectedAddress && contracts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Inbox className="w-8 h-8 text-zinc-600 mx-auto mb-3" />
          <h3 className="text-sm font-medium text-zinc-400">
            No contracts found
          </h3>
          <p className="mt-1 text-xs text-zinc-500">
            This address has no deployed contracts on{' '}
            {selectedAddress.network}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      {/* Contracts section */}
      <div>
        <h2 className="text-sm font-medium text-zinc-300 mb-4">
          My Contracts
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contracts.map((c) => {
            const id = `A.${c.address}.${c.name}`;
            return (
              <ContractCard
                key={id}
                contract={c}
                network={selectedAddress?.network ?? 'mainnet'}
                holderCount={holderCounts.get(id)}
                hasCD={false}
              />
            );
          })}
        </div>
      </div>

      {/* Recent Deployments section */}
      <div className="mt-8">
        <h2 className="text-sm font-medium text-zinc-300 mb-4">
          Recent Deployments
        </h2>
        <div className="border border-zinc-800 rounded-lg bg-zinc-900/30 p-6 text-center">
          <p className="text-xs text-zinc-500">
            Deployment history will appear here once a CD pipeline is configured
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeployDashboard — main component
// ---------------------------------------------------------------------------

export default function DeployDashboard() {
  const location = useLocation();
  const { user, signOut } = useAuth();
  const { addresses, loading: addressesLoading, addAddress, removeAddress } =
    useAddresses();

  const [selectedAddress, setSelectedAddress] =
    useState<VerifiedAddress | null>(null);
  const [contracts, setContracts] = useState<ContractInfo[]>([]);
  const [holderCounts, setHolderCounts] = useState<Map<string, number>>(
    new Map(),
  );
  const [contractsLoading, setContractsLoading] = useState(false);

  // Auto-select first address when addresses load
  useEffect(() => {
    if (addresses.length > 0 && !selectedAddress) {
      setSelectedAddress(addresses[0]);
    }
    // If selected address was removed, reset
    if (
      selectedAddress &&
      !addresses.find((a) => a.id === selectedAddress.id)
    ) {
      setSelectedAddress(addresses[0] ?? null);
    }
  }, [addresses, selectedAddress]);

  // Fetch contracts when selected address changes
  useEffect(() => {
    if (!selectedAddress) {
      setContracts([]);
      setHolderCounts(new Map());
      return;
    }

    let cancelled = false;

    async function load() {
      setContractsLoading(true);
      try {
        const result = await fetchContracts(
          selectedAddress!.address,
          selectedAddress!.network,
        );
        if (cancelled) return;
        setContracts(result);

        // Fetch holder counts for FT/NFT contracts in parallel
        const ftNft = result.filter(
          (c) => c.kind === 'FT' || c.kind === 'NFT',
        );
        if (ftNft.length > 0) {
          const counts = new Map<string, number>();
          const promises = ftNft.map(async (c) => {
            const id = `A.${c.address}.${c.name}`;
            const count = await fetchHolderCount(
              id,
              c.kind!,
              selectedAddress!.network,
            );
            counts.set(id, count);
          });
          await Promise.allSettled(promises);
          if (!cancelled) setHolderCounts(counts);
        }
      } catch {
        if (!cancelled) setContracts([]);
      } finally {
        if (!cancelled) setContractsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [selectedAddress]);

  // User display name
  const displayName = user?.email || 'User';

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-100">
      {/* Top nav */}
      <header className="flex items-center gap-4 px-4 py-2 border-b border-zinc-700 bg-zinc-900/80 backdrop-blur shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-zinc-400 text-sm">&#9671;</span>
          <span className="text-sm font-semibold tracking-tight">
            FlowIndex Runner
          </span>
        </div>

        <nav className="flex items-center gap-1 ml-4">
          <Link
            to="/editor"
            className="px-3 py-1 text-xs rounded-md transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
          >
            Editor
          </Link>
          <Link
            to="/deploy"
            className={`px-3 py-1 text-xs rounded-md transition-colors ${
              location.pathname.startsWith('/deploy')
                ? 'bg-zinc-800 text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Deploy
          </Link>
        </nav>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User info */}
        {user && (
          <div className="flex items-center gap-2">
            <User className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-400 max-w-[160px] truncate">
              {displayName}
            </span>
            <button
              onClick={signOut}
              className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </header>

      {/* Main area: sidebar + content */}
      <div className="flex flex-1 min-h-0">
        <AddressSidebar
          addresses={addresses}
          selectedAddress={selectedAddress}
          onSelect={setSelectedAddress}
          onAdd={addAddress}
          onRemove={removeAddress}
          loading={addressesLoading}
        />

        <Routes>
          <Route
            index
            element={
              <ContractsGrid
                selectedAddress={selectedAddress}
                contracts={contracts}
                contractsLoading={contractsLoading}
                holderCounts={holderCounts}
                hasAddresses={addresses.length > 0}
              />
            }
          />
          <Route path=":contractId" element={<ContractDetail />} />
        </Routes>
      </div>
    </div>
  );
}
