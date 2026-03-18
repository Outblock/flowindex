// runner/src/interact/InteractPage.tsx
import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, FlaskConical } from 'lucide-react';
import type { Abi } from 'viem';
import type { Chain } from 'viem/chains';
import type { DeployedContract } from '../flow/evmContract';
import { flowEvmMainnet, flowEvmTestnet } from '../flow/evmChains';
import ContractInteraction from '../components/ContractInteraction';
import ContractLoader from './ContractLoader';
import RecentContracts, { type RecentContract, loadRecentContracts, saveRecentContract, removeRecentContract } from './RecentContracts';

function getChain(network: string): Chain {
  return network === 'testnet' ? flowEvmTestnet : flowEvmMainnet;
}

export default function InteractPage() {
  // Read URL params
  const params = new URLSearchParams(window.location.search);
  const initialAddress = params.get('address') || '';
  const initialNetwork = params.get('network') || localStorage.getItem('runner:network') || 'mainnet';

  const [network, setNetwork] = useState<'mainnet' | 'testnet'>(
    initialNetwork === 'testnet' ? 'testnet' : 'mainnet',
  );
  const [contract, setContract] = useState<DeployedContract | null>(null);
  const [recentContracts, setRecentContracts] = useState<RecentContract[]>(loadRecentContracts);

  // Sync URL when contract loads
  useEffect(() => {
    if (contract) {
      const url = new URL(window.location.href);
      url.searchParams.set('address', contract.address);
      url.searchParams.set('network', network);
      window.history.replaceState({}, '', url.toString());
    }
  }, [contract, network]);

  const handleContractLoaded = useCallback((address: `0x${string}`, name: string, abi: Abi) => {
    setContract({
      address,
      name,
      abi,
      chainId: network === 'testnet' ? 545 : 747,
    });
    const entry = saveRecentContract({ address, network, name, timestamp: Date.now() });
    setRecentContracts(entry);
  }, [network]);

  // Navigate with URL params so ContractLoader auto-fetches on page load
  const handleSelectRecent = useCallback((recent: RecentContract) => {
    const url = new URL(window.location.href);
    url.searchParams.set('address', recent.address);
    url.searchParams.set('network', recent.network);
    window.location.href = url.toString();
  }, []);

  const handleRemoveRecent = useCallback((c: RecentContract) => {
    const updated = removeRecentContract(c.address, c.network);
    setRecentContracts(updated);
  }, []);

  const chain = getChain(network);

  return (
    <div className="flex flex-col h-screen bg-zinc-900 text-zinc-200">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-zinc-700 bg-zinc-900 shrink-0">
        <Link
          to="/editor"
          className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
          onClick={(e) => { e.preventDefault(); window.location.href = '/editor'; }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Editor
        </Link>
        <div className="w-px h-4 bg-zinc-700" />
        <FlaskConical className="w-4 h-4 text-violet-400" />
        <h1 className="text-sm font-medium">Contract Test</h1>
      </div>

      {/* Contract Loader — always full-width at top */}
      <div className="px-4 py-3 border-b border-zinc-700/50 bg-zinc-900/80 shrink-0">
        <div className={contract ? '' : 'max-w-2xl mx-auto'}>
          <ContractLoader
            initialAddress={initialAddress}
            network={network}
            onNetworkChange={setNetwork}
            onContractLoaded={handleContractLoaded}
          />
        </div>
      </div>

      {/* Main content area */}
      {!contract ? (
        /* No contract loaded: centered single-column with recent contracts */
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 py-6">
            {recentContracts.length > 0 && (
              <RecentContracts
                contracts={recentContracts}
                onSelect={handleSelectRecent}
                onRemove={handleRemoveRecent}
              />
            )}
          </div>
        </div>
      ) : (
        /* Contract loaded: three-column layout */
        <ContractInteraction contract={contract} chain={chain} />
      )}
    </div>
  );
}
