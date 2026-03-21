/**
 * Token transfer parsing — extracts FT and NFT transfers from raw Flow events.
 *
 * Ported from frontend/app/lib/deriveFromEvents.ts (token-related logic).
 * Does NOT handle full EVM execution parsing or fee extraction.
 */

import {
  parseCadenceEventFields,
  normalizeFlowAddress,
  extractAddressFromFields,
  formatAddr,
  parseContractAddress,
  parseContractName,
} from './cadence.js';
import {
  WRAPPER_CONTRACTS,
  FEE_VAULT_ADDRESS,
  STAKING_CONTRACTS,
} from './constants.js';
import type { RawEvent, FTTransfer, NFTTransfer, TransferType } from './types.js';

// ── Event classification ──

export function classifyTokenEvent(eventType: string): { isToken: boolean; isNFT: boolean } {
  const contractName = parseContractName(eventType);
  // EVM bridge events are NOT standard FT events
  if (contractName === 'EVM') {
    return { isToken: false, isNFT: false };
  }
  // Staking/epoch contract events are NOT token transfer events
  if (STAKING_CONTRACTS.has(contractName)) {
    return { isToken: false, isNFT: false };
  }
  if (eventType.includes('NonFungibleToken.') &&
    (eventType.includes('.Deposited') || eventType.includes('.Withdrawn'))) {
    return { isToken: true, isNFT: true };
  }
  if (eventType.includes('FungibleToken.') &&
    (eventType.includes('.Deposited') || eventType.includes('.Withdrawn'))) {
    return { isToken: true, isNFT: false };
  }
  if (eventType.endsWith('.Deposit') || eventType.endsWith('.Withdraw')) {
    return { isToken: true, isNFT: true };
  }
  if (eventType.includes('.TokensDeposited') || eventType.includes('.TokensWithdrawn')) {
    return { isToken: true, isNFT: false };
  }
  if (eventType.endsWith('.Deposited') || eventType.endsWith('.Withdrawn')) {
    return { isToken: true, isNFT: false };
  }
  // TokensMinted/TokensBurned are evidence events only — used for context flags
  // but don't produce transfer legs (they lack proper from/to fields).
  // Skip them as token events.
  return { isToken: false, isNFT: false };
}

export function isEVMBridgeEvent(eventType: string): boolean {
  return eventType.includes('EVM.FLOWTokensWithdrawn') ||
    eventType.includes('EVM.FLOWTokensDeposited');
}

export function inferDirection(eventType: string, fromAddr: string, toAddr: string): string {
  const lower = eventType.toLowerCase();
  if (lower.includes('withdraw')) return 'withdraw';
  if (lower.includes('deposit')) return 'deposit';
  if (lower.includes('minted')) return 'deposit';
  if (lower.includes('burned')) return 'withdraw';
  if (fromAddr && toAddr) return 'direct';
  if (fromAddr) return 'withdraw';
  if (toAddr) return 'deposit';
  return '';
}

// ── Token leg ──

export interface TokenLeg {
  eventIndex: number;
  contractAddr: string;
  contractName: string;
  amount: string;
  tokenID: string;
  isNFT: boolean;
  direction: string;
  resourceID: string;
  owner: string;
  from: string;
  to: string;
}

export function parseTokenLeg(event: RawEvent, isNFT: boolean): TokenLeg | null {
  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const fields = parseCadenceEventFields(payload);
  if (!fields) return null;

  const amount = String(fields.amount ?? '');
  const toAddr = extractAddressFromFields(fields,
    'to', 'toAddress', 'recipient', 'receiver', 'toAccount', 'toAddr', 'to_address',
    'depositTo', 'depositedTo', 'toVault', 'newOwner');
  const fromAddr = extractAddressFromFields(fields,
    'from', 'fromAddress', 'sender', 'fromAccount', 'fromAddr', 'from_address',
    'withdrawnFrom', 'withdrawFrom', 'fromVault', 'burnedFrom', 'owner');
  const tokenID = String(fields.id ?? fields.tokenId ?? '');

  const eventType = event.type || '';
  const contractAddr = normalizeFlowAddress(event.contract_address) || parseContractAddress(eventType);
  const contractName = parseContractName(eventType);

  if (!isNFT && !amount) return null;

  const direction = inferDirection(eventType, fromAddr, toAddr);
  if (!direction) return null;

  let resourceID = '';
  if (isNFT) {
    resourceID = String(fields.uuid ?? '');
  } else {
    if (direction === 'withdraw') resourceID = String(fields.withdrawnUUID ?? '');
    else if (direction === 'deposit') resourceID = String(fields.depositedUUID ?? '');
    if (!resourceID) resourceID = String(fields.uuid ?? '');
  }

  return {
    eventIndex: event.event_index ?? 0,
    contractAddr,
    contractName,
    amount: isNFT ? '1' : amount,
    tokenID,
    isNFT,
    direction,
    resourceID,
    from: fromAddr,
    to: toAddr,
    owner: direction === 'withdraw' ? fromAddr : toAddr,
  };
}

