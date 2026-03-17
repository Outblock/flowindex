import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { flowEvmMainnet, flowEvmTestnet } from './evmChains';

export const wagmiConfig = getDefaultConfig({
  appName: 'FlowIndex Runner',
  projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4', // placeholder — replace with real WalletConnect project ID
  chains: [flowEvmMainnet, flowEvmTestnet],
});
