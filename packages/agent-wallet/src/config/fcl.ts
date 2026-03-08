import type { FlowNetwork } from './networks.js';
import { NETWORK_CONFIG } from './networks.js';

export async function configureFcl(network: FlowNetwork) {
  const fcl = await import('@onflow/fcl');
  const config = NETWORK_CONFIG[network];

  fcl.config()
    .put('accessNode.api', config.accessNode)
    .put('flow.network', network);

  for (const [name, address] of Object.entries(config.contracts)) {
    fcl.config().put(`0x${name}`, address);
  }
}