// ── Transfer key & pairing ──

type TransferKey = string;

export function makeTransferKey(leg: TokenLeg): TransferKey {
  const base = `${leg.contractAddr}:${leg.contractName}:${leg.isNFT}`;
  if (leg.resourceID) return `${base}:rid:${leg.resourceID}`;
  if (leg.isNFT) return `${base}:tid:${leg.tokenID}`;
  return `${base}:amt:${leg.amount}`;
}

interface RawTransfer {
  eventIndex: number;
  token: string;
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenID: string;
  isNFT: boolean;
}

export function buildTokenTransfers(legs: TokenLeg[]): RawTransfer[] {
  const withdrawals = new Map<TransferKey, TokenLeg[]>();
  const deposits = new Map<TransferKey, TokenLeg[]>();
  const out: RawTransfer[] = [];

  const toToken = (leg: TokenLeg) =>
    leg.contractAddr ? `A.${leg.contractAddr}.${leg.contractName}` : leg.contractName;

  for (const leg of legs) {
    if (leg.direction === 'direct') {
      out.push({
        eventIndex: leg.eventIndex,
        token: toToken(leg),
        fromAddress: leg.from,
        toAddress: leg.to,
        amount: leg.amount,
        tokenID: leg.tokenID,
        isNFT: leg.isNFT,
      });
      continue;
    }
    const key = makeTransferKey(leg);
    if (leg.direction === 'withdraw') {
      const arr = withdrawals.get(key) || [];
      arr.push(leg);
      withdrawals.set(key, arr);
    } else if (leg.direction === 'deposit') {
      const arr = deposits.get(key) || [];
      arr.push(leg);
      deposits.set(key, arr);
    }
  }

  // Pair withdrawals with deposits
  for (const [key, outs] of withdrawals.entries()) {
    const ins = deposits.get(key) || [];
    outs.sort((a, b) => a.eventIndex - b.eventIndex);
    ins.sort((a, b) => a.eventIndex - b.eventIndex);
    const pairs = Math.min(outs.length, ins.length);

    for (let i = 0; i < pairs; i++) {
      const w = outs[i], d = ins[i];
      out.push({
        eventIndex: d.eventIndex || w.eventIndex,
        token: toToken(w),
        fromAddress: w.owner,
        toAddress: d.owner,
        amount: w.amount || d.amount,
        tokenID: w.tokenID || d.tokenID,
        isNFT: w.isNFT,
      });
    }
    // Leftovers: burns (withdraw only)
    for (let i = pairs; i < outs.length; i++) {
      const w = outs[i];
      out.push({
        eventIndex: w.eventIndex, token: toToken(w),
        fromAddress: w.owner, toAddress: w.to, amount: w.amount, tokenID: w.tokenID, isNFT: w.isNFT,
      });
    }
    // Leftovers: mints (deposit only)
    for (let i = pairs; i < ins.length; i++) {
      const d = ins[i];
      out.push({
        eventIndex: d.eventIndex, token: toToken(d),
        fromAddress: d.from, toAddress: d.owner, amount: d.amount, tokenID: d.tokenID, isNFT: d.isNFT,
      });
    }
  }

  // Deposits without matching withdrawal key
  for (const [key, ins] of deposits.entries()) {
    if (withdrawals.has(key)) continue;
    ins.sort((a, b) => a.eventIndex - b.eventIndex);
    for (const d of ins) {
      out.push({
        eventIndex: d.eventIndex, token: toToken(d),
        fromAddress: d.from, toAddress: d.owner, amount: d.amount, tokenID: d.tokenID, isNFT: d.isNFT,
      });
    }
  }

  return out;
}

