// Types
export type {
  Voucher,
  Signable,
  PasskeySignResult,
  PasskeyCredentialResult,
  PasskeyAssertionResult,
} from './types';

// Utilities
export { bytesToHex, hexToBytes, base64UrlToBytes, bytesToBase64Url } from './utils';

// Transaction encoding
export {
  TRANSACTION_DOMAIN_TAG,
  sha256,
  sha3_256,
  encodeTransactionPayload,
  encodeTransactionEnvelope,
  encodeMessageFromSignable,
  derToP256Raw,
  buildExtensionData,
} from './encode';

// WebAuthn credential management
export { createPasskeyCredential, getPasskeyAssertion } from './webauthn';
export type { CreatePasskeyOptions, GetAssertionOptions } from './webauthn';

// Flow transaction signing
export { signFlowTransaction, createPasskeyAuthz } from './signer';
export type { SignTransactionOptions } from './signer';
