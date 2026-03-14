import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { flowEvmMainnet, flowEvmTestnet } from './evmChains';

export const wagmiConfig = createConfig({
  chains: [flowEvmMainnet, flowEvmTestnet],
  connectors: [injected()],
  transports: {
    [flowEvmMainnet.id]: http(),
    [flowEvmTestnet.id]: http(),
  },
});
