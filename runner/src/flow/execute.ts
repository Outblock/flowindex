import { fcl } from './fclConfig';
import { parseMainParams, buildFclArgs } from './cadenceParams';

export interface ExecutionResult {
  type: 'script_result' | 'tx_submitted' | 'tx_sealed' | 'error';
  data: any;
  events?: any[];
  txId?: string;
}

export function detectCodeType(code: string): 'script' | 'transaction' {
  return code.includes('transaction') && code.includes('prepare')
    ? 'transaction'
    : 'script';
}

function extractError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Strip FCL wrapper text to get the root cause
  const causedBy = msg.indexOf('error caused by:');
  if (causedBy !== -1) return msg.slice(causedBy + 'error caused by:'.length).trim();
  return msg;
}

export async function executeScript(
  code: string,
  paramValues: Record<string, string>,
): Promise<ExecutionResult> {
  try {
    const params = parseMainParams(code);
    const args = params.length > 0 ? buildFclArgs(params, paramValues) : undefined;
    const result = await fcl.query({
      cadence: code,
      args,
      limit: 9999,
    });
    return { type: 'script_result', data: result };
  } catch (err) {
    return { type: 'error', data: extractError(err) };
  }
}

export async function executeTransaction(
  code: string,
  paramValues: Record<string, string>,
  onResult: (result: ExecutionResult) => void,
): Promise<void> {
  try {
    // Ensure wallet is connected
    const user = await fcl.currentUser.snapshot();
    if (!user?.addr) {
      await fcl.authenticate();
    }

    const params = parseMainParams(code);
    const args = params.length > 0 ? buildFclArgs(params, paramValues) : undefined;

    const txId = await fcl.mutate({
      cadence: code,
      args,
      proposer: fcl.currentUser,
      payer: fcl.currentUser,
      authorizations: [fcl.currentUser],
      limit: 9999,
    });

    onResult({ type: 'tx_submitted', data: txId, txId });

    const result = await fcl.tx(txId).onceSealed();
    onResult({
      type: 'tx_sealed',
      data: result,
      events: result.events || [],
      txId,
    });
  } catch (err) {
    onResult({ type: 'error', data: extractError(err) });
  }
}
