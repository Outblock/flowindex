export interface SimulateRequest {
  cadence: string;
  arguments: Array<Record<string, unknown>>;
  authorizers: string[];
  payer: string;
  verbose?: boolean;
}

export interface BalanceChange {
  address: string;
  token: string;
  before?: string;
  after?: string;
  delta: string;
}

export interface SimulateResponse {
  success: boolean;
  error?: string;
  events: Array<{ type: string; payload: any }>;
  balanceChanges: BalanceChange[];
  computationUsed: number;
}

export async function simulateTransaction(req: SimulateRequest): Promise<SimulateResponse> {
  const resp = await fetch('/api/flow/v1/simulate', {
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
      balanceChanges: [],
      computationUsed: 0,
    };
  }

  // Backend returns snake_case keys and omits empty arrays; normalize here
  const raw = await resp.json();
  return {
    success: raw.success,
    error: raw.error,
    events: raw.events ?? [],
    balanceChanges: raw.balance_changes ?? raw.balanceChanges ?? [],
    computationUsed: raw.computation_used ?? raw.computationUsed ?? 0,
  };
}