// ── Lightweight EVM from/to extraction (no full RLP decoding) ──

interface EVMFromTo {
  hash: string;
  from: string;
  to: string;
}

function extractEVMFromTo(event: RawEvent): EVMFromTo | null {
  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const fields = parseCadenceEventFields(payload);
  if (!fields) return null;

  let hash = '';
  for (const key of ['hash', 'transactionHash', 'txHash', 'evmHash']) {
    if (key in fields) {
      const v = fields[key];
      if (typeof v === 'string') {
        const s = v.trim().toLowerCase().replace(/^0x/, '');
        if (/^[0-9a-f]+$/.test(s)) { hash = s; break; }
      }
      if (Array.isArray(v)) {
        const hex = v.map((b: any) => (Number(b) & 0xff).toString(16).padStart(2, '0')).join('');
        if (hex) { hash = hex; break; }
      }
    }
  }
  if (!hash) return null;

  function extractHex(...keys: string[]): string {
    for (const key of keys) {
      if (key in fields!) {
        const v = fields![key];
        if (typeof v === 'string') {
          const s = v.trim().toLowerCase().replace(/^0x/, '');
          if (/^[0-9a-f]+$/.test(s)) return s;
        }
        if (Array.isArray(v)) {
          const hex = v.map((b: any) => (Number(b) & 0xff).toString(16).padStart(2, '0')).join('');
          if (hex) return hex;
        }
      }
    }
    return '';
  }

  const from = extractHex('from', 'fromAddress', 'sender');
  const to = extractHex('to', 'toAddress', 'recipient');

  return {
    hash: '0x' + hash,
    from: from ? '0x' + from : '',
    to: to ? '0x' + to : '',
  };
}

// ── Main entry point ──

