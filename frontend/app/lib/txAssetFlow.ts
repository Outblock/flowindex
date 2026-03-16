import { decodeEVMCallData } from './deriveFromEvents';

const DEFI_ACTIONS_TOKEN = 'A.6d888f175c158410.DeFiActions';
const CROSS_VM_MATCH_WINDOW = 24;

type DetailTransfer = {
  amount?: string;
  approx_usd_price?: number;
  event_index?: number;
  from_address?: string;
  is_cross_vm?: boolean;
  to_address?: string;
  to_coa_flow_address?: string;
  from_coa_flow_address?: string;
  token?: string;
  token_decimals?: number;
  token_logo?: string;
  token_name?: string;
  token_symbol?: string;
  transfer_type?: 'transfer' | 'mint' | 'burn' | 'stake' | 'unstake';
  usd_value?: number;
  evm_to_address?: string;
  evm_from_address?: string;
};

type ParsedExecution = {
  eventIndex: number;
  from: string;
  to: string;
  value: number;
  recipient: string;
  callType: string;
};

export type TxDetailDisplayLayer = 'cadence' | 'evm' | 'cross_vm';

export interface TxDetailDisplayTransferRow {
  amount: number;
  count: number;
  eventIndex?: number;
  from: string;
  layer: TxDetailDisplayLayer;
  logo?: string;
  symbol: string;
  to: string;
  transferType?: 'transfer' | 'mint' | 'burn' | 'stake' | 'unstake';
  usdValue: number;
}

export interface TxDetailAssetView {
  canonicalFtTransfers: DetailTransfer[];
  canonicalTransaction: any;
  rawFtTransfers: DetailTransfer[];
  rawTransaction: any;
  summaryLine: string;
  summaryTransaction: any;
  rawTransferListRows: TxDetailDisplayTransferRow[];
  transferListRows: TxDetailDisplayTransferRow[];
}

function normalizeHexAddress(address?: string | null): string {
  if (!address) return '';
  const hex = String(address).trim().toLowerCase().replace(/^0x/, '');
  if (!hex) return '';
  return `0x${hex}`;
}

