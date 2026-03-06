# Passkey Wallet Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline passkey-based Flow wallet to runner — single P256 passkey for both Supabase auth and Flow transaction signing.

**Architecture:** Extend existing `passkey-auth` edge function with wallet endpoints and SEC1 key extraction. New `usePasskeyWallet` hook in runner handles WebAuthn ceremonies + Flow signing. Integrates into SignerSelector as a new signer type and LoginModal as a passkey auth option.

**Tech Stack:** WebAuthn API (browser native), `@onflow/rlp` (already installed), `sha3` (new dep), Supabase edge functions (Deno), P256/FLIP-264 signing.

**Design doc:** `docs/plans/2026-03-06-runner-passkey-wallet-design.md`

---

### Task 1: Add `sha3` dependency to runner

**Files:**
- Modify: `runner/package.json`

**Step 1: Install sha3**

```bash
cd runner && bun add sha3
```

This is needed for `sha3_256` hashing in Flow transaction encoding (domain tags use SHA3-256).

**Step 2: Commit**

```bash
git add runner/package.json runner/bun.lock
git commit -m "feat(runner): add sha3 dependency for passkey wallet encoding"
```

---

### Task 2: Extend passkey_credentials table with wallet columns

**Files:**
- Modify: `supabase/migrations/20260301144541_passkey_auth.sql`

**Step 1: Add wallet columns to migration**

Append to the end of `supabase/migrations/20260301144541_passkey_auth.sql`:

```sql
-- Passkey wallet: Flow account association
ALTER TABLE public.passkey_credentials
  ADD COLUMN IF NOT EXISTS public_key_sec1_hex TEXT,
  ADD COLUMN IF NOT EXISTS flow_address TEXT;

CREATE INDEX IF NOT EXISTS idx_passkey_credentials_flow_address
  ON public.passkey_credentials(flow_address);
```

**Step 2: Commit**

```bash
git add supabase/migrations/20260301144541_passkey_auth.sql
git commit -m "feat(supabase): add wallet columns to passkey_credentials"
```

---

### Task 3: Extend passkey-auth edge function — SEC1 extraction + wallet endpoints

**Files:**
- Modify: `supabase/functions/passkey-auth/index.ts`

**Step 1: Add COSE-to-SEC1 conversion helper**

Add this function near the top of `index.ts`, after the existing hex helpers:

```typescript
/**
 * Extract uncompressed SEC1 P256 public key hex from COSE key bytes.
 * COSE key is a CBOR map with labels: 1=kty, 3=alg, -1=crv, -2=x, -3=y
 * For ES256 (P-256): kty=2, crv=1, x=32bytes, y=32bytes
 * Returns "04" + hex(x) + hex(y) (130 chars)
 */
function coseToSec1Hex(coseBytes: Uint8Array): string | null {
  try {
    // Minimal CBOR map parser for COSE_Key
    // Using @levischuck/tiny-cbor for Deno edge function
    // But since we already have the public key from verifyRegistrationResponse,
    // we can extract x,y from the credential public key directly.
    // The publicKey from @simplewebauthn is in COSE format.
    // We need to decode it to get x,y coordinates.
    //
    // COSE_Key for P-256:
    // Map { 1: 2, 3: -7, -1: 1, -2: <x 32 bytes>, -3: <y 32 bytes> }
    //
    // Simple approach: the publicKey bytes from simplewebauthn's
    // registrationInfo.credential.publicKey is already the raw COSE key.
    // We'll use a minimal CBOR decoder.

    // For Deno, decode CBOR manually for this specific structure
    const decoded = decodeCoseKey(coseBytes);
    if (!decoded) return null;
    const { x, y } = decoded;
    if (x.length !== 32 || y.length !== 32) return null;
    return '04' + uint8ArrayToHex(x) + uint8ArrayToHex(y);
  } catch {
    return null;
  }
}

/**
 * Minimal CBOR decoder for COSE EC2 key maps.
 * Only handles the specific structure we need: {-2: x, -3: y}
 */
function decodeCoseKey(bytes: Uint8Array): { x: Uint8Array; y: Uint8Array } | null {
  // CBOR map starts with 0xa5 (5-item map) or 0xa4 (4-item map) for EC2 keys
  let offset = 0;
  const major = bytes[offset] >> 5;
  const additional = bytes[offset] & 0x1f;
  if (major !== 5) return null; // not a map
  offset++;

  let mapSize = additional;
  if (additional === 24) { mapSize = bytes[offset++]; }

  let x: Uint8Array | null = null;
  let y: Uint8Array | null = null;

  for (let i = 0; i < mapSize; i++) {
    // Read key (negative int or positive int)
    const keyByte = bytes[offset++];
    const keyMajor = keyByte >> 5;
    const keyAdditional = keyByte & 0x1f;

    let keyValue: number;
    if (keyMajor === 0) {
      // Positive integer
      keyValue = keyAdditional;
    } else if (keyMajor === 1) {
      // Negative integer: -1 - additional
      keyValue = -1 - keyAdditional;
    } else {
      // Skip unknown key types
      return null;
    }

    // Read value
    const valByte = bytes[offset];
    const valMajor = valByte >> 5;
    const valAdditional = valByte & 0x1f;
    offset++;

    if (valMajor === 2) {
      // Byte string
      let len = valAdditional;
      if (valAdditional === 24) { len = bytes[offset++]; }
      const value = bytes.slice(offset, offset + len);
      offset += len;

      if (keyValue === -2) x = value;
      else if (keyValue === -3) y = value;
    } else if (valMajor === 0) {
      // Positive integer - skip (kty, crv, etc)
      // already consumed the byte
    } else if (valMajor === 1) {
      // Negative integer - skip (alg = -7 etc)
      // already consumed the byte
    } else {
      return null; // unsupported value type
    }
  }

  if (!x || !y) return null;
  return { x, y };
}
```

