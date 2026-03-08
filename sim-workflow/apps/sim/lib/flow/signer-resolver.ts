import { CloudSigner, LocalSigner, PasskeySigner, createAuthzFromSigner } from '@flowindex/flow-signer'
import type { FlowSigner, SignerConfig } from '@flowindex/flow-signer'
import { createLogger } from '@sim/logger'

const logger = createLogger('SignerResolver')

/** Parameters extracted from block execution / API request bodies. */
export interface SignerParams {
  signerMode?: 'cloud' | 'passkey' | 'manual' | 'legacy'
  signerKeyId?: string
  signerCredentialId?: string
  signerAddress?: string
  signerPrivateKey?: string
}

const FLOWINDEX_URL = process.env.FLOWINDEX_API_URL || 'https://flowindex.io'

/**
 * Resolve a FlowSigner (and its FCL authz function) from block execution params.
 *
 * Supports four modes:
 *  - legacy / manual: raw private key + address (backward compatible)
 *  - cloud: FlowIndex custodial wallet (requires fi auth token)
 *  - passkey: browser-based passkey approval (requires fi auth token)
 */
export async function resolveSignerFromParams(
  params: SignerParams,
  fiAuthToken?: string
): Promise<{ signer: FlowSigner; authz: ReturnType<typeof createAuthzFromSigner> }> {
  const config: SignerConfig = { flowindexUrl: FLOWINDEX_URL }

  // Legacy mode: raw private key (backward compatible)
  if (params.signerMode === 'legacy' || params.signerMode === 'manual' || (!params.signerMode && params.signerPrivateKey)) {
    if (!params.signerPrivateKey || !params.signerAddress) {
      throw new Error('signerAddress and signerPrivateKey required for legacy/manual mode')
    }
    logger.info(`Resolving local signer for address ${params.signerAddress}`)
    const signer = new LocalSigner(config, {
      privateKey: params.signerPrivateKey,
      address: params.signerAddress,
    })
    await signer.init()
    return { signer, authz: createAuthzFromSigner(signer) }
  }

  if (!fiAuthToken) {
    throw new Error('Authentication required for cloud/passkey signing')
  }

  if (params.signerMode === 'cloud') {
    logger.info('Resolving cloud signer')
    const signer = new CloudSigner(config, fiAuthToken)
    await signer.init()
    return { signer, authz: createAuthzFromSigner(signer) }
  }

  if (params.signerMode === 'passkey') {
    if (!params.signerCredentialId) {
      throw new Error('signerCredentialId required for passkey mode')
    }
    logger.info('Resolving passkey signer')
    const signer = new PasskeySigner(config, { token: fiAuthToken })
    await signer.init()
    return { signer, authz: createAuthzFromSigner(signer) }
  }

  throw new Error(`Unknown signerMode: ${params.signerMode}`)
}

/** Extract the FlowIndex auth token from a request's cookies. */
export function extractFiAuthFromRequest(request: Request): string | null {
  const cookieHeader = request.headers.get('cookie')
  if (!cookieHeader) return null
  const match = cookieHeader.match(/fi_auth=([^;]+)/)
  if (!match) return null
  try {
    return decodeURIComponent(match[1]).replace(/^"(.*)"$/, '$1')
  } catch {
    return match[1]
  }
}
