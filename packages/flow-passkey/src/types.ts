/**
 * Flow transaction voucher — matches FCL's internal voucher format.
 */
export type Voucher = {
  cadence: string;
  refBlock: string;
  computeLimit: number;
  arguments: any[];
  proposalKey: { address: string; keyId: number; sequenceNum: number };
  payer: string;
  authorizers: string[];
  payloadSigs: { address: string; keyId: number; sig: string; extensionData?: string }[];
  envelopeSigs: { address: string; keyId: number; sig: string; extensionData?: string }[];
};

/**
 * FCL signable object passed to signing functions.
 */
export type Signable = {
  voucher: Voucher;
  message?: string;
};

/**
 * Result of signing a Flow transaction with a passkey.
 */
export interface PasskeySignResult {
  signature: string;
  extensionData: string;
}

/**
 * Result of creating a new passkey credential via WebAuthn.
 */
export interface PasskeyCredentialResult {
  credentialId: string;
  attestationResponse: AuthenticatorAttestationResponse;
  rawId: Uint8Array;
  type: string;
  publicKeySec1Hex: string;
}

/**
 * Result of getting a passkey assertion via WebAuthn.
 */
export interface PasskeyAssertionResult {
  credentialId: string;
  authenticatorData: Uint8Array;
  clientDataJSON: Uint8Array;
  signature: Uint8Array;
  rawId: Uint8Array;
}
