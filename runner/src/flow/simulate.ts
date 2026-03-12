export interface SimulateRequest {
  cadence: string;
  arguments: Array<Record<string, unknown>>;
  authorizers: string[];
  payer: string;
  verbose?: boolean;
  scheduled?: {
    advance_seconds?: number;
    advance_blocks?: number;
  };
}

export interface BalanceChange {
  address: string;
  token: string;
  before?: string;
  after?: string;
  delta: string;
}

export interface RawEvent {
  type: string;
  payload: any;
}

export interface SummaryItem {
  icon: string;
  text: string;
}

export interface FTTransfer {
  token: string;
  amount: string;
  transfer_type: 'transfer' | 'mint' | 'burn';
  from_address?: string;
  to_address?: string;
}

export interface NFTTransfer {
  token: string;
  token_id: string;
  transfer_type: 'transfer' | 'mint' | 'burn';
  from_address?: string;
  to_address?: string;
}

export interface SystemEvent {
  category: string;
  detail: string;
}

export interface SimulateResponse {
  success: boolean;
  error?: string;
  events: RawEvent[];
  scheduledResults?: Array<{
    tx_id: string;
    success: boolean;
    error?: string;
    events?: RawEvent[];
    computation_used: number;
  }>;
  balanceChanges: BalanceChange[];
  computationUsed: number;
  summary: string;
  summaryItems: SummaryItem[];
  transfers: FTTransfer[];
  nftTransfers: NFTTransfer[];
  systemEvents: SystemEvent[];
  fee: number;
  tags: string[];
}

function getSimulateEndpoint() {
  const raw = import.meta.env.VITE_SIMULATE_URL?.trim();
  if (!raw) {
    return '/api/simulate';
  }

  const normalized = raw.replace(/\/+$/, '');

  if (normalized.endsWith('/api/simulate')) {
    return normalized;
  }
  if (normalized.endsWith('/api')) {
    return `${normalized}/simulate`;
  }
  return `${normalized}/api/simulate`;
}

export async function simulateTransaction(req: SimulateRequest): Promise<SimulateResponse> {
  const resp = await fetch(getSimulateEndpoint(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!resp.ok) {
    const text = await resp.text();
    return {
      success: false,
      error: `Simulation service error: ${resp.status} ${text}`,
      events: [],
      scheduledResults: [],
      balanceChanges: [],
      computationUsed: 0,
      summary: '',
      summaryItems: [],
      transfers: [],
      nftTransfers: [],
      systemEvents: [],
      fee: 0,
      tags: [],
    };
  }

  // The simulate frontend already decodes events server-side,
  // so we just normalize the response shape (snake_case fallbacks).
  const raw = await resp.json();
  return {
    success: raw.success,
    error: raw.error,
    events: raw.events ?? [],
    scheduledResults: raw.scheduled_results ?? raw.scheduledResults ?? [],
    balanceChanges: raw.balance_changes ?? raw.balanceChanges ?? [],
    computationUsed: raw.computation_used ?? raw.computationUsed ?? 0,
    summary: raw.summary ?? '',
    summaryItems: raw.summaryItems ?? [],
    transfers: raw.transfers ?? [],
    nftTransfers: raw.nftTransfers ?? [],
    systemEvents: raw.systemEvents ?? [],
    fee: raw.fee ?? 0,
    tags: raw.tags ?? [],
  };
}
