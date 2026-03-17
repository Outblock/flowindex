/**
 * Pure WebAuthn credential management — no server calls, no React.
 */
import type { PasskeyCredentialResult, PasskeyAssertionResult } from './types';
import { bytesToHex, base64UrlToBytes } from './utils';

/**
 * Options for creating a new passkey credential.
 */
export interface CreatePasskeyOptions {
  rpId: string;
  rpName: string;
  challenge: Uint8Array;
  userId: Uint8Array;
  userName: string;
  excludeCredentials?: Array<{ id: string; type: 'public-key' }>;
}

/**
 * Options for getting a passkey assertion.
 */
export interface GetAssertionOptions {
  rpId: string;
  challenge: Uint8Array;
  allowCredentials?: Array<{ id: string; type: 'public-key' }>;
  mediation?: CredentialMediationRequirement;
  signal?: AbortSignal;
}

/**
 * Create a new passkey credential via WebAuthn.
 *
 * Wraps `navigator.credentials.create()` and extracts the public key
 * in SEC1 uncompressed format (04 || x || y) if available.
 */
export async function createPasskeyCredential(options: CreatePasskeyOptions): Promise<PasskeyCredentialResult> {
  const { rpId, rpName, challenge, userId, userName, excludeCredentials } = options;

  const publicKeyOptions: PublicKeyCredentialCreationOptions = {
    challenge: challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength) as ArrayBuffer,
    rp: { id: rpId, name: rpName },
    user: {
      id: userId.buffer.slice(userId.byteOffset, userId.byteOffset + userId.byteLength) as ArrayBuffer,
      name: userName,
      displayName: userName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256 (P-256) — required for Flow
      { alg: -257, type: 'public-key' },  // RS256 — Chrome compatibility fallback
    ],
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    attestation: 'none',
    excludeCredentials: excludeCredentials?.map(c => {
      const bytes = base64UrlToBytes(c.id);
      return {
        id: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        type: c.type,
      };
    }),
  };

  const credential = await navigator.credentials.create({ publicKey: publicKeyOptions }) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey creation cancelled');

  const attestation = credential.response as AuthenticatorAttestationResponse;

  // Extract public key in SEC1 format if the API is available
  let publicKeySec1Hex = '';
  if (typeof attestation.getPublicKey === 'function') {
    const spkiDer = attestation.getPublicKey();
    if (spkiDer) {
      // SPKI DER for P-256: the last 65 bytes are the uncompressed point (04 || x || y)
      const spkiBytes = new Uint8Array(spkiDer);
      // P-256 uncompressed point is 65 bytes (1 byte prefix + 32 bytes x + 32 bytes y)
      if (spkiBytes.length >= 65) {
        const sec1 = spkiBytes.slice(spkiBytes.length - 65);
        if (sec1[0] === 0x04) {
          publicKeySec1Hex = bytesToHex(sec1);
        }
      }
    }
  }

  return {
    credentialId: credential.id,
    attestationResponse: attestation,
    rawId: new Uint8Array(credential.rawId),
    type: credential.type,
    publicKeySec1Hex,
  };
}

/**
 * Get a passkey assertion via WebAuthn.
 *
 * Wraps `navigator.credentials.get()` and returns raw Uint8Array fields
 * for further processing (DER signature conversion, FLIP-264 encoding, etc.).
 */
export async function getPasskeyAssertion(options: GetAssertionOptions): Promise<PasskeyAssertionResult> {
  const { rpId, challenge, allowCredentials, mediation, signal } = options;

  const challengeBuf = challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength) as ArrayBuffer;
  const publicKeyOptions: PublicKeyCredentialRequestOptions = {
    challenge: challengeBuf,
    rpId,
    userVerification: 'preferred',
    allowCredentials: allowCredentials?.map(c => {
      const bytes = base64UrlToBytes(c.id);
      return {
        id: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
        type: c.type,
      };
    }),
  };

  const requestOptions: CredentialRequestOptions = {
    publicKey: publicKeyOptions,
    ...(signal && { signal }),
    ...(mediation && { mediation }),
  };

  const assertion = await navigator.credentials.get(requestOptions) as PublicKeyCredential | null;
  if (!assertion) throw new Error('Passkey assertion cancelled');

  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    credentialId: assertion.id,
    authenticatorData: new Uint8Array(response.authenticatorData),
    clientDataJSON: new Uint8Array(response.clientDataJSON),
    signature: new Uint8Array(response.signature),
    rawId: new Uint8Array(assertion.rawId),
  };
}
