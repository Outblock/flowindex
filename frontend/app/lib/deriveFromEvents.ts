/**
 * Derives FT/NFT transfers, fee, EVM executions, and contract imports
 * from raw transaction events and script — replacing the backend enrichments endpoint.
 *
 * Port of backend logic from:
 *   - internal/ingester/token_worker.go (transfer parsing)
 *   - internal/ingester/evm_hash_parser.go (EVM parsing)
 */

// ── Types ──

export type TransferType = 'transfer' | 'mint' | 'burn';

export interface FTTransfer {
  token: string;
  from_address: string;
  to_address: string;
  amount: string;
  event_index: number;
  transfer_type: TransferType;
  /** Actual EVM destination when the Cadence-level `to` is a COA bridge */
  evm_to_address?: string;
  /** Actual EVM source when the Cadence-level `from` is a COA bridge */
  evm_from_address?: string;
}

export interface NFTTransfer {
  token: string;
  from_address: string;
  to_address: string;
  token_id: string;
  event_index: number;
  transfer_type: TransferType;
}

export interface EVMExecution {
  hash: string;
  from: string;
  to: string;
  gas_used: string;
  gas_limit: string;
  gas_price: string;
  value: string;
  status: string;
  event_index: number;
  block_number?: number;
  type?: number;
  nonce?: number;
  position?: number;
}

export interface DerivedEnrichments {
  ft_transfers: FTTransfer[];
  nft_transfers: NFTTransfer[];
  evm_executions: EVMExecution[];
  fee: number;
  contract_imports: string[];
}

// ── Cadence payload parsing (mirrors backend parseCadenceEventFields) ──

function parseCadenceValue(v: any): any {
  if (v == null) return v;
  if (typeof v !== 'object') return v;
  if (Array.isArray(v)) return v;

  const typeName = v.type as string | undefined;
  const raw = v.value;

  switch (typeName) {
    case 'Optional':
      return raw == null ? null : parseCadenceValue(raw);
    case 'Address':
    case 'UFix64': case 'UInt64': case 'UInt32': case 'UInt16': case 'UInt8':
    case 'Int': case 'Int64': case 'Int32': case 'Int16': case 'Int8': case 'Fix64':
    case 'String': case 'Bool':
      return raw;
    case 'Array':
      if (Array.isArray(raw)) return raw.map(parseCadenceValue);
      return raw;
    case 'Struct': case 'Resource': case 'Event':
      if (raw && typeof raw === 'object' && Array.isArray(raw.fields)) {
        const out: Record<string, any> = {};
        for (const f of raw.fields) {
          if (f && typeof f === 'object' && f.name) {
            out[f.name] = parseCadenceValue(f.value);
          }
        }
        return out;
      }
      return raw;
    default:
      return raw ?? v;
  }
}

function parseCadenceEventFields(payload: any): Record<string, any> | null {
  if (!payload || typeof payload !== 'object') return null;

  // Already flattened
  if ('amount' in payload) return payload;

  const val = payload.value;
  if (!val || typeof val !== 'object') return payload;

  const fields = val.fields;
  if (!Array.isArray(fields)) return payload;

  const out: Record<string, any> = {};
  for (const f of fields) {
    if (f && typeof f === 'object' && f.name) {
      out[f.name] = parseCadenceValue(f.value);
    }
  }
  return out;
}

// ── Address helpers ──

function normalizeFlowAddress(addr: string | null | undefined): string {
  if (!addr || typeof addr !== 'string') return '';
  let s = addr.trim().toLowerCase();
  s = s.replace(/^0x/, '');
  if (!s || !/^[0-9a-f]+$/.test(s)) return '';
  return s;
}

function extractAddress(v: any): string {
  if (typeof v === 'string') return normalizeFlowAddress(v);
  if (v && typeof v === 'object') {
    if (v.address) return normalizeFlowAddress(String(v.address));
    if (v.type === 'Optional') return extractAddress(v.value);
    if (v.type === 'Address') return normalizeFlowAddress(String(v.value));
    if (v.value != null) {
      if (typeof v.value === 'object') return extractAddress(v.value);
      return normalizeFlowAddress(String(v.value));
    }
  }
  return '';
}

