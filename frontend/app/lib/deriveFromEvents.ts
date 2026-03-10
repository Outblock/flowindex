/**
 * Thin adapter over @flowindex/event-decoder — maps the shared package's
 * camelCase output to the snake_case field names the frontend already uses.
 */

import { decodeEvents } from '@flowindex/event-decoder';
import type {
  FTTransfer as PackageFTTransfer,
  NFTTransfer,
  EVMExecution,
  DecodedEvents,
  TransferType,
} from '@flowindex/event-decoder';

// Re-export decodeEVMCallData (used by $txId.tsx and TransferFlowDiagram.tsx)
export { decodeEVMCallData } from '@flowindex/event-decoder';
export type { DecodedEVMCall } from '@flowindex/event-decoder';

// Re-export types consumers need directly
export type { NFTTransfer, EVMExecution, TransferType };

// FTTransfer with display fields that the frontend mutates onto the objects
export interface FTTransfer extends PackageFTTransfer {
  /** Display fields enriched from transfer_summary metadata */
  token_logo?: string;
  token_symbol?: string;
  token_name?: string;
  usd_value?: number;
}

// Legacy shape used by the frontend (snake_case field names)
export interface DerivedEnrichments {
  ft_transfers: FTTransfer[];
  nft_transfers: NFTTransfer[];
  evm_executions: EVMExecution[];
  fee: number;
  contract_imports: string[];
}

/**
 * Decode raw events + optional script into the enrichment shape the frontend expects.
 * Delegates to the shared @flowindex/event-decoder package then maps field names.
 */
export function deriveEnrichments(events: any[], script?: string | null): DerivedEnrichments {
  const decoded: DecodedEvents = decodeEvents(events, script);

  return {
    ft_transfers: decoded.transfers as FTTransfer[],
    nft_transfers: decoded.nftTransfers,
    evm_executions: decoded.evmExecutions,
    fee: decoded.fee,
    contract_imports: decoded.contractImports,
  };
}