**Step 2: Modify `/register/finish` to store and return SEC1 hex**

In the `/register/finish` case, after the `verifyRegistrationResponse` call succeeds, add SEC1 extraction. Find the line:

```typescript
const publicKeyHex = '\\x' + uint8ArrayToHex(publicKeyBytes);
```

After it, add:

```typescript
// Extract SEC1 uncompressed P256 public key for Flow wallet
const sec1Hex = coseToSec1Hex(publicKeyBytes);
```

Then update the insert to include `public_key_sec1_hex`:

```typescript
const { data: insertedCred } = await supabaseAdmin.from('passkey_credentials').insert({
  id: credential.id,
  user_id: userId,
  webauthn_user_id: challenge.webauthn_user_id,
  public_key: publicKeyHex,
  public_key_sec1_hex: sec1Hex,  // NEW
  counter: credential.counter,
  device_type: credentialDeviceType,
  backed_up: credentialBackedUp,
  transports: credential.transports,
  authenticator_name: authenticatorName,
}).select().single();
```

Update the success response to include `publicKeySec1Hex`:

```typescript
result = success({
  verified: true,
  tokenHash: linkData.properties?.hashed_token,
  publicKeySec1Hex: sec1Hex,  // NEW
  passkey: insertedCred ? { ... } : null
});
```

**Step 3: Add `/wallet/provision` endpoint**

Add a new case in the switch statement:

```typescript
case '/wallet/provision': {
  const authHeader = req.headers.get('Authorization');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader || '' } }
  });
  const { data: { user } } = await userClient.auth.getUser();

  if (!user) {
    result = error('UNAUTHORIZED', 'Authentication required');
    break;
  }

  const { credentialId: provCredId } = data as { credentialId: string };

  // Fetch the credential's SEC1 public key
  const { data: cred } = await supabaseAdmin.from('passkey_credentials')
    .select('public_key_sec1_hex, flow_address')
    .eq('id', provCredId)
    .eq('user_id', user.id)
    .single();

  if (!cred?.public_key_sec1_hex) {
    result = error('NO_PUBLIC_KEY', 'Credential has no public key for wallet provisioning');
    break;
  }

  if (cred.flow_address) {
    // Already provisioned
    result = success({ address: cred.flow_address });
    break;
  }

  // Create Flow account via Lilico API (same as flow-keys function)
  const ACCOUNT_API = Deno.env.get('FLOW_ACCOUNT_API') || 'https://lilico.app/api/proxy/account';
  const trimmedKey = cred.public_key_sec1_hex.startsWith('04')
    ? cred.public_key_sec1_hex.slice(2)
    : cred.public_key_sec1_hex;

  const accountRes = await fetch(ACCOUNT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publicKey: trimmedKey,
      signatureAlgorithm: 'ECDSA_P256',
      hashAlgorithm: 'SHA2_256',
    }),
  });

  if (!accountRes.ok) {
    const errBody = await accountRes.text();
    result = error('PROVISION_FAILED', `Account creation failed: ${errBody}`);
    break;
  }

  const accountJson = await accountRes.json();
  const flowAddress = accountJson.address;

  if (!flowAddress) {
    result = error('PROVISION_FAILED', 'No address in account creation response');
    break;
  }

  // Store flow_address
  await supabaseAdmin.from('passkey_credentials')
    .update({ flow_address: flowAddress })
    .eq('id', provCredId);

  result = success({ address: flowAddress });
  break;
}
```

**Step 4: Add `/wallet/accounts` endpoint**

```typescript
case '/wallet/accounts': {
  const authHeader = req.headers.get('Authorization');
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader || '' } }
  });
  const { data: { user } } = await userClient.auth.getUser();

  if (!user) {
    result = error('UNAUTHORIZED', 'Authentication required');
    break;
  }

  const { data: credentials } = await supabaseAdmin.from('passkey_credentials')
    .select('id, public_key_sec1_hex, flow_address, authenticator_name, created_at')
    .eq('user_id', user.id)
    .not('flow_address', 'is', null)
    .order('created_at', { ascending: false });

  result = success({
    accounts: credentials?.map((c) => ({
      credentialId: c.id,
      publicKeySec1Hex: c.public_key_sec1_hex,
      flowAddress: c.flow_address,
      authenticatorName: c.authenticator_name,
      createdAt: c.created_at,
    })) || []
  });
  break;
}
```

**Step 5: Commit**

```bash
git add supabase/functions/passkey-auth/index.ts
git commit -m "feat(supabase): extend passkey-auth with SEC1 extraction and wallet endpoints"
```