function extractAddressFromFields(fields: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in fields) {
      const addr = extractAddress(fields[key]);
      if (addr) return addr;
    }
  }
  return '';
}

function formatAddr(addr: string): string {
  if (!addr) return '';
  return addr.startsWith('0x') ? addr : '0x' + addr;
}

// ── Event classification (mirrors backend classifyTokenEvent) ──

const WRAPPER_CONTRACTS = new Set(['FungibleToken', 'NonFungibleToken']);
const FEE_VAULT_ADDRESS = 'f919ee77447b7497';

const STAKING_CONTRACTS = new Set([
  'FlowIDTableStaking', 'FlowStakingCollection', 'LockedTokens', 'FlowEpoch',
  'FlowDKG', 'FlowClusterQC',
]);

function classifyTokenEvent(eventType: string): { isToken: boolean; isNFT: boolean } {
  const contractName = parseContractName(eventType);
  // EVM bridge events (EVM.FLOWTokensWithdrawn/Deposited) are NOT standard FT events
  if (contractName === 'EVM') {
    return { isToken: false, isNFT: false };
  }
  // Staking/epoch contract events (e.g. FlowIDTableStaking.TokensWithdrawn) are NOT
  // token transfer events — they track staking state changes, not FT movements.
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
  // Mint/Burn events (skip FlowToken system-level mints/burns)
  if ((eventType.includes('.TokensMinted') || eventType.includes('.TokensBurned')) &&
    !eventType.includes('FlowToken.')) {
    return { isToken: true, isNFT: false };
  }
  return { isToken: false, isNFT: false };
}

function isEVMBridgeEvent(eventType: string): boolean {
  return eventType.includes('EVM.FLOWTokensWithdrawn') ||
    eventType.includes('EVM.FLOWTokensDeposited');
}

function parseContractAddress(eventType: string): string {
  const parts = eventType.split('.');
  if (parts.length >= 3 && parts[0] === 'A') {
    return normalizeFlowAddress(parts[1]);
  }
  return '';
}

function parseContractName(eventType: string): string {
  const parts = eventType.split('.');
  if (parts.length >= 3 && parts[0] === 'A') {
    return parts[2].trim();
  }
  return '';
}

function inferDirection(eventType: string, fromAddr: string, toAddr: string): string {
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

// ── Transfer leg & pairing (mirrors backend buildTokenTransfers) ──

interface TokenLeg {
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

function parseTokenLeg(event: any, isNFT: boolean): TokenLeg | null {
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

  if (isNFT && !amount) { /* NFT amount is always 1 */ }
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

  const leg: TokenLeg = {
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
  return leg;
}

type TransferKey = string;

function makeTransferKey(leg: TokenLeg): TransferKey {
  const base = `${leg.contractAddr}:${leg.contractName}:${leg.isNFT}`;
  if (leg.resourceID) return `${base}:rid:${leg.resourceID}`;
  if (leg.isNFT) return `${base}:tid:${leg.tokenID}`;
  return `${base}:amt:${leg.amount}`;
}

interface RawTransfer {
  eventIndex: number;
  token: string;  // A.{addr}.{name}
  fromAddress: string;
  toAddress: string;
  amount: string;
  tokenID: string;
  isNFT: boolean;
}

function buildTokenTransfers(legs: TokenLeg[]): RawTransfer[] {
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
    // Leftovers: burns (withdraw only) or cross-VM
    for (let i = pairs; i < outs.length; i++) {
      const w = outs[i];
      out.push({
        eventIndex: w.eventIndex, token: toToken(w),
        fromAddress: w.owner, toAddress: w.to, amount: w.amount, tokenID: w.tokenID, isNFT: w.isNFT,
      });
    }
    // Leftovers: mints (deposit only) or cross-VM
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

// ── EVM extraction ──

function extractEVMHash(payload: Record<string, any>): string {
  for (const key of ['hash', 'transactionHash', 'txHash', 'evmHash']) {
    if (key in payload) {
      const h = normalizeHexValue(payload[key]);
      if (h) return h;
    }
  }
  return '';
}

function normalizeHexValue(value: any): string {
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase().replace(/^0x/, '');
    return /^[0-9a-f]+$/.test(s) ? s : '';
  }
  if (Array.isArray(value)) {
    // byte array
    const hex = value.map((b: any) => {
      const n = Number(b);
      return isNaN(n) ? '' : n.toString(16).padStart(2, '0');
    }).join('');
    return hex || '';
  }
  return '';
}

function extractHexField(payload: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in payload) {
      const h = normalizeHexValue(payload[key]);
      if (h) return h;
    }
  }
  return '';
}

function extractStringField(payload: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in payload && payload[key] != null) {
      return String(payload[key]);
    }
  }
  return '';
}