export function parseTokenEvents(events: RawEvent[]): {
  transfers: FTTransfer[];
  nftTransfers: NFTTransfer[];
} {
  const legs: TokenLeg[] = [];

  // Wrapper events for enriching mint/burn legs
  const wrapperDeposits: { addr: string; amount: string; tokenContract: string }[] = [];
  const wrapperWithdrawals: { addr: string; amount: string; tokenContract: string }[] = [];

  // EVM bridge events for cross-VM FLOW transfer enrichment
  const evmWithdrawals: { coaAddress: string; amount: string }[] = [];
  const evmDeposits: { coaAddress: string; amount: string }[] = [];

  // Lightweight EVM execution info for cross-VM enrichment
  const evmExecs: EVMFromTo[] = [];

  // Scheduled/system txs can move FlowToken into FlowTransactionScheduler as fee escrow.
  // Those legs are operational bookkeeping, not user-facing asset flow.
  const scheduledFeeTransfers: { amount: string; recipient: string }[] = [];

  // Context flags — scan all events once for evidence-based classification
  let hasStakingEvents = false;
  let hasFeesDeducted = false;
  let hasLostFound = false;
  let hasBurnEvent = false;   // explicit TokensBurned / TokensBurnt
  let hasMintEvent = false;   // explicit TokensMinted

  // Pre-scan for context flags before processing legs
  for (const event of events) {
    const et = event.type || '';
    const cn = parseContractName(et);
    const en = et.split('.').pop() || '';
    if (STAKING_CONTRACTS.has(cn) || et.includes('LiquidStaking') || et.includes('stFlowToken')) {
      hasStakingEvents = true;
    }
    if (cn === 'LostAndFound') hasLostFound = true;
    if (cn === 'FlowFees' && en === 'FeesDeducted') hasFeesDeducted = true;
    if (en === 'TokensBurned' || en === 'TokensBurnt') hasBurnEvent = true;
    if (en === 'TokensMinted') hasMintEvent = true;
    if (et.includes('FlowTransactionScheduler.Scheduled')) {
      try {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        const fields = parseCadenceEventFields(payload);
        const amount = String(fields?.fees ?? '');
        const recipient = normalizeFlowAddress(event.contract_address) || parseContractAddress(et);
        if (amount && recipient) {
          scheduledFeeTransfers.push({ amount, recipient });
        }
      } catch {
        // Best-effort only; malformed scheduler payloads should not break token decode.
      }
    }
  }

  for (const event of events) {
    const eventType = event.type || '';

    // EVM bridge events
    if (isEVMBridgeEvent(eventType)) {
      try {
        const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
        const fields = parseCadenceEventFields(payload);
        if (fields) {
          const amount = String(fields.amount ?? '');
          const addr = String(fields.address ?? '');
          if (amount && addr) {
            const coaAddress = addr.toLowerCase().replace(/^0x/, '');
            if (eventType.includes('FLOWTokensWithdrawn')) {
              evmWithdrawals.push({ coaAddress, amount });
            } else {
              evmDeposits.push({ coaAddress, amount });
            }
          }
        }
      } catch { /* skip */ }
      continue;
    }

    // Token events
    const { isToken, isNFT } = classifyTokenEvent(eventType);
    if (isToken) {
      try {
        const leg = parseTokenLeg(event, isNFT);
        if (!leg) continue;
        if (WRAPPER_CONTRACTS.has(leg.contractName)) {
          // Extract specific token contract from payload `type` field
          const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
          const vaultType = payload?.type || '';
          const parts = vaultType.split('.');
          const tokenContract = parts.length >= 3 ? `${normalizeFlowAddress(parts[1])}:${parts[2]}` : '';
          if (tokenContract) {
            if (leg.direction === 'deposit' && leg.to) {
              wrapperDeposits.push({ addr: leg.to, amount: leg.amount, tokenContract });
            } else if (leg.direction === 'withdraw' && leg.from) {
              wrapperWithdrawals.push({ addr: leg.from, amount: leg.amount, tokenContract });
            }
          }
        } else {
          legs.push(leg);
        }
      } catch { /* skip malformed events */ }
    }

    // EVM.TransactionExecuted — lightweight extraction for cross-VM enrichment
    if (eventType.includes('EVM.TransactionExecuted')) {
      try {
        const exec = extractEVMFromTo(event);
        if (exec) evmExecs.push(exec);
      } catch { /* skip */ }
    }

  }

  // Enrich mint/burn legs with addresses from wrapper events
  for (const leg of legs) {
    const legKey = `${leg.contractAddr}:${leg.contractName}`;
    if (leg.direction === 'deposit' && !leg.owner) {
      const wrapper = wrapperDeposits.find(w => w.tokenContract === legKey && w.amount === leg.amount);
      if (wrapper) {
        leg.to = wrapper.addr;
        leg.owner = wrapper.addr;
      }
    } else if (leg.direction === 'withdraw' && !leg.owner) {
      const wrapper = wrapperWithdrawals.find(w => w.tokenContract === legKey && w.amount === leg.amount);
      if (wrapper) {
        leg.from = wrapper.addr;
        leg.owner = wrapper.addr;
      }
    }
  }

  // Enrich unpaired FlowToken legs with COA addresses from EVM bridge events
  const usedEvmW = new Set<number>();
  for (const leg of legs) {
    if (leg.contractName === 'FlowToken' && leg.direction === 'deposit' && !leg.from) {
      const idx = evmWithdrawals.findIndex((ew, i) => !usedEvmW.has(i) && ew.amount === leg.amount);
      if (idx >= 0) {
        leg.from = evmWithdrawals[idx].coaAddress;
        usedEvmW.add(idx);
      }
    }
  }
  const usedEvmD = new Set<number>();
  for (const leg of legs) {
    if (leg.contractName === 'FlowToken' && leg.direction === 'withdraw' && !leg.to) {
      const idx = evmDeposits.findIndex((ed, i) => !usedEvmD.has(i) && ed.amount === leg.amount);
      if (idx >= 0) {
        leg.to = evmDeposits[idx].coaAddress;
        usedEvmD.add(idx);
      }
    }
  }

  // Build transfers from paired legs
  const allTransfers = buildTokenTransfers(legs);

  // Evidence-based classification
  function classifyTransferType(t: RawTransfer): TransferType {
    const isFlowToken = t.token.includes('FlowToken');
    const hasFrom = !!t.fromAddress;
    const hasTo = !!t.toAddress;

    if (hasFrom && hasTo) return 'transfer';

    // Unpaired withdraw (from only, no to)
    if (hasFrom && !hasTo) {
      if (hasStakingEvents && isFlowToken) return 'stake';
      if (hasBurnEvent) return 'burn';
      // Small FlowToken in fee tx → likely fee noise, still classify as transfer
      return 'transfer';
    }

    // Unpaired deposit (to only, no from)
    if (!hasFrom && hasTo) {
      if (hasStakingEvents && isFlowToken) return 'unstake';
      if (hasMintEvent) return 'mint';
      return 'transfer';
    }

    return 'transfer';
  }

  // Duplicate leg filtering — remove unpaired legs that have a matching paired transfer
  function isDuplicateUnpaired(t: RawTransfer): boolean {
    if (t.fromAddress && t.toAddress) return false; // already paired
    if (t.isNFT) return false;
    return allTransfers.some(candidate => {
      if (candidate === t || candidate.eventIndex === t.eventIndex) return false;
      if (candidate.token !== t.token) return false;
      if (candidate.amount !== t.amount) return false;
      // Unpaired withdraw: duplicate if there's a paired transfer from the same address
      if (t.fromAddress && !t.toAddress) {
        return candidate.fromAddress === t.fromAddress && !!candidate.toAddress;
      }
      // Unpaired deposit: duplicate if there's a paired transfer to the same address
      if (!t.fromAddress && t.toAddress) {
        return candidate.toAddress === t.toAddress && !!candidate.fromAddress;
      }
      return false;
    });
  }

  // Split into FT and NFT, filter fee vault transfers + duplicates
  const ftTransfers: FTTransfer[] = [];
  const nftTransfers: NFTTransfer[] = [];

  for (const t of allTransfers) {
    const fromNorm = normalizeFlowAddress(t.fromAddress);
    const toNorm = normalizeFlowAddress(t.toAddress);
    // Filter fee vault transfers
    if (fromNorm === FEE_VAULT_ADDRESS || toNorm === FEE_VAULT_ADDRESS) continue;
    // Filter scheduled fee payments into FlowTransactionScheduler.
    if (
      t.token.includes('FlowToken') &&
      scheduledFeeTransfers.some((fee) => fee.amount === t.amount && toNorm === fee.recipient)
    ) continue;
    // Filter small FlowToken noise in fee transactions
    if (hasFeesDeducted && t.token.includes('FlowToken') && !t.fromAddress !== !t.toAddress) {
      const amount = parseFloat(t.amount) || 0;
      if (amount > 0 && amount < 0.01) continue;
    }
    // Filter duplicate unpaired legs
    if (isDuplicateUnpaired(t)) continue;

    const transferType = classifyTransferType(t);

    if (t.isNFT) {
      nftTransfers.push({
        token: t.token,
        from_address: formatAddr(t.fromAddress),
        to_address: formatAddr(t.toAddress),
        token_id: t.tokenID,
        event_index: t.eventIndex,
        transfer_type: transferType,
      });
    } else {
      ftTransfers.push({
        token: t.token,
        from_address: formatAddr(t.fromAddress),
        to_address: formatAddr(t.toAddress),
        amount: t.amount,
        event_index: t.eventIndex,
        transfer_type: transferType,
      });
    }
  }

  // Enrich cross-VM FlowToken transfers with actual EVM destination/source
  if (evmExecs.length > 0 && ftTransfers.length > 0) {
    for (const ft of ftTransfers) {
      if (!ft.token.includes('FlowToken')) continue;
      const toNorm = normalizeFlowAddress(ft.to_address);
      const fromNorm = normalizeFlowAddress(ft.from_address);
      // COA addresses: 40 hex chars with 10+ leading zeros
      const isToCOA = toNorm.length > 16 && /^0{10,}/.test(toNorm);
      const isFromCOA = fromNorm.length > 16 && /^0{10,}/.test(fromNorm);
      if (isToCOA) {
        const exec = evmExecs.find(e => {
          const execFrom = normalizeFlowAddress(e.from);
          return execFrom === toNorm && e.to;
        });
        if (exec) {
          ft.evm_to_address = exec.to;
        }
      }
      if (isFromCOA) {
        const exec = evmExecs.find(e => {
          const execTo = normalizeFlowAddress(e.to);
          return execTo === fromNorm && e.from;
        });
        if (exec) {
          ft.evm_from_address = exec.from;
        }
      }
    }
  }

  return {
    transfers: ftTransfers,
    nftTransfers,
  };
}