---

### Task 4: Create `passkeyEncode.ts` — Flow transaction encoding

**Files:**
- Create: `runner/src/auth/passkeyEncode.ts`

**Step 1: Create the encoding module**

Port from reference repo. Uses `@onflow/rlp` (already a dep of `@onflow/fcl`) and `sha3` (added in Task 1). No other new deps.

```typescript
/**
 * Flow transaction encoding + passkey signing helpers.
 * Ported from onflow/passkey-wallet-tech.
 */
import { SHA3 } from 'sha3';
import { encode as rlpEncode } from '@onflow/rlp';

// -- Hex / bytes helpers --

export const bytesToHex = (b: Uint8Array) =>
  Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');

export const hexToBytes = (hex: string) => {
  const clean = hex.replace(/^0x/, '');
  return new Uint8Array((clean.match(/.{1,2}/g) || []).map(b => parseInt(b, 16)));
};

const utf8ToBytes = (s: string) => new TextEncoder().encode(s);

const leftPadHex = (hex: string, byteLength: number) =>
  hex.replace(/^0x/, '').padStart(byteLength * 2, '0');

const rightPadHex = (hex: string, byteLength: number) =>
  hex.replace(/^0x/, '').padEnd(byteLength * 2, '0');

// -- Domain tags --

export const TRANSACTION_DOMAIN_TAG = rightPadHex(
  bytesToHex(utf8ToBytes('FLOW-V0.0-transaction')), 32
);

// -- SHA helpers --

export async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const buf = bytes.buffer instanceof ArrayBuffer
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    : new Uint8Array(bytes).slice().buffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return new Uint8Array(digest);
}

export function sha3_256(hex: string): string {
  const sha = new SHA3(256);
  sha.update(hexToBytes(hex.replace(/^0x/, '')));
  const out = sha.digest() as ArrayBuffer | Uint8Array;
  const bytes = out instanceof Uint8Array ? out : new Uint8Array(out);
  return bytesToHex(bytes);
}

// -- Voucher types --

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

export type Signable = { voucher: Voucher; message?: string };

// -- RLP encoding --

const addressBytes = (addr: string) => hexToBytes(leftPadHex(addr, 8));
const blockBytes = (block: string) => hexToBytes(leftPadHex(block, 32));
const argBytes = (arg: any) => utf8ToBytes(JSON.stringify(arg));
const scriptBytes = (script: string) => utf8ToBytes(script);
const sigBytes = (sig: string) => hexToBytes(sig.replace(/^0x/, ''));

const collectSigners = (v: Voucher) => {
  const map = new Map<string, number>();
  let i = 0;
  const add = (a: string) => {
    const key = a.replace(/^0x/, '');
    if (!map.has(key)) map.set(key, i++);
  };
  if (v.proposalKey.address) add(v.proposalKey.address);
  add(v.payer);
  v.authorizers.forEach(add);
  return map;
};

const preparePayload = (v: Voucher) => [
  scriptBytes(v.cadence || ''),
  v.arguments.map(argBytes),
  blockBytes(v.refBlock || '0'),
  v.computeLimit,
  addressBytes(v.proposalKey.address.replace(/^0x/, '')),
  v.proposalKey.keyId,
  v.proposalKey.sequenceNum,
  addressBytes(v.payer.replace(/^0x/, '')),
  v.authorizers.map(a => addressBytes(a.replace(/^0x/, ''))),
];

const prepareSigs = (v: Voucher, sigs: Voucher['payloadSigs']) => {
  const signers = collectSigners(v);
  return sigs
    .map(s => ({
      signerIndex: signers.get(s.address.replace(/^0x/, '')) || 0,
      keyId: s.keyId,
      sig: s.sig,
    }))
    .sort((a, b) => a.signerIndex === b.signerIndex ? a.keyId - b.keyId : a.signerIndex - b.signerIndex)
    .map(s => [s.signerIndex, s.keyId, sigBytes(s.sig)]);
};

export const encodeTransactionPayload = (v: Voucher) =>
  TRANSACTION_DOMAIN_TAG + bytesToHex(rlpEncode(preparePayload(v)) as unknown as Uint8Array);

export const encodeTransactionEnvelope = (v: Voucher) =>
  TRANSACTION_DOMAIN_TAG + bytesToHex(
    rlpEncode([preparePayload(v), prepareSigs(v, v.payloadSigs)]) as unknown as Uint8Array
  );

export const encodeMessageFromSignable = (signable: Signable, signerAddress: string): string => {
  const withPrefix = (a: string) => a.startsWith('0x') ? a : '0x' + a;
  const payloadSet = new Set<string>([
    ...signable.voucher.authorizers.map(withPrefix),
    withPrefix(signable.voucher.proposalKey.address),
  ]);
  payloadSet.delete(withPrefix(signable.voucher.payer));
  const isPayload = payloadSet.has(withPrefix(signerAddress));
  return isPayload
    ? encodeTransactionPayload(signable.voucher)
    : encodeTransactionEnvelope(signable.voucher);
};

// -- DER to raw P256 signature --

export const derToP256Raw = (der: Uint8Array): Uint8Array => {
  let offset = 0;
  const readLen = (): number => {
    let len = der[offset++];
    if (len & 0x80) {
      const numBytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < numBytes; i++) len = (len << 8) | der[offset++];
    }
    return len;
  };
  if (der[offset++] !== 0x30) throw new Error('Invalid DER: expected SEQUENCE');
  readLen(); // seq length
  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER r');
  let rLen = readLen();
  let r = der.slice(offset, offset + rLen);
  offset += rLen;
  if (der[offset++] !== 0x02) throw new Error('Invalid DER: expected INTEGER s');
  let sLen = readLen();
  let s = der.slice(offset, offset + sLen);
  if (r[0] === 0x00) r = r.slice(1);
  if (s[0] === 0x00) s = s.slice(1);
  const pad = (x: Uint8Array) =>
    x.length < 32 ? new Uint8Array([...new Uint8Array(32 - x.length).fill(0), ...x])
    : x.length > 32 ? x.slice(-32) : x;
  const out = new Uint8Array(64);
  out.set(pad(r), 0);
  out.set(pad(s), 32);
  return out;
};

// -- FLIP-264 extension data --

export function buildExtensionData(authenticatorData: Uint8Array, clientDataJSON: Uint8Array): string {
  const rlpEncoded = rlpEncode([authenticatorData, clientDataJSON]) as unknown as Uint8Array;
  const ext = new Uint8Array(1 + rlpEncoded.length);
  ext[0] = 0x01;
  ext.set(rlpEncoded instanceof Uint8Array ? rlpEncoded : new Uint8Array(rlpEncoded), 1);
  return bytesToHex(ext);
}
```

