/**
 * FCL (Flow Client Library) configuration.
 *
 * Reads contract alias addresses from `cadence/addresses.json` and
 * configures FCL so that Cadence scripts using aliases like `0xFlowToken`
 * are automatically resolved to the correct on-chain addresses.
 *
 * Import this module as early as possible (e.g. in client.tsx) to ensure
 * FCL is configured before any queries are executed.
 */
import * as fcl from '@onflow/fcl';
import addresses from '../cadence/addresses.json';
import { CadenceService } from '../cadence/cadence.gen';

// Determine network: runtime env (browser) > process.env (SSR) > Vite env > default to mainnet
const network: string =
    (typeof window !== 'undefined' && (window as any).__FLOWSCAN_ENV__?.FLOW_NETWORK) ||
    (typeof process !== 'undefined' && process.env?.FLOW_NETWORK) ||
    import.meta.env.VITE_FLOW_NETWORK ||
    'mainnet';

const ACCESS_NODES: Record<string, string> = {
    mainnet: 'https://rest-mainnet.onflow.org',
    testnet: 'https://rest-testnet.onflow.org',
};

const networkAddresses = addresses[network as keyof typeof addresses] || addresses.mainnet;

// Build the config map
const fclConfigMap: Record<string, string> = {
    'accessNode.api': ACCESS_NODES[network] || ACCESS_NODES.mainnet,
    'flow.network': network,
};

// Map each alias (e.g. "0xFlowToken") to its real on-chain address
for (const [alias, addr] of Object.entries(networkAddresses)) {
    fclConfigMap[alias] = addr;
}

fcl.config(fclConfigMap);

/** Pre-configured CadenceService singleton, ready for use across the app. */
export const cadenceService = new CadenceService();

export { network };
