import type { RawEvent } from './types.js';

/**
 * Derive transaction tags from a list of raw events.
 *
 * Tags are derived purely from event type strings — no payload parsing needed.
 * Ported from backend/internal/ingester/tx_contracts_worker.go lines 221-263.
 */
export function deriveTags(events: RawEvent[]): string[] {
  const tags = new Set<string>();

  for (const evt of events) {
    const t = evt.type;

    if (t.includes('EVM.TransactionExecuted')) {
      tags.add('EVM');
    }

    if (
      t.includes('EVM.FLOWTokensWithdrawn') ||
      t.includes('EVM.FLOWTokensDeposited') ||
      t.includes('FlowEVMBridge')
    ) {
      tags.add('EVM_BRIDGE');
    }

    if (t.includes('NFTStorefront')) {
      tags.add('MARKETPLACE');
    }

    if (t.includes('AccountContractAdded') || t.includes('AccountContractUpdated')) {
      tags.add('CONTRACT_DEPLOY');
    }

    if (t === 'flow.AccountCreated') {
      tags.add('ACCOUNT_CREATED');
    }

    if (t.includes('AccountKeyAdded') || t.includes('AccountKeyRemoved')) {
      tags.add('KEY_UPDATE');
    }

    if (t.includes('FlowTransactionScheduler')) {
      tags.add('SCHEDULED_TX');
    }

    if (
      t.includes('.SwapPair.Swap') ||
      t.includes('.BloctoSwapPair.Swap') ||
      t.includes('.MetaPierSwapPair.Swap')
    ) {
      tags.add('SWAP');
    }

    if (t.includes('.SwapPair.AddLiquidity') || t.includes('.SwapPair.RemoveLiquidity')) {
      tags.add('LIQUIDITY');
    }

    if (
      t.includes('.FlowIDTableStaking.TokensStaked') ||
      t.includes('.FlowIDTableStaking.TokensUnstaked') ||
      t.includes('.FlowIDTableStaking.TokensCommitted') ||
      t.includes('.FlowIDTableStaking.RewardsPaid') ||
      t.includes('.FlowIDTableStaking.DelegatorRewardsPaid') ||
      t.includes('FlowStakingCollection')
    ) {
      tags.add('STAKING');
    }

    if (t.includes('LiquidStaking') || t.includes('stFlowToken')) {
      tags.add('LIQUID_STAKING');
    }

    if (t.includes('.TokensMinted') && !t.includes('FlowToken.TokensMinted')) {
      tags.add('TOKEN_MINT');
    }

    if (t.includes('.TokensBurned') && !t.includes('FlowToken.TokensBurned')) {
      tags.add('TOKEN_BURN');
    }
  }

  return Array.from(tags);
}