**Step 2: Commit**

```bash
git add runner/src/auth/passkeyEncode.ts
git commit -m "feat(runner): add Flow transaction encoding for passkey signing"
```

---

### Task 5: Create `usePasskeyWallet` hook

**Files:**
- Create: `runner/src/auth/usePasskeyWallet.ts`

**Step 1: Create the hook**

```typescript
/**
 * Passkey Wallet hook — WebAuthn-based Flow wallet using P256 passkeys.
 * Handles registration, login, account provisioning, and transaction signing.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import {
  sha256, hexToBytes, bytesToHex, derToP256Raw, buildExtensionData,
} from './passkeyEncode';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PasskeyAccount {
  credentialId: string;
  flowAddress: string;
  publicKeySec1Hex: string;
  authenticatorName?: string;
}

export interface PasskeySignResult {
  signature: string;        // hex, 64-byte raw r||s
  extensionData: string;    // hex, FLIP-264 format
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RP_ID = 'flowindex.io';
const RP_NAME = 'FlowIndex';
const PASSKEY_AUTH_URL = (() => {
  const base = import.meta.env.VITE_SUPABASE_URL || '';
  return `${base}/functions/v1/passkey-auth`;
})();
const GOTRUE_URL = import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function passkeyApi(endpoint: string, data: Record<string, unknown>, accessToken?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

  const res = await fetch(PASSKEY_AUTH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ endpoint, data }),
  });

  const json = await res.json();
  if (!json.success) {
    throw new Error(json.error?.message || 'Passkey API error');
  }
  return json.data;
}

// Base64URL helpers
function base64UrlToBytes(b64u: string): Uint8Array {
  const pad = '='.repeat((4 - (b64u.length % 4)) % 4);
  const b64 = (b64u + pad).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  const bin = String.fromCharCode(...bytes);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePasskeyWallet() {
  const { user, accessToken, applyTokenData } = useAuth();
  const [accounts, setAccounts] = useState<PasskeyAccount[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<PasskeyAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  // Load accounts when user is authenticated
  useEffect(() => {
    if (!user || !accessToken || loadedRef.current) return;
    loadedRef.current = true;

    passkeyApi('/wallet/accounts', {}, accessToken)
      .then((data) => {
        const accts = data.accounts || [];
        setAccounts(accts);
        if (accts.length > 0 && !selectedAccount) {
          setSelectedAccount(accts[0]);
        }
      })
      .catch(() => {
        // No passkey accounts — that's fine
      });
  }, [user, accessToken, selectedAccount]);

  // Reset on logout
  useEffect(() => {
    if (!user) {
      setAccounts([]);
      setSelectedAccount(null);
      loadedRef.current = false;
    }
  }, [user]);

  /**
   * Register a new passkey + create Supabase account + provision Flow account.
   * @param email - user's email for Supabase account creation
   */
  const register = useCallback(async (email: string) => {
    setLoading(true);
    try {
      // 1. Start registration
      const startData = await passkeyApi('/register/start', {
        rpId: RP_ID,
        rpName: RP_NAME,
        email,
      });

      const { options, challengeId } = startData;

      // 2. Create credential via WebAuthn
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        ...options,
        challenge: base64UrlToBytes(options.challenge),
        user: {
          ...options.user,
          id: base64UrlToBytes(options.user.id),
        },
        excludeCredentials: (options.excludeCredentials || []).map((c: any) => ({
          ...c,
          id: base64UrlToBytes(c.id),
        })),
        rp: { id: RP_ID, name: RP_NAME },
      };

      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      }) as PublicKeyCredential;

      if (!credential) throw new Error('Passkey creation cancelled');

      const attestation = credential.response as AuthenticatorAttestationResponse;

      // 3. Finish registration
      const finishData = await passkeyApi('/register/finish', {
        rpId: RP_ID,
        challengeId,
        response: {
          id: credential.id,
          rawId: bytesToBase64Url(new Uint8Array(credential.rawId)),
          response: {
            attestationObject: bytesToBase64Url(new Uint8Array(attestation.attestationObject)),
            clientDataJSON: bytesToBase64Url(new Uint8Array(attestation.clientDataJSON)),
          },
          type: credential.type,
          clientExtensionResults: credential.getClientExtensionResults(),
          authenticatorAttachment: (credential as any).authenticatorAttachment,
        },
      });

      const { tokenHash, publicKeySec1Hex } = finishData;

      // 4. Exchange tokenHash for Supabase session
      if (tokenHash) {
        const verifyRes = await fetch(`${GOTRUE_URL}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
        });
        if (verifyRes.ok) {
          const tokenData = await verifyRes.json();
          applyTokenData(tokenData);
        }
      }

      // 5. Provision Flow account
      // Need to wait for auth to be applied, so use the token from step 4
      const verifyRes2 = await fetch(`${GOTRUE_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
      });
      let authToken = accessToken;
      if (verifyRes2.ok) {
        const td = await verifyRes2.json();
        authToken = td.access_token;
      }

      const provisionData = await passkeyApi('/wallet/provision', {
        credentialId: credential.id,
      }, authToken);

      const newAccount: PasskeyAccount = {
        credentialId: credential.id,
        flowAddress: provisionData.address,
        publicKeySec1Hex: publicKeySec1Hex || '',
      };

      setAccounts(prev => [...prev, newAccount]);
      setSelectedAccount(newAccount);
    } finally {
      setLoading(false);
    }
  }, [accessToken, applyTokenData]);

  /**
   * Login with an existing passkey.
   */
  const login = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Start authentication
      const startData = await passkeyApi('/login/start', {
        rpId: RP_ID,
      });

      const { options, challengeId } = startData;

      // 2. Get assertion via WebAuthn
      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        ...options,
        challenge: base64UrlToBytes(options.challenge),
        allowCredentials: (options.allowCredentials || []).map((c: any) => ({
          ...c,
          id: base64UrlToBytes(c.id),
        })),
        rpId: RP_ID,
      };

      const assertion = await navigator.credentials.get({
        publicKey: publicKeyOptions,
      }) as PublicKeyCredential;

      if (!assertion) throw new Error('Passkey authentication cancelled');

      const assertionResponse = assertion.response as AuthenticatorAssertionResponse;

      // 3. Finish authentication
      const finishData = await passkeyApi('/login/finish', {
        rpId: RP_ID,
        challengeId,
        response: {
          id: assertion.id,
          rawId: bytesToBase64Url(new Uint8Array(assertion.rawId)),
          response: {
            authenticatorData: bytesToBase64Url(new Uint8Array(assertionResponse.authenticatorData)),
            clientDataJSON: bytesToBase64Url(new Uint8Array(assertionResponse.clientDataJSON)),
            signature: bytesToBase64Url(new Uint8Array(assertionResponse.signature)),
            userHandle: assertionResponse.userHandle
              ? bytesToBase64Url(new Uint8Array(assertionResponse.userHandle))
              : undefined,
          },
          type: assertion.type,
          clientExtensionResults: assertion.getClientExtensionResults(),
          authenticatorAttachment: (assertion as any).authenticatorAttachment,
        },
      });

      const { tokenHash } = finishData;

      // 4. Exchange tokenHash for Supabase session
      if (tokenHash) {
        const verifyRes = await fetch(`${GOTRUE_URL}/verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }),
        });
        if (verifyRes.ok) {
          const tokenData = await verifyRes.json();
          applyTokenData(tokenData);

          // 5. Load wallet accounts
          const accts = await passkeyApi('/wallet/accounts', {}, tokenData.access_token);
          const accountList = accts.accounts || [];
          setAccounts(accountList);
          if (accountList.length > 0) {
            setSelectedAccount(accountList[0]);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  }, [applyTokenData]);

  /**
   * Sign a Flow transaction message using the selected passkey.
   * The messageHex is the pre-hashed transaction payload/envelope from FCL.
   */
  const sign = useCallback(async (messageHex: string): Promise<PasskeySignResult> => {
    if (!selectedAccount) throw new Error('No passkey account selected');

    // SHA-256 hash of the message (FLIP-264: hash with account key's hashAlgo)
    const challenge = await sha256(hexToBytes(messageHex));

    // WebAuthn assertion with the challenge
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge.buffer instanceof ArrayBuffer
          ? challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength)
          : new Uint8Array(challenge).buffer,
        allowCredentials: [{
          id: base64UrlToBytes(selectedAccount.credentialId),
          type: 'public-key' as const,
        }],
        rpId: RP_ID,
        userVerification: 'preferred',
      },
    }) as PublicKeyCredential;

    if (!assertion) throw new Error('Passkey signing cancelled');

    const response = assertion.response as AuthenticatorAssertionResponse;

    // Convert DER signature to raw r||s (64 bytes)
    const derSig = new Uint8Array(response.signature);
    const rawSig = derToP256Raw(derSig);
    const sigHex = bytesToHex(rawSig);

    // Build FLIP-264 extension data
    const authenticatorData = new Uint8Array(response.authenticatorData);
    const clientDataJSON = new Uint8Array(response.clientDataJSON);
    const extensionData = buildExtensionData(authenticatorData, clientDataJSON);

    return { signature: sigHex, extensionData };
  }, [selectedAccount]);

  const selectAccount = useCallback((credentialId: string) => {
    const acct = accounts.find(a => a.credentialId === credentialId);
    if (acct) setSelectedAccount(acct);
  }, [accounts]);

  const hasPasskeySupport = typeof window !== 'undefined' && !!window.PublicKeyCredential;

  return {
    register,
    login,
    sign,
    accounts,
    selectedAccount,
    selectAccount,
    loading,
    hasPasskeySupport,
  };
}
```

**Step 2: Commit**

```bash
git add runner/src/auth/usePasskeyWallet.ts
git commit -m "feat(runner): add usePasskeyWallet hook for WebAuthn Flow signing"
```

---

### Task 6: Expose `applyTokenData` from AuthContext

**Files:**
- Modify: `runner/src/auth/AuthContext.tsx:19-29` (AuthContextValue interface)
- Modify: `runner/src/auth/AuthContext.tsx:291-301` (applyTokenResponse → expose)
- Modify: `runner/src/auth/AuthContext.tsx:337` (Provider value)

The `usePasskeyWallet` hook needs to apply tokens received from the passkey auth flow. The `applyTokenResponse` callback already exists but isn't exposed in the context.

**Step 1: Add `applyTokenData` to the interface**

In `AuthContext.tsx`, add to the `AuthContextValue` interface (around line 21):

```typescript
export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;
  signInWithProvider: (provider: OAuthProvider, redirectTo?: string) => void;
  sendMagicLink: (email: string, redirectTo?: string) => Promise<void>;
  verifyOtp: (email: string, token: string) => Promise<void>;
  applyTokenData: (data: { access_token: string; refresh_token: string }) => void;  // NEW
  signOut: () => void;
}
```

**Step 2: Expose in Provider value**

Update the Provider's value prop (around line 337):

```typescript
<AuthContext.Provider value={{ user, accessToken, loading, signInWithProvider, sendMagicLink, verifyOtp, applyTokenData: applyTokenResponse, signOut }}>
```

**Step 3: Commit**

```bash
git add runner/src/auth/AuthContext.tsx
git commit -m "feat(runner): expose applyTokenData from AuthContext for passkey auth"
```

---

### Task 7: Add `passkey` signer type to SignerSelector

**Files:**
- Modify: `runner/src/components/SignerSelector.tsx:7-10` (SignerOption type)
- Modify: `runner/src/components/SignerSelector.tsx:12-23` (SignerSelectorProps)
- Modify: `runner/src/components/SignerSelector.tsx:57-278` (component body)

**Step 1: Extend SignerOption type**

At line 7-10, update:

```typescript
export type SignerOption =
  | { type: 'none' }
  | { type: 'fcl' }
  | { type: 'local'; key: LocalKey; account: KeyAccount }
  | { type: 'passkey'; credentialId: string; flowAddress: string; publicKeySec1Hex: string };
