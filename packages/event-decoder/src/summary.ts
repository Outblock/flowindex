import type { DecodedEvents, DecodedSummaryItem, SystemEvent } from './types.js';

function formatTokenName(token: string): string {
  const parts = token.split('.');
  return parts[parts.length - 1] || token;
}

function formatAmount(amount: string): string {
  const n = Number(amount);
  if (isNaN(n)) return amount;
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

const STAKING_LABELS: Record<string, string> = {
  TokensStaked: 'Staked',
  TokensUnstaked: 'Unstaked',
  TokensCommitted: 'Committed',
  RewardsPaid: 'Received staking reward of',
  DelegatorRewardsPaid: 'Received delegation reward of',
  NewNodeCreated: 'Registered new node',
  TokensRequestedToUnstake: 'Requested unstake of',
  StakeNewTokens: 'Staked',
};

function findVaultOrCollectionSetup(systemEvents: SystemEvent[]): { type: 'vault' | 'collection'; name: string } | null {
  for (const ev of systemEvents) {
    if (ev.category !== 'capability' || !ev.capabilityType) continue;
    if (ev.capabilityType.includes('FungibleToken.Vault') || ev.capabilityType.endsWith('.Vault')) {
      // Extract token name: "A.xxx.USDC.Vault" → "USDC"
      const parts = ev.capabilityType.split('.');
      const vaultIdx = parts.indexOf('Vault');
      const name = vaultIdx > 0 ? parts[vaultIdx - 1] : parts[parts.length - 2] || 'unknown';
      return { type: 'vault', name };
    }
    if (ev.capabilityType.includes('NonFungibleToken.Collection') || ev.capabilityType.endsWith('.Collection')) {
      const parts = ev.capabilityType.split('.');
      const collIdx = parts.indexOf('Collection');
      const name = collIdx > 0 ? parts[collIdx - 1] : parts[parts.length - 2] || 'unknown';
      return { type: 'collection', name };
    }
  }
  return null;
}

function summarizeAccountCreation(systemEvents: SystemEvent[]): string | null {
  const ev = systemEvents.find(e => e.category === 'account' && e.action === 'created');
  if (ev) return `Created account ${ev.address}`;
  return null;
}

function summarizeContractDeploy(systemEvents: SystemEvent[]): string | null {
  const ev = systemEvents.find(e => e.action === 'contract_deployed');
  if (ev) return `Deployed ${ev.contractName || 'contract'} to ${ev.address}`;
  return null;
}

function summarizeContractUpdate(systemEvents: SystemEvent[]): string | null {
  const ev = systemEvents.find(e => e.action === 'contract_updated');
  if (ev) return `Updated ${ev.contractName || 'contract'} on ${ev.address}`;
  return null;
}

function summarizeSetup(systemEvents: SystemEvent[]): string | null {
  const setup = findVaultOrCollectionSetup(systemEvents);
  if (!setup) return null;
  if (setup.type === 'vault') return `Enabled ${setup.name} token`;
  return `Enabled ${setup.name} NFT collection`;
}

function summarizeSwap(decoded: DecodedEvents): string | null {
  const swap = decoded.defiEvents.find(e => e.action === 'Swap');
  if (!swap) return null;
  return `Swapped ${formatAmount(swap.amountIn)} ${swap.tokenIn || '?'} → ${formatAmount(swap.amountOut)} ${swap.tokenOut || '?'}`;
}

function summarizeLiquidity(decoded: DecodedEvents): string | null {
  const add = decoded.defiEvents.find(e => e.action === 'AddLiquidity');
  if (add) return 'Added liquidity';
  const remove = decoded.defiEvents.find(e => e.action === 'RemoveLiquidity');
  if (remove) return 'Removed liquidity';
  return null;
}

function summarizeStaking(decoded: DecodedEvents): string | null {
  const ev = decoded.stakingEvents[0];
  if (!ev) return null;
  const label = STAKING_LABELS[ev.action] || ev.action;
  if (ev.action === 'NewNodeCreated') return label;
  return `${label} ${formatAmount(ev.amount)} FLOW`;
}

function summarizeFTTransfer(decoded: DecodedEvents): string | null {
  const ft = decoded.transfers[0];
  if (!ft) return null;
  const name = formatTokenName(ft.token);
  const typeLabel = ft.transfer_type === 'mint' ? 'Minted' : ft.transfer_type === 'burn' ? 'Burned' : 'Transferred';
  return `${typeLabel} ${formatAmount(ft.amount)} ${name}`;
}

function summarizeNFTTransfer(decoded: DecodedEvents): string | null {
  const nft = decoded.nftTransfers[0];
  if (!nft) return null;
  const name = formatTokenName(nft.token);
  const typeLabel = nft.transfer_type === 'mint' ? 'Minted' : nft.transfer_type === 'burn' ? 'Burned' : 'Transferred';
  return `${typeLabel} ${name} #${nft.token_id}`;
}

function summarizeEVM(decoded: DecodedEvents): string | null {
  const evm = decoded.evmExecutions[0];
  if (!evm) return null;
  return `EVM call to ${evm.to}`;
}

function summarizeContractImports(decoded: DecodedEvents): string | null {
  if (decoded.contractImports.length === 0) return null;
  const names = decoded.contractImports.slice(0, 3).map(c => formatTokenName(c)).filter(Boolean);
  const suffix = decoded.contractImports.length > 3 ? ` +${decoded.contractImports.length - 3} more` : '';
  return `Called ${names.join(', ')}${suffix}`;
}

export function buildSummary(decoded: DecodedEvents): string {
  return (
    summarizeAccountCreation(decoded.systemEvents) ??
    summarizeContractDeploy(decoded.systemEvents) ??
    summarizeContractUpdate(decoded.systemEvents) ??
    summarizeSetup(decoded.systemEvents) ??
    summarizeSwap(decoded) ??
    summarizeLiquidity(decoded) ??
    summarizeStaking(decoded) ??
    summarizeFTTransfer(decoded) ??
    summarizeNFTTransfer(decoded) ??
    summarizeEVM(decoded) ??
    summarizeContractImports(decoded) ??
    ''
  );
}

export function buildSummaryItems(decoded: DecodedEvents): DecodedSummaryItem[] {
  const items: DecodedSummaryItem[] = [];

  // System events
  for (const ev of decoded.systemEvents) {
    if (ev.category === 'account' && ev.action === 'created') {
      items.push({ icon: 'account', text: `Created account ${ev.address}` });
    } else if (ev.action === 'contract_deployed') {
      items.push({ icon: 'contract', text: `Deployed ${ev.contractName || 'contract'} to ${ev.address}` });
    } else if (ev.action === 'contract_updated') {
      items.push({ icon: 'contract', text: `Updated ${ev.contractName || 'contract'} on ${ev.address}` });
    }
  }

  // Vault/collection setup
  const setup = findVaultOrCollectionSetup(decoded.systemEvents);
  if (setup) {
    items.push({
      icon: 'capability',
      text: setup.type === 'vault' ? `Enabled ${setup.name} token` : `Enabled ${setup.name} NFT collection`,
    });
  }

  // DeFi events
  for (const ev of decoded.defiEvents) {
    if (ev.action === 'Swap') {
      items.push({ icon: 'swap', text: `Swapped ${formatAmount(ev.amountIn)} ${ev.tokenIn || '?'} → ${formatAmount(ev.amountOut)} ${ev.tokenOut || '?'}` });
    } else if (ev.action === 'AddLiquidity') {
      items.push({ icon: 'swap', text: 'Added liquidity' });
    } else if (ev.action === 'RemoveLiquidity') {
      items.push({ icon: 'swap', text: 'Removed liquidity' });
    }
  }

  // Staking events
  for (const ev of decoded.stakingEvents) {
    const label = STAKING_LABELS[ev.action] || ev.action;
    const text = ev.action === 'NewNodeCreated' ? label : `${label} ${formatAmount(ev.amount)} FLOW`;
    items.push({ icon: 'stake', text });
  }

  // FT transfers
  for (const ft of decoded.transfers) {
    const name = formatTokenName(ft.token);
    const typeLabel = ft.transfer_type === 'mint' ? 'Minted' : ft.transfer_type === 'burn' ? 'Burned' : 'Transferred';
    items.push({ icon: 'transfer', text: `${typeLabel} ${formatAmount(ft.amount)} ${name}` });
  }

  // NFT transfers
  for (const nft of decoded.nftTransfers) {
    const name = formatTokenName(nft.token);
    const typeLabel = nft.transfer_type === 'mint' ? 'Minted' : nft.transfer_type === 'burn' ? 'Burned' : 'Transferred';
    items.push({ icon: 'nft', text: `${typeLabel} ${name} #${nft.token_id}` });
  }

  // EVM executions
  for (const evm of decoded.evmExecutions) {
    items.push({ icon: 'evm', text: `EVM call to ${evm.to}` });
  }

  return items;
}
