import { createHmac, timingSafeEqual } from 'crypto'
import { createLogger } from '@sim/logger'

const logger = createLogger('FlowIndexHmac')

/**
 * Verify HMAC-SHA256 signature from FlowIndex webhook delivery.
 * Header format: X-FlowIndex-Signature: sha256=<hex>
 */
export function verifyFlowIndexSignature(
  rawBody: string,
  signatureHeader: string | null,
  signingSecret: string
): boolean {
  if (!signatureHeader || !signingSecret) {
    logger.warn('Missing signature header or signing secret')
    return false
  }

  const prefix = 'sha256='
  if (!signatureHeader.startsWith(prefix)) {
    logger.warn('Invalid signature format (missing sha256= prefix)')
    return false
  }

  const receivedSig = signatureHeader.slice(prefix.length)
  const expectedSig = createHmac('sha256', signingSecret).update(rawBody).digest('hex')

  try {
    return timingSafeEqual(Buffer.from(receivedSig, 'hex'), Buffer.from(expectedSig, 'hex'))
  } catch {
    return false
  }
}