```

**Step 2: Add passkey props to SignerSelectorProps**

Add to the interface (around line 12):

```typescript
interface SignerSelectorProps {
  selected: SignerOption;
  onSelect: (option: SignerOption) => void;
  localKeys: LocalKey[];
  accountsMap: Record<string, KeyAccount[]>;
  passkeyAccounts?: Array<{ credentialId: string; flowAddress: string; publicKeySec1Hex: string; authenticatorName?: string }>;  // NEW
  onViewAccount?: (address: string) => void;
  onOpenKeyManager?: () => void;
  onOpenConnectModal?: () => void;
  autoSign: boolean;
  onToggleAutoSign: (value: boolean) => void;
  network: 'mainnet' | 'testnet';
}
```

**Step 3: Add passkey section to dropdown**

In the component, after `{ selected, onSelect, localKeys, accountsMap, ...}` destructuring add `passkeyAccounts = []`.

Then after the "Local Wallet" section (around line 185) and before the "External Wallet" section (line 188), add:

```typescript
{/* Passkey Wallet group */}
{passkeyAccounts.length > 0 && (
  <>
    <div className="px-3 py-1 text-[10px] text-zinc-500 uppercase tracking-wider border-b border-zinc-700">
      Passkey Wallet
    </div>
    {passkeyAccounts.map((acct) => {
      const isSelected = selected.type === 'passkey' && selected.credentialId === acct.credentialId;
      const colors = colorsFromAddress(acct.flowAddress);
      return (
        <button
          key={acct.credentialId}
          onClick={() => {
            onSelect({ type: 'passkey', credentialId: acct.credentialId, flowAddress: acct.flowAddress, publicKeySec1Hex: acct.publicKeySec1Hex });
            setOpen(false);
          }}
          className={`w-full flex items-center gap-2 px-3 py-2 text-xs hover:bg-zinc-700 transition-colors ${
            isSelected ? 'text-emerald-400' : 'text-zinc-300'
          }`}
        >
          <Avatar size={16} name={`0x${acct.flowAddress}`} variant="beam" colors={colors} />
          <span className="truncate">{acct.authenticatorName || 'Passkey'}</span>
          <span className="text-zinc-500 ml-auto flex-shrink-0">
            {truncateAddress(acct.flowAddress)}
          </span>
        </button>
      );
    })}
  </>
)}
```

**Step 4: Handle passkey address in balance/display logic**

Update line 61:

```typescript
const selectedAddress = selected.type === 'local' ? selected.account.flowAddress
  : selected.type === 'passkey' ? selected.flowAddress
  : null;