function extractNumField(payload: Record<string, any>, ...keys: string[]): string {
  for (const key of keys) {
    if (key in payload && payload[key] != null) {
      return String(payload[key]);
    }
  }
  return '0';
}

function parseEVMExecution(event: any): EVMExecution | null {
  const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
  const fields = parseCadenceEventFields(payload) || payload;
  if (!fields) return null;

  const hash = extractEVMHash(fields);
  if (!hash) return null;

  return {
    hash: '0x' + hash,
    from: formatAddr(extractHexField(fields, 'from', 'fromAddress', 'sender')),
    to: formatAddr(extractHexField(fields, 'to', 'toAddress', 'recipient')),
    gas_used: extractNumField(fields, 'gasConsumed', 'gasUsed', 'gas_used'),
    gas_limit: extractNumField(fields, 'gasLimit', 'gas', 'gas_limit'),
    gas_price: extractStringField(fields, 'gasPrice', 'gas_price') || '0',
    value: extractStringField(fields, 'value') || '0',
    status: 'SEALED',
    event_index: event.event_index ?? 0,
    block_number: event.block_height,
    type: Number(extractStringField(fields, 'transactionType', 'txType') || '0'),
    position: Number(extractStringField(fields, 'index', 'position') || '0'),
  };
}

// ── Fee extraction ──

function extractFee(events: any[]): number {
  for (const event of events) {
    const eventType = event.type || '';
    if (!eventType.includes('FlowFees.FeesDeducted')) continue;
    const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    const fields = parseCadenceEventFields(payload);
    if (!fields) continue;
    const amount = fields.amount;
    if (amount != null) {
      const n = parseFloat(String(amount));
      if (!isNaN(n)) return n;
    }
  }
  return 0;
}

// ── Contract imports from script ──

function extractContractImports(script: string | undefined | null): string[] {
  if (!script) return [];
  const imports: string[] = [];
  // Match: import ContractName from 0xAddress
  const re = /import\s+(\w+)\s+from\s+(0x[0-9a-fA-F]+)/g;
  let match;
  while ((match = re.exec(script)) !== null) {
    imports.push(`A.${match[2].replace(/^0x/, '')}.${match[1]}`);
  }
  return imports;
}

// ── Main entry point ──

