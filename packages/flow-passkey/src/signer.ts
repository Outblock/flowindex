/**
 * Flow transaction signing with passkeys — FLIP-264 compatible.
 */
import type { PasskeySignResult } from './types';
import { bytesToHex, hexToBytes, base64UrlToBytes } from './utils';
import { sha256, derToP256Raw, buildExtensionData, encodeMessageFromSignable } from './encode';

/**
 * Options for signing a Flow transaction with a passkey.
 */
export interface SignTransactionOptions {
  /** Hex-encoded message to sign (from encodeMessageFromSignable). */
  messageHex: string;
  /** Base64url-encoded credential ID of the passkey to use. */
  credentialId: string;
  /** Relying party ID (domain) for the WebAuthn assertion. */
  rpId: string;
}

/**
 * Sign a Flow transaction using a passkey.
 *
 * 1. SHA-256 hashes the message bytes (FLIP-264: hash with account key's hashAlgo)
 * 2. Gets a WebAuthn assertion with the hash as challenge
 * 3. Converts the DER signature to raw P256 (r || s)
 * 4. Builds FLIP-264 extension data from authenticator/client data
 */
export async function signFlowTransaction(options: SignTransactionOptions): Promise<PasskeySignResult> {
  const { messageHex, credentialId, rpId } = options;

  // SHA-256 hash the message
  const challenge = await sha256(hexToBytes(messageHex));

  // Get the correct ArrayBuffer for the challenge
  const challengeBuffer = challenge.buffer instanceof ArrayBuffer
    ? challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength)
    : new Uint8Array(challenge).buffer;

  // WebAuthn assertion
  const credIdBytes = base64UrlToBytes(credentialId);
  const credIdBuffer = credIdBytes.buffer.slice(credIdBytes.byteOffset, credIdBytes.byteOffset + credIdBytes.byteLength) as ArrayBuffer;

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: challengeBuffer as ArrayBuffer,
      allowCredentials: [{
        id: credIdBuffer,
        type: 'public-key' as const,
      }],
      rpId,
      userVerification: 'preferred',
    },
  }) as PublicKeyCredential | null;

  if (!assertion) throw new Error('Passkey signing cancelled');

  const response = assertion.response as AuthenticatorAssertionResponse;

  // Convert DER signature to raw r||s (64 bytes)
  const derSig = new Uint8Array(response.signature);
  const rawSig = derToP256Raw(derSig);
  const signature = bytesToHex(rawSig);

  // Build FLIP-264 extension data
  const authenticatorData = new Uint8Array(response.authenticatorData);
  const clientDataJSON = new Uint8Array(response.clientDataJSON);
  const extensionData = buildExtensionData(authenticatorData, clientDataJSON);

  return { signature, extensionData };
}

/**
 * Create an FCL-compatible authorization function using a passkey.
 *
 * Returns a function suitable for use as `fcl.authz` or in `fcl.authorization`:
 * ```ts
 * const authz = createPasskeyAuthz({ address: '0x1234', keyIndex: 0, credentialId, rpId });
 * await fcl.mutate({ cadence: '...', authz });
 * ```
 */
export function createPasskeyAuthz(options: {
  address: string;
  keyIndex: number;
  credentialId: string;
  rpId: string;
}): (account: any) => any {
  const { address, keyIndex, credentialId, rpId } = options;
  const addr = address.replace(/^0x/, '');

  return (account: any) => ({
    ...account,
    addr,
    keyId: keyIndex,
    signingFunction: async (signable: any) => {
      const messageHex = encodeMessageFromSignable(signable, addr);
      const { signature, extensionData } = await signFlowTransaction({ messageHex, credentialId, rpId });
      return { addr, keyId: keyIndex, signature, extensionData };
    },
  });
}