```

Update `renderButtonContent` to handle passkey type (similar to local):

```typescript
if (selected.type === 'passkey') {
  const colors = colorsFromAddress(selected.flowAddress);
  return (
    <>
      {autoSign && <Zap className="w-3 h-3 text-amber-400" />}
      <Avatar size={16} name={`0x${selected.flowAddress}`} variant="beam" colors={colors} />
      {balance !== null ? (
        <span className="text-xs text-emerald-400 font-medium">{balance} FLOW</span>
      ) : (
        <span className="text-xs text-zinc-500">...</span>
      )}
    </>
  );
}
```

Also update `handleMainClick` to handle passkey view account:

```typescript
} else if (selected.type === 'passkey' && onViewAccount) {
  onViewAccount(selected.flowAddress);
}
```

**Step 5: Commit**

```bash
git add runner/src/components/SignerSelector.tsx
git commit -m "feat(runner): add passkey signer type to SignerSelector"
```

---

### Task 8: Add "Continue with Passkey" to LoginModal

**Files:**
- Modify: `runner/src/components/LoginModal.tsx`

**Step 1: Add passkey props and button**

Update the `LoginModalProps` interface:

```typescript
interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onPasskeyRegister?: (email: string) => Promise<void>;
  onPasskeyLogin?: () => Promise<void>;
  hasPasskeySupport?: boolean;
}
```

Update the component signature:

```typescript
export default function LoginModal({ open, onClose, onPasskeyRegister, onPasskeyLogin, hasPasskeySupport }: LoginModalProps) {
```

Add a `passkeyLoading` state:

```typescript
const [passkeyLoading, setPasskeyLoading] = useState(false);
```

Add a passkey handler:

```typescript
async function handlePasskey() {
  setError(null);
  setPasskeyLoading(true);
  try {
    if (onPasskeyLogin) {
      await onPasskeyLogin();
      onClose();
    }
  } catch (err) {
    // If login fails (no credential), user might need to register
    setError(err instanceof Error ? err.message : 'Passkey authentication failed');
  } finally {
    setPasskeyLoading(false);
  }
}
```

In the providers section (before the GitHub button, around line 234), add:

```typescript
{/* Passkey */}
{hasPasskeySupport && (
  <button
    type="button"
    onClick={handlePasskey}
    disabled={passkeyLoading}
    className="w-full flex items-center gap-3 px-4 py-2.5 bg-zinc-950 hover:bg-zinc-800 border border-zinc-700 hover:border-zinc-600 text-zinc-200 font-medium transition-all text-xs group active:scale-[0.98] disabled:opacity-50"
  >
    <svg className="w-4 h-4 shrink-0 text-zinc-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 10v4m0 0v4m0-4h4m-4 0H8" strokeLinecap="round" />
      <rect x="3" y="6" width="18" height="12" rx="2" />
    </svg>
    <span className="flex-1 text-left">
      {passkeyLoading ? 'Authenticating...' : 'Continue with Passkey'}
    </span>
    {!passkeyLoading && (
      <ArrowRight className="w-3.5 h-3.5 text-zinc-600 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
    )}
  </button>
)}
```

Reset `passkeyLoading` in `handleClose`.

**Step 2: Commit**

```bash
git add runner/src/components/LoginModal.tsx
git commit -m "feat(runner): add passkey auth option to LoginModal"
```

---

### Task 9: Wire passkey wallet into App.tsx

**Files:**
- Modify: `runner/src/App.tsx`

This is the main integration task. The changes:

**Step 1: Import usePasskeyWallet**

Add near the other auth imports (around line 19-22):

```typescript
import { usePasskeyWallet } from './auth/usePasskeyWallet';
```

**Step 2: Initialize the hook**

After the `useLocalKeys()` call (around line 307), add:

```typescript
const {
  register: passkeyRegister,
  login: passkeyLogin,
  sign: passkeySign,
  accounts: passkeyAccounts,
  selectedAccount: selectedPasskeyAccount,
  selectAccount: selectPasskeyAccount,
  loading: passkeyLoading,
  hasPasskeySupport,
} = usePasskeyWallet();
```

**Step 3: Handle passkey signer in handleRun**

In the `handleRun` callback (around line 720-737), add a passkey case. After the `selectedSigner.type === 'local'` branch:

```typescript
} else if (selectedSigner.type === 'passkey') {
  const passkeySignFn = async (message: string) => {
    const result = await passkeySign(message);
    return result.signature;
  };
  if (codeType === 'contract') {
    await deployContract(activeCode, selectedSigner.flowAddress, 0, passkeySignFn, onResult, 'ECDSA_P256', 'SHA2_256');
  } else {
    await executeCustodialTransaction(activeCode, paramValues, selectedSigner.flowAddress, 0, passkeySignFn, onResult, 'ECDSA_P256', 'SHA2_256');
  }
}
```

**Important:** For FLIP-264 extension data support, we also need to modify `executeCustodialTransaction` to pass through `extensionData`. Update the signing function in `execute.ts` (line 113-119) to support returning extensionData:

In `runner/src/flow/execute.ts`, update the `signingFunction` return type to include optional `extensionData`:

```typescript
signingFunction: async (signable: { message: string }) => {
  const sig = await signFn(signable.message);
  // Support string (legacy) or object with extensionData (passkey)
  if (typeof sig === 'string') {
    return {
      addr: fcl.withPrefix(signerAddress),
      keyId: keyIndex,
      signature: sig,
    };
  }
  return {
    addr: fcl.withPrefix(signerAddress),
    keyId: keyIndex,
    signature: sig.signature,
    extensionData: sig.extensionData,
  };
},
```

And update the `signFn` type to: `signFn: (message: string) => Promise<string | { signature: string; extensionData?: string }>`

Then in App.tsx, the passkey sign function should return the full object:

```typescript
const passkeySignFn = async (message: string) => {
  return await passkeySign(message);
};
```

**Step 4: Pass passkey accounts to SignerSelector**

Update the SignerSelector props (around line 1311):

```typescript
<SignerSelector
  selected={selectedSigner}
  onSelect={persistSigner}
  localKeys={localKeys}
  accountsMap={accountsMap}
  passkeyAccounts={passkeyAccounts}
  onViewAccount={handleViewAccount}
  onOpenKeyManager={() => setShowKeyManager(true)}
  onOpenConnectModal={() => setConnectModalOpen(true)}
  autoSign={autoSign}
  onToggleAutoSign={handleToggleAutoSign}
  network={network}