export function deriveEnrichments(events: any[], script?: string | null): DerivedEnrichments {
  const legs: TokenLeg[] = [];
  const evmExecutions: EVMExecution[] = [];
  // Collect wrapper events (FungibleToken/NonFungibleToken) to enrich mint/burn legs
  // that lack addresses. Wrapper deposit events carry the recipient in the `to` field
  // and identify the specific token via the `type` payload field (e.g. "A.xxx.JOSHIN.Vault").
  const wrapperDeposits: { addr: string; amount: string; tokenContract: string }[] = [];
  const wrapperWithdrawals: { addr: string; amount: string; tokenContract: string }[] = [];

  // EVM bridge events (EVM.FLOWTokensWithdrawn/Deposited) for cross-VM FLOW transfer enrichment
  const evmWithdrawals: { coaAddress: string; amount: string }[] = [];
  const evmDeposits: { coaAddress: string; amount: string }[] = [];

  // Track whether staking/system events are present — when they are,
  // unpaired FlowToken deposits/withdrawals are staking operations, not mints/burns.
  let hasStakingEvents = false;

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
          // Parse wrapper event to extract the specific token contract from payload `type` field
          const payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
          const vaultType = payload?.type || '';  // e.g. "A.82ed1b9cba5bb1b3.JOSHIN.Vault"
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

    // EVM events
    if (eventType.includes('EVM.TransactionExecuted')) {
      try {
        const exec = parseEVMExecution(event);
        if (exec) evmExecutions.push(exec);
      } catch { /* skip */ }
    }

    // Detect staking/system events that cause unpaired FlowToken movements
    if (!hasStakingEvents && (
      eventType.includes('FlowIDTableStaking.') ||
      eventType.includes('FlowStakingCollection.') ||
      eventType.includes('LockedTokens.') ||
      eventType.includes('FlowEpoch.') ||
      eventType.includes('LiquidStaking') ||
      eventType.includes('stFlowToken')
    )) {
      hasStakingEvents = true;
    }
  }

  // Enrich mint/burn legs with addresses from wrapper events
  for (const leg of legs) {
    const legKey = `${leg.contractAddr}:${leg.contractName}`;
    if (leg.direction === 'deposit' && !leg.owner) {
      // Mint with no recipient — find matching wrapper deposit
      const wrapper = wrapperDeposits.find(w => w.tokenContract === legKey && w.amount === leg.amount);
      if (wrapper) {
        leg.to = wrapper.addr;
        leg.owner = wrapper.addr;
      }
    } else if (leg.direction === 'withdraw' && !leg.owner) {
      // Burn with no source — find matching wrapper withdrawal
      const wrapper = wrapperWithdrawals.find(w => w.tokenContract === legKey && w.amount === leg.amount);
      if (wrapper) {
        leg.from = wrapper.addr;
        leg.owner = wrapper.addr;
      }
    }
  }

  // Enrich unpaired FlowToken legs with COA addresses from EVM bridge events
  // EVM.FLOWTokensWithdrawn (FLOW left EVM) → fill "from" on matching FlowToken deposit
  // EVM.FLOWTokensDeposited (FLOW entered EVM) → fill "to" on matching FlowToken withdrawal
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

  // Split into FT and NFT, filter fee vault transfers
  const ftTransfers: FTTransfer[] = [];
  const nftTransfers: NFTTransfer[] = [];

  for (const t of allTransfers) {
    const fromNorm = normalizeFlowAddress(t.fromAddress);
    const toNorm = normalizeFlowAddress(t.toAddress);
    if (fromNorm === FEE_VAULT_ADDRESS || toNorm === FEE_VAULT_ADDRESS) continue;

    // Unpaired FlowToken legs in staking txs are staking operations, not mints/burns.
    const isFlowToken = t.token.includes('FlowToken');
    const transferType: TransferType =
      (!t.fromAddress && !(isFlowToken && hasStakingEvents)) ? 'mint' :
      (!t.toAddress && !(isFlowToken && hasStakingEvents)) ? 'burn' :
      'transfer';

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
  // from EVM.TransactionExecuted events. The Cadence-level transfer only sees the
  // COA bridge address, but the EVM execution reveals the true recipient/sender.
  if (evmExecutions.length > 0 && ftTransfers.length > 0) {
    for (const ft of ftTransfers) {
      if (!ft.token.includes('FlowToken')) continue;
      const toNorm = normalizeFlowAddress(ft.to_address);
      const fromNorm = normalizeFlowAddress(ft.from_address);
      // COA addresses: 40 hex chars with 10+ leading zeros
      const isToCOA = toNorm.length > 16 && /^0{10,}/.test(toNorm);
      const isFromCOA = fromNorm.length > 16 && /^0{10,}/.test(fromNorm);
      if (isToCOA) {
        // FLOW going Cadence → EVM: find EVM execution from the COA with value > 0
        const exec = evmExecutions.find(e => {
          const execFrom = normalizeFlowAddress(e.from);
          return execFrom === toNorm && e.to && parseFloat(e.value) > 0;
        });
        if (exec) {
          ft.evm_to_address = exec.to;
        }
      }
      if (isFromCOA) {
        // FLOW going EVM → Cadence: find EVM execution to the COA with value > 0
        const exec = evmExecutions.find(e => {
          const execTo = normalizeFlowAddress(e.to);
          return execTo === fromNorm && e.from && parseFloat(e.value) > 0;
        });
        if (exec) {
          ft.evm_from_address = exec.from;
        }
      }
    }
  }

  return {
    ft_transfers: ftTransfers,
    nft_transfers: nftTransfers,
    evm_executions: evmExecutions,
    fee: extractFee(events),
    contract_imports: extractContractImports(script),
  };
}
