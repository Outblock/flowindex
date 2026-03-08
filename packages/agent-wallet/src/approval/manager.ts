/**
 * Minimal pending-transaction queue for the approval flow.
 *
 * Transactions that require human approval are parked here until
 * an approve/reject tool call resolves them.
 */

export interface PendingTx {
  template_name: string;
  cadence: string;
  args: Record<string, unknown>;
  summary: string;
  createdAt: number;
}

const pendingTxs = new Map<string, PendingTx>();

export function addPendingTx(txId: string, tx: PendingTx): void {
  pendingTxs.set(txId, { ...tx, createdAt: Date.now() });
}

export function getPendingTx(txId: string): PendingTx | undefined {
  return pendingTxs.get(txId);
}

export function removePendingTx(txId: string): boolean {
  return pendingTxs.delete(txId);
}

export function listPendingTxs(): Array<{ tx_id: string; summary: string; created_at: number }> {
  return Array.from(pendingTxs.entries()).map(([id, tx]) => ({
    tx_id: id,
    summary: tx.summary,
    created_at: tx.createdAt,
  }));
}
