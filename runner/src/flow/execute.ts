import { fcl } from './fclConfig';
import { parseMainParams, buildFclArgs } from './cadenceParams';

export interface ExecutionResult {
  type: 'script_result' | 'tx_submitted' | 'tx_sealed' | 'error';
  data: any;
  events?: any[];
  txId?: string;
}

export function detectCodeType(code: string): 'script' | 'transaction' | 'contract' {
  // Contract: starts with access(all) contract or pub contract (after optional imports)
  const stripped = code.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '').trim();
  const lines = stripped.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const firstNonImport = lines.find(l => !l.startsWith('import '));
  if (firstNonImport && /^(access\s*\(all\)|pub)\s+contract\b/.test(firstNonImport)) {
    return 'contract';
  }
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

export async function executeCustodialTransaction(
  code: string,
  paramValues: Record<string, string>,
  signerAddress: string,
  keyIndex: number,
  signFn: (message: string) => Promise<string>,
  onResult: (result: ExecutionResult) => void,
  sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1',
  hashAlgo?: 'SHA2_256' | 'SHA3_256',
): Promise<void> {
  try {
    const params = parseMainParams(code);
    const args = params.length > 0 ? buildFclArgs(params, paramValues) : undefined;

    // Map algo names to FCL numeric constants
    const hashAlgorithm = hashAlgo === 'SHA2_256' ? 1 : 3; // SHA2_256=1, SHA3_256=3
    const signatureAlgorithm = sigAlgo === 'ECDSA_secp256k1' ? 3 : 2; // ECDSA_P256=2, ECDSA_secp256k1=3

    // Custom FCL authorization function using custodial key
    const authz = (account: any) => ({
      ...account,
      tempId: `${signerAddress}-${keyIndex}`,
      addr: fcl.sansPrefix(signerAddress),
      keyId: keyIndex,
      signingFunction: async (signable: { message: string }) => ({
        addr: fcl.withPrefix(signerAddress),
        keyId: keyIndex,
        signature: await signFn(signable.message),
      }),
      hashAlgorithm,
      signatureAlgorithm,
    });

    const txId = await fcl.mutate({
      cadence: code,
      args,
      proposer: authz,
      payer: authz,
      authorizations: [authz],
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

/**
 * Extract contract name from Cadence contract source code.
 */
function extractContractName(code: string): string {
  const match = code.match(/(?:access\s*\(all\)|pub)\s+contract\s+(?:interface\s+)?(\w+)/);
  return match?.[1] ?? 'UnknownContract';
}

/**
 * Deploy a Cadence contract to a Flow account.
 * Generates a deploy transaction that calls Account.contracts.add().
 */
export async function deployContract(
  code: string,
  signerAddress: string,
  keyIndex: number,
  signFn: (message: string) => Promise<string>,
  onResult: (result: ExecutionResult) => void,
  sigAlgo?: 'ECDSA_P256' | 'ECDSA_secp256k1',
  hashAlgo?: 'SHA2_256' | 'SHA3_256',
): Promise<void> {
  try {
    const contractName = extractContractName(code);
    const codeHex = Array.from(new TextEncoder().encode(code))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const deployTx = `
transaction(name: String, code: String) {
  prepare(signer: auth(AddContract) &Account) {
    signer.contracts.add(name: name, code: code.decodeHex())
  }
}`;

    const hashAlgorithm = hashAlgo === 'SHA2_256' ? 1 : 3;
    const signatureAlgorithm = sigAlgo === 'ECDSA_secp256k1' ? 3 : 2;

    const authz = (account: any) => ({
      ...account,
      tempId: `${signerAddress}-${keyIndex}`,
      addr: fcl.sansPrefix(signerAddress),
      keyId: keyIndex,
      signingFunction: async (signable: { message: string }) => ({
        addr: fcl.withPrefix(signerAddress),
        keyId: keyIndex,
        signature: await signFn(signable.message),
      }),
      hashAlgorithm,
      signatureAlgorithm,
    });

    const txId = await fcl.mutate({
      cadence: deployTx,
      args: (arg: any, t: any) => [
        arg(contractName, t.String),
        arg(codeHex, t.String),
      ],
      proposer: authz,
      payer: authz,
      authorizations: [authz],
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