/>
```

**Step 5: Pass passkey handlers to LoginModal**

Find the LoginModal usage and add the passkey props:

```typescript
<LoginModal
  open={loginModalOpen}
  onClose={() => setLoginModalOpen(false)}
  onPasskeyLogin={passkeyLogin}
  hasPasskeySupport={hasPasskeySupport}
/>
```

**Step 6: Handle passkey signer persistence in `persistSigner`**

Update the `persistSigner` callback (around line 357) to handle passkey type:

```typescript
} else if (signer.type === 'passkey') {
  localStorage.setItem('flow-selected-signer', JSON.stringify({
    type: 'passkey',
    credentialId: signer.credentialId,
    flowAddress: signer.flowAddress,
    publicKeySec1Hex: signer.publicKeySec1Hex,
  }));
}
```

**Step 7: Restore passkey signer from localStorage on mount**

In the signer restoration logic, add handling for the passkey type (look for where `flow-selected-signer` is loaded from localStorage).

**Step 8: Update handleRun dependency array**

Add `passkeySign` to the `handleRun` useCallback dependency array.

**Step 9: Commit**

```bash
git add runner/src/App.tsx runner/src/flow/execute.ts
git commit -m "feat(runner): wire passkey wallet into App signing and UI"
```

---

### Task 10: Update `execute.ts` signFn type for extensionData

**Files:**
- Modify: `runner/src/flow/execute.ts:88-147` (executeCustodialTransaction)
- Modify: `runner/src/flow/execute.ts:162-245` (deployContract)

**Step 1: Update signFn type in both functions**

Change the `signFn` parameter type in both `executeCustodialTransaction` and `deployContract`:

From:
```typescript
signFn: (message: string) => Promise<string>,
```

To:
```typescript
signFn: (message: string) => Promise<string | { signature: string; extensionData?: string }>,
```

**Step 2: Update signingFunction in both to handle the new return type**

Replace the `signingFunction` in `executeCustodialTransaction` (around line 113):

```typescript
signingFunction: async (signable: { message: string }) => {
  const result = await signFn(signable.message);
  const sig = typeof result === 'string' ? result : result.signature;
  const ext = typeof result === 'string' ? undefined : result.extensionData;
  return {
    addr: fcl.withPrefix(signerAddress),
    keyId: keyIndex,
    signature: sig,
    ...(ext ? { extensionData: ext } : {}),
  };
},
```

Apply the same pattern to `deployContract`'s `signingFunction` (around line 212).

**Step 3: Commit**

```bash
git add runner/src/flow/execute.ts
git commit -m "feat(runner): support extensionData in custodial signing for FLIP-264"
```

---

### Task 11: Build and verify

**Step 1: Install dependencies**

```bash
cd runner && bun install
```

**Step 2: Build**

```bash
cd runner && bun run build
```

Fix any TypeScript errors.

**Step 3: Commit any fixes**

```bash
git add -u
git commit -m "fix(runner): resolve build errors from passkey wallet integration"
```

---

### Task 12: Final commit and summary

**Step 1: Verify git log**

```bash
git log --oneline -10
```

**Step 2: Ensure all files are committed**

```bash
git status
```

All changes should be committed across ~8 commits covering: dependency, migration, edge function, encoding module, hook, AuthContext exposure, SignerSelector, LoginModal, App.tsx integration, execute.ts update.
