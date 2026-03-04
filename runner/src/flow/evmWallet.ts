import { useState, useCallback, useEffect } from 'react';
import { BrowserProvider, type Signer } from 'ethers';
import { EVM_NETWORKS, type FlowNetwork } from './networks';

export function useEvmWallet(network: FlowNetwork) {
  const [address, setAddress] = useState<string | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [provider, setProvider] = useState<BrowserProvider | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const evmNetwork = EVM_NETWORKS[network];

  // Listen for account/chain changes
  useEffect(() => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) return;

    const handleAccountsChanged = (accounts: string[]) => {
      if (accounts.length === 0) {
        setAddress(null);
        setSigner(null);
        setProvider(null);
      } else {
        setAddress(accounts[0]);
      }
    };

    const handleChainChanged = () => {
      // Reload provider on chain change
      if (address) {
        const p = new BrowserProvider(ethereum);
        setProvider(p);
        p.getSigner().then(setSigner).catch(() => setSigner(null));
        p.getNetwork().then(n => setChainId(Number(n.chainId))).catch(() => {});
      }
    };

    ethereum.on('accountsChanged', handleAccountsChanged);
    ethereum.on('chainChanged', handleChainChanged);

    // Check if already connected
    ethereum.request({ method: 'eth_accounts' }).then((accounts: string[]) => {
      if (accounts.length > 0) {
        handleAccountsChanged(accounts);
        const p = new BrowserProvider(ethereum);
        setProvider(p);
        p.getSigner().then(setSigner).catch(() => {});
        p.getNetwork().then(n => setChainId(Number(n.chainId))).catch(() => {});
      }
    }).catch(() => {});

    return () => {
      ethereum.removeListener('accountsChanged', handleAccountsChanged);
      ethereum.removeListener('chainChanged', handleChainChanged);
    };
  }, [address]);

  const connect = useCallback(async () => {
    const ethereum = (window as any).ethereum;
    if (!ethereum) {
      window.open('https://metamask.io/download/', '_blank');
      return;
    }

    // Request accounts
    const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
    if (accounts.length > 0) {
      setAddress(accounts[0]);
      const p = new BrowserProvider(ethereum);
      setProvider(p);
      const s = await p.getSigner();
      setSigner(s);
      const n = await p.getNetwork();
      setChainId(Number(n.chainId));
    }

    // Switch to Flow EVM network
    await switchChain(ethereum);
  }, [evmNetwork]);

  const switchChain = useCallback(async (ethereum?: any) => {
    const eth = ethereum || (window as any).ethereum;
    if (!eth) return;

    const chainIdHex = '0x' + evmNetwork.chainId.toString(16);
    try {
      await eth.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: chainIdHex }],
      });
    } catch (switchError: any) {
      // Chain not added yet, add it
      if (switchError.code === 4902) {
        await eth.request({
          method: 'wallet_addEthereumChain',
          params: [{
            chainId: chainIdHex,
            chainName: evmNetwork.name,
            rpcUrls: [evmNetwork.rpcUrl],
            nativeCurrency: { name: 'FLOW', symbol: 'FLOW', decimals: 18 },
            blockExplorerUrls: ['https://evm.flowscan.io'],
          }],
        });
      }
    }
  }, [evmNetwork]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setSigner(null);
    setProvider(null);
    setChainId(null);
  }, []);

  const isCorrectChain = chainId === evmNetwork.chainId;

  return {
    address,
    signer,
    provider,
    chainId,
    isCorrectChain,
    connect,
    disconnect,
    switchChain: () => switchChain(),
    hasMetaMask: typeof (window as any)?.ethereum !== 'undefined',
  };
}
