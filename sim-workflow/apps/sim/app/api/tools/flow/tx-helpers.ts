/**
 * Shared helpers for Flow transaction API routes.
 * Reuses the same FCL + signing pattern from send-transaction/route.ts.
 */

import { SHA3 } from 'sha3'
import { ec as EC } from 'elliptic'

export const ACCESS_NODES: Record<string, string> = {
  mainnet: 'https://rest-mainnet.onflow.org',
  testnet: 'https://rest-testnet.onflow.org',
}

export function signWithKey(privateKey: string, message: string): string {
  const ec = new EC('p256')
  const key = ec.keyFromPrivate(Buffer.from(privateKey, 'hex'))
  const sha3 = new SHA3(256)
  sha3.update(Buffer.from(message, 'hex'))
  const digest = sha3.digest()
  const sig = key.sign(digest)
  const r = sig.r.toArrayLike(Buffer, 'be', 32)
  const s = sig.s.toArrayLike(Buffer, 'be', 32)
  return Buffer.concat([r, s]).toString('hex')
}

/**
 * Creates an FCL-compatible authorization function for signing transactions.
 */
export function createAuthz(
  fcl: typeof import('@onflow/fcl'),
  address: string,
  privateKey: string,
  keyIndex: number = 0
) {
  const authzFn = async (account: Record<string, unknown>) => ({
    ...account,
    tempId: `${address}-${keyIndex}`,
    addr: fcl.sansPrefix(address),
    keyId: keyIndex,
    signingFunction: async (signable: { message: string }) => ({
      addr: fcl.sansPrefix(address),
      keyId: keyIndex,
      signature: signWithKey(privateKey, signable.message),
    }),
  })
  return authzFn
}

/** FCL authorization type helper */
export type FclAuthz = Parameters<typeof import('@onflow/fcl').mutate>[0] extends {
  proposer?: infer P
}
  ? P
  : never

/**
 * Send a transaction via FCL with a single signer.
 * Returns { txId, txStatus }.
 */
export async function sendTransaction(opts: {
  cadence: string
  args: unknown[]
  signerAddress: string
  signerPrivateKey: string
  network: string
}): Promise<{ txId: string; txStatus: { status: number; errorMessage: string } }> {
  const fcl = await import('@onflow/fcl')

  const accessNode = ACCESS_NODES[opts.network]
  if (!accessNode) {
    throw new Error(`Invalid network: ${opts.network}. Use "mainnet" or "testnet".`)
  }

  fcl.config().put('accessNode.api', accessNode)

  const authz = createAuthz(fcl, opts.signerAddress, opts.signerPrivateKey)
  const typedAuthz = authz as unknown as FclAuthz

  const txId: string = await fcl.mutate({
    cadence: opts.cadence,
    args: () => opts.args,
    proposer: typedAuthz,
    payer: typedAuthz,
    authorizations: [typedAuthz] as unknown as FclAuthz[],
    limit: 9999,
  })

  const txStatus = await fcl.tx(txId).onceSealed()

  return { txId, txStatus }
}

/**
 * Send a transaction via FCL with multiple signers.
 * The first signer is the proposer and payer.
 */
export async function sendMultiSignTransaction(opts: {
  cadence: string
  args: unknown[]
  signers: Array<{ address: string; privateKey: string; keyIndex: number }>
  network: string
}): Promise<{ txId: string; txStatus: { status: number; errorMessage: string } }> {
  const fcl = await import('@onflow/fcl')

  const accessNode = ACCESS_NODES[opts.network]
  if (!accessNode) {
    throw new Error(`Invalid network: ${opts.network}. Use "mainnet" or "testnet".`)
  }

  fcl.config().put('accessNode.api', accessNode)

  const authzFunctions = opts.signers.map((s) =>
    createAuthz(fcl, s.address, s.privateKey, s.keyIndex)
  )

  const proposer = authzFunctions[0] as unknown as FclAuthz
  const payer = authzFunctions[0] as unknown as FclAuthz
  const authorizations = authzFunctions as unknown as FclAuthz[]

  const txId: string = await fcl.mutate({
    cadence: opts.cadence,
    args: () => opts.args,
    proposer,
    payer,
    authorizations,
    limit: 9999,
  })

  const txStatus = await fcl.tx(txId).onceSealed()

  return { txId, txStatus }
}

/**
 * Format a standard transaction result into API response.
 */
export function formatTxResult(txId: string, txStatus: { errorMessage: string; status: number }) {
  const statusLabel = txStatus.errorMessage ? 'ERROR' : 'SEALED'
  const content = txStatus.errorMessage
    ? `Transaction ${txId} failed: ${txStatus.errorMessage}`
    : `Transaction ${txId} sealed successfully (status: ${txStatus.status})`

  return { content, transactionId: txId, status: statusLabel }
}