function parseAmount(value?: string | number | null): number {
  if (value == null) return 0;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function tokenSymbol(transfer: DetailTransfer): string {
  if (transfer.token_symbol) return transfer.token_symbol;
  const token = transfer.token || '';
  return token.split('.').pop() || 'FT';
}

function tokenUsdValue(transfer: DetailTransfer): number {
  const direct = parseAmount(transfer.usd_value);
  if (direct > 0) return direct;
  const price = parseAmount(transfer.approx_usd_price);
  return price > 0 ? price * parseAmount(transfer.amount) : 0;
}

function isZeroTransfer(transfer: DetailTransfer): boolean {
  return parseAmount(transfer.amount) <= 0;
}

function isBookkeepingTransfer(transfer: DetailTransfer): boolean {
  if (!transfer.token) return true;
  if (transfer.token === DEFI_ACTIONS_TOKEN || transfer.token.includes('.DeFiActions')) return true;
  if (!transfer.from_address && !transfer.to_address) return true;
  return false;
}

function amountKey(transfer: DetailTransfer): string {
  return String(transfer.amount || '0');
}

function sameTokenAmount(a: DetailTransfer, b: DetailTransfer): boolean {
  return a.token === b.token && amountKey(a) === amountKey(b);
}

function isLikelyDuplicateBurn(transfer: DetailTransfer, transfers: DetailTransfer[]): boolean {
  if ((transfer.transfer_type || 'transfer') !== 'burn') return false;
  if (!transfer.from_address || transfer.to_address) return false;
  return transfers.some((candidate) =>
    candidate !== transfer &&
    sameTokenAmount(candidate, transfer) &&
    candidate.from_address === transfer.from_address &&
    !!candidate.to_address
  );
}

function isLikelyDuplicateMint(transfer: DetailTransfer, transfers: DetailTransfer[]): boolean {
  if ((transfer.transfer_type || 'transfer') !== 'mint') return false;
  if (transfer.from_address || !transfer.to_address) return false;
  return transfers.some((candidate) =>
    candidate !== transfer &&
    sameTokenAmount(candidate, transfer) &&
    candidate.to_address === transfer.to_address &&
    !!candidate.from_address
  );
}

function extractEmbeddedEvmContract(token?: string): string {
  const match = token?.match(/EVMVMBridgedToken_([a-f0-9]{40})/i);
  return match ? normalizeHexAddress(match[1]) : '';
}

function isLikelyCoa(address?: string | null): boolean {
  const normalized = normalizeHexAddress(address);
  return normalized.length === 42 && /^0x0{10,}/.test(normalized);
}

function parseExecutions(detail: any): ParsedExecution[] {
  return ((detail?.evm_executions || []) as any[])
    .map((exec) => {
      const decoded = exec?.data ? decodeEVMCallData(exec.data) : { recipient: '', callType: 'unknown' };
      return {
        eventIndex: Number(exec?.event_index || 0),
        from: normalizeHexAddress(exec?.from),
        to: normalizeHexAddress(exec?.to),
        value: parseAmount(exec?.value),
        recipient: normalizeHexAddress(decoded.recipient),
        callType: decoded.callType,
      };
    })
    .sort((a, b) => a.eventIndex - b.eventIndex);
}

function inferFlowBridgeRecipient(
  transfer: DetailTransfer,
  executions: ParsedExecution[],
): string {
  if (!transfer.token?.includes('FlowToken')) return transfer.evm_to_address || '';
  if (!transfer.to_address || !isLikelyCoa(transfer.to_address)) return transfer.evm_to_address || '';

  const coa = normalizeHexAddress(transfer.to_address);
  const current = normalizeHexAddress(transfer.evm_to_address);
  const baseEventIndex = Number(transfer.event_index || 0);
  const candidates = executions.filter((exec) =>
    exec.eventIndex > baseEventIndex &&
    exec.eventIndex - baseEventIndex <= CROSS_VM_MATCH_WINDOW &&
    exec.from === coa,
  );

  const erc20Recipient = candidates.find((exec) =>
    (exec.callType === 'erc20_transfer' || exec.callType === 'erc20_transferFrom') && !!exec.recipient,
  );
  if (erc20Recipient?.recipient) return erc20Recipient.recipient;

  const directValueTransfer = candidates.find((exec) => exec.value > 0 && !!exec.to);
  if (directValueTransfer?.to) return directValueTransfer.to;

  return current;
}

function inferBridgedMintSender(
  transfer: DetailTransfer,
  executions: ParsedExecution[],
): string {
  const embeddedContract = extractEmbeddedEvmContract(transfer.token);
  if (!embeddedContract) return '';
  const baseEventIndex = Number(transfer.event_index || 0);
  const candidates = executions
    .filter((exec) =>
      exec.eventIndex < baseEventIndex &&
      baseEventIndex - exec.eventIndex <= CROSS_VM_MATCH_WINDOW &&
      exec.to === embeddedContract,
    )
    .sort((a, b) => b.eventIndex - a.eventIndex);
  const directTransfer = candidates.find((exec) =>
    (exec.callType === 'erc20_transfer' || exec.callType === 'erc20_transferFrom') && !!exec.from,
  );
  return directTransfer?.from || '';
}

function canonicalizeFtTransfers(detail: any): DetailTransfer[] {
  const executions = parseExecutions(detail);
  const baseTransfers = ((detail?.ft_transfers || []) as DetailTransfer[])
    .map((transfer) => {
      const next: DetailTransfer = { ...transfer };
      next.from_address = normalizeHexAddress(transfer.from_address);
      next.to_address = normalizeHexAddress(transfer.to_address);
      next.evm_to_address = normalizeHexAddress(transfer.evm_to_address);
      next.evm_from_address = normalizeHexAddress(transfer.evm_from_address);
      next.to_coa_flow_address = normalizeHexAddress(transfer.to_coa_flow_address);
      next.from_coa_flow_address = normalizeHexAddress(transfer.from_coa_flow_address);
      next.transfer_type = next.transfer_type || ((!next.from_address && next.to_address)
        ? 'mint'
        : (next.from_address && !next.to_address)
          ? 'burn'
          : 'transfer');

      if (!next.from_address && next.to_address) {
        const bridgedSender = inferBridgedMintSender(next, executions);
        if (bridgedSender) {
          next.from_address = bridgedSender;
          next.evm_from_address = next.evm_from_address || bridgedSender;
          next.transfer_type = 'transfer';
          next.is_cross_vm = true;
        }
      }

      const bridgeRecipient = inferFlowBridgeRecipient(next, executions);
      if (bridgeRecipient) {
        next.evm_to_address = bridgeRecipient;
      }

      return next;
    })
    .filter((transfer) => !isZeroTransfer(transfer))
    .filter((transfer) => !isBookkeepingTransfer(transfer));

  return baseTransfers.filter((transfer) =>
    !isLikelyDuplicateBurn(transfer, baseTransfers) && !isLikelyDuplicateMint(transfer, baseTransfers),
  );
}

function buildTransferListRows(transfers: DetailTransfer[]): TxDetailDisplayTransferRow[] {
  const rows = new Map<string, TxDetailDisplayTransferRow>();

  const pushRow = (row: Omit<TxDetailDisplayTransferRow, 'count'>) => {
    if (!row.from && !row.to) return;
    const key = [
      row.layer,
      row.from,
      row.to,
      row.symbol,
      row.transferType || 'transfer',
    ].join('|');
    const existing = rows.get(key);
    if (existing) {
      existing.amount += row.amount;
      existing.count += 1;
      existing.usdValue += row.usdValue;
      return;
    }
    rows.set(key, { ...row, count: 1 });
  };

  for (const transfer of transfers) {
    const symbol = tokenSymbol(transfer);
    const amount = parseAmount(transfer.amount);
    const usdValue = tokenUsdValue(transfer);
    const logo = transfer.token_logo;

    if (transfer.evm_to_address && transfer.to_address) {
      pushRow({
        amount,
        from: transfer.from_address || '',
        layer: 'cadence',
        logo,
        symbol,
        to: transfer.to_address,
        transferType: transfer.transfer_type,
        usdValue,
      });
      pushRow({
        amount,
        from: transfer.to_address,
        layer: 'evm',
        logo,
        symbol,
        to: transfer.evm_to_address,
        transferType: 'transfer',
        usdValue,
      });
      continue;
    }

    pushRow({
      amount,
      from: transfer.from_address || '',
      layer: transfer.is_cross_vm ? 'cross_vm' : 'cadence',
      logo,
      symbol,
      to: transfer.to_address || '',
      transferType: transfer.transfer_type,
      usdValue,
    });
  }

  return Array.from(rows.values()).sort((a, b) => b.usdValue - a.usdValue || b.amount - a.amount);
}

function rawTransferLayer(transfer: DetailTransfer): TxDetailDisplayLayer {
  if (transfer.is_cross_vm || transfer.evm_to_address || transfer.evm_from_address) {
    return 'cross_vm';
  }
  return 'cadence';
}

function buildRawTransferListRows(transfers: DetailTransfer[]): TxDetailDisplayTransferRow[] {
  return transfers
    .map((transfer) => ({
      amount: parseAmount(transfer.amount),
      count: 1,
      eventIndex: Number(transfer.event_index || 0),
      from: transfer.from_address || '',
      layer: rawTransferLayer(transfer),
      logo: transfer.token_logo,
      symbol: tokenSymbol(transfer),
      to: transfer.to_address || '',
      transferType: transfer.transfer_type,
      usdValue: tokenUsdValue(transfer),
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => {
      const byEvent = (a.eventIndex || 0) - (b.eventIndex || 0);
      if (byEvent !== 0) return byEvent;
      return b.usdValue - a.usdValue || b.amount - a.amount;
    });
}

function isLikelyOperationalNoiseForSummary(
  transfer: DetailTransfer,
  allTransfers: DetailTransfer[],
): boolean {
  const symbol = tokenSymbol(transfer);
  const amount = parseAmount(transfer.amount);
  if (symbol !== 'FLOW') return false;
  if (amount <= 0.001) return true;
  const hasNonFlow = allTransfers.some((candidate) => tokenSymbol(candidate) !== 'FLOW');
  return hasNonFlow && amount < 0.25 && !transfer.is_cross_vm;
}

function formatSummaryAmount(amount: number): string {
  return amount.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function buildSummaryLineFromTransfers(transfers: DetailTransfer[]): string {
  const meaningful = transfers.filter((transfer) => !isLikelyOperationalNoiseForSummary(transfer, transfers));
  const ordered = (meaningful.length > 0 ? meaningful : transfers)
    .slice()
    .sort((a, b) => Number(a.event_index || 0) - Number(b.event_index || 0));

  const steps: string[] = [];
  for (const transfer of ordered) {
    const step = `${formatSummaryAmount(parseAmount(transfer.amount))} ${tokenSymbol(transfer)}`;
    if (steps[steps.length - 1] !== step) steps.push(step);
  }
  if (steps.length >= 2) return steps.slice(0, 4).join(' -> ');

  if (ordered.length > 0) {
    const first = ordered[0];
    const verb = first.transfer_type === 'mint'
      ? 'Minted'
      : first.transfer_type === 'burn'
        ? 'Burned'
        : first.transfer_type === 'stake'
          ? 'Staked'
          : first.transfer_type === 'unstake'
            ? 'Unstaked'
            : 'Transferred';
    return `${verb} ${formatSummaryAmount(parseAmount(first.amount))} ${tokenSymbol(first)}`;
  }

  return '';
}

export function buildTxDetailAssetView(detail: any): TxDetailAssetView {
  const baseDetail = detail || {};
  const rawFtTransfers = (((baseDetail?.raw_ft_transfers || baseDetail?.ft_transfers || []) as DetailTransfer[]))
    .map((transfer) => ({ ...transfer }));
  const canonicalFtTransfers = canonicalizeFtTransfers(detail);
  const canonicalTransaction = {
    ...baseDetail,
    ft_transfers: canonicalFtTransfers,
  };
  const rawTransaction = {
    ...baseDetail,
    ft_transfers: rawFtTransfers,
  };

  return {
    canonicalFtTransfers,
    canonicalTransaction,
    rawFtTransfers,
    rawTransaction,
    summaryLine: buildSummaryLineFromTransfers(canonicalFtTransfers),
    summaryTransaction: canonicalTransaction,
    rawTransferListRows: buildRawTransferListRows(rawFtTransfers),
    transferListRows: buildTransferListRows(canonicalFtTransfers),
  };
}
