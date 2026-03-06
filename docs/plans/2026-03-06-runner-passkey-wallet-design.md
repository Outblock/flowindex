# Passkey Wallet for Runner — Design

Date: 2026-03-06

## Goal

Add passkey-based Flow wallet support to the runner as an inline third wallet option. A single P256 passkey serves dual purpose: Supabase authentication and Flow transaction signing.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration style | Inline in WalletButton (not popup) | Simplest UX, no deployment overhead |
| Account provisioning | Existing Lilico API (via flow-keys) | Already integrated, works mainnet+testnet |
| Credential storage | Supabase (server-side) | Enables cross-subdomain discovery + passkey login reuse |
| RP ID | Hardcoded `flowindex.io` | Cross-subdomain sharing, no client override |
| Public key extraction | Server-side (edge function) | Avoids cbor-x dependency in runner bundle |
| UI placement | WalletButton + LoginModal | One passkey = logged in + wallet connected |

## Data Model

Extend existing `passkey_credentials` table:

```sql
ALTER TABLE public.passkey_credentials
  ADD COLUMN IF NOT EXISTS public_key_sec1_hex TEXT,
  ADD COLUMN IF NOT EXISTS flow_address TEXT;
```

- `public_key_sec1_hex`: uncompressed P256 (`04` || x || y), 130 hex chars
- `flow_address`: `0x`-prefixed Flow address, set after account provisioning

## Server Changes (passkey-auth edge function)

### Modified: `/register/finish`

After `verifyRegistrationResponse()`, convert COSE public key to SEC1 uncompressed hex. Store in `public_key_sec1_hex` column. Return it in the response alongside `tokenHash`.

### New: `/wallet/provision`

Authenticated endpoint. Takes `credentialId`, reads `public_key_sec1_hex` from DB, calls Lilico account creation API (same as flow-keys edge function), stores resulting `flow_address`, returns it.

### New: `/wallet/accounts`

Authenticated endpoint. Returns all passkey credentials with their `flow_address` for the current user.

## Client: `usePasskeyWallet` Hook

Location: `runner/src/auth/usePasskeyWallet.ts`

### API

```typescript
interface PasskeyAccount {
  credentialId: string;
  flowAddress: string;
  publicKeySec1Hex: string;
  authenticatorName?: string;
}

interface UsePasskeyWallet {
  register(): Promise<void>;       // Create passkey + Supabase account + Flow account
  login(): Promise<void>;          // Login with existing passkey, load Flow accounts
  sign(messageHex: string): Promise<CompositeSignature>;
  accounts: PasskeyAccount[];
  selectedAccount: PasskeyAccount | null;
  selectAccount(credentialId: string): void;
  loading: boolean;
}
```

### `register()` Flow

1. Call `/register/start` with `rpId: "flowindex.io"` + user email
2. `navigator.credentials.create()` with returned options
3. Call `/register/finish` with attestation response → get `public_key_sec1_hex` + `tokenHash`
4. Exchange `tokenHash` for Supabase session (GoTrue verify endpoint)
5. Call `/wallet/provision` with credential ID → get `flow_address`
6. Set auth context (logged in) + wallet state (connected)

### `login()` Flow

1. Call `/login/start` with `rpId: "flowindex.io"`
2. `navigator.credentials.get()` with returned options
3. Call `/login/finish` with assertion response → get `tokenHash`
4. Exchange `tokenHash` for Supabase session
5. Call `/wallet/accounts` → load existing Flow addresses
6. Set auth context + wallet state

### `sign(messageHex)` Flow

1. SHA-256(hexToBytes(messageHex)) → challenge bytes
2. `navigator.credentials.get({ challenge, allowCredentials: [selectedCredential] })`
3. Extract DER signature from assertion → convert to raw r||s (64 bytes)
4. Build FLIP-264 extension data: `0x01 || RLP([authenticatorData, clientDataJSON])`
5. Return `{ addr, keyId: 0, signature: sigHex, extensionData }`

## Client: `passkeyEncode.ts`

Location: `runner/src/auth/passkeyEncode.ts`

Ported from reference repo (`passkey-wallet-tech`), no new dependencies:

- `encodeTransactionPayload(voucher)` — RLP encode payload (uses `@onflow/rlp`)
- `encodeTransactionEnvelope(voucher)` — RLP encode envelope with payload sigs
- `encodeMessageFromSignable(signable, signerAddress)` — determine payload vs envelope
- `derToP256Raw(der)` — ASN.1 DER → 64-byte raw r||s
- `sha256(bytes)` — via `crypto.subtle.digest`
- Domain tags: `FLOW-V0.0-transaction`, `FCL-ACCOUNT-PROOF-V0.0`

## UI Changes

### LoginModal

Add "Continue with Passkey" button as the first option (above GitHub/Google/Email). Detects WebAuthn availability via `window.PublicKeyCredential`. On click:

- If user has no passkey → register flow (create passkey + account)
- If user has passkey → login flow

On success: modal closes, user is logged in + wallet auto-connected.

### WalletButton

Add "Passkey Wallet" as third option in connect dropdown:

```
┌──────────────┐
│ Local Key    │
│ FCL Wallet   │
│ Passkey      │  ← new
└──────────────┘
```

On click: if already logged in with passkey accounts, show account selector. If not, trigger passkey login. Connected state shows Flow address with avatar (same as other wallet types).

## Transaction Signing Integration

The runner's transaction execution needs to call `usePasskeyWallet.sign()` when the active wallet is a passkey wallet. The sign function handles:

1. Building the correct message (payload vs envelope) from the signable voucher
2. Hashing with SHA-256 (per FLIP-264 for P256 + SHA2_256 key)
3. WebAuthn assertion (browser passkey prompt)
4. Signature format conversion + extension data construction

## Out of Scope

- FCL POP/RPC service registration (inline only, no popup wallet)
- Client-side CBOR parsing (server handles SEC1 extraction)
- Separate wallet accounts table (extend existing passkey_credentials)
- Account proof signing (can be added later)
- Multi-key accounts (single passkey = keyId 0)
