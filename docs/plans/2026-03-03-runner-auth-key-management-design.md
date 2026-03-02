# Runner Auth & Key Management Design

**Date:** 2026-03-03
**Status:** Approved

## Overview

Add authentication and custodial key management to the Cadence Runner. Users can import existing private keys or create new Flow addresses with generated keys. Keys are encrypted and stored in Supabase, with all signing operations happening server-side via Edge Functions.

## Decisions

- **Auth**: Reuse main site Supabase auth (shared session across subdomains)
- **Key storage**: AES-256-GCM encrypted private keys in Supabase DB, master key in Edge Function env var
- **Signing**: Server-side only — private keys never reach the frontend
- **Wallet coexistence**: FCL wallet connection and custodial keys coexist, user chooses per-transaction
- **Account creation**: Via self-hosted flow-account-creation API (caller provides public key, API returns address)
- **Backend execution**: Supabase Edge Functions (no new services to maintain)

## Architecture

```
Runner Frontend
├── FCL Wallet (existing, unchanged)
└── Custodial Keys (new)
        │
        ▼
Supabase Edge Functions
├── POST /keys/create   → generate keypair, call flow-account-creation, encrypt & store
├── POST /keys/import   → validate key, encrypt & store
├── GET  /keys/list     → return user's keys (address + public key only)
├── POST /keys/sign     → decrypt key, sign transaction envelope, return signature
└── DELETE /keys/:id    → delete key
        │
        ├── Supabase DB (user_keys table, RLS enforced)
        └── ENV: ENCRYPTION_KEY (AES-256 master key)
```

## Data Model

### Table: `user_keys`

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | PK, default gen_random_uuid() |
| user_id | uuid | FK → auth.users, RLS enforced |
| label | text | User-defined name, e.g. "My Dev Key" |
| flow_address | text | Flow address (0x...) |
| public_key | text | Hex-encoded public key |
| encrypted_private_key | text | base64(iv + ciphertext + auth_tag), AES-256-GCM |
| key_index | int | Flow account key index, default 0 |
| sig_algo | text | ECDSA_P256 or ECDSA_secp256k1 |
| hash_algo | text | SHA2_256 or SHA3_256 |
| source | text | 'imported' or 'created' |
| created_at | timestamptz | default now() |

**RLS policy**: `user_id = auth.uid()` for all operations.

## Encryption

- Algorithm: AES-256-GCM
- Master key: 32-byte key stored in `ENCRYPTION_KEY` env var
- Per-key: random 12-byte IV generated for each encryption
- Storage format: `base64(iv[12] || ciphertext || auth_tag[16])`
- Decryption only happens inside Edge Functions, never on frontend

## Workflows

### Create New Address

1. Frontend calls `POST /keys/create` with `{ label, sigAlgo?, hashAlgo? }`
2. Edge Function generates ECDSA keypair (default P256)
3. Calls flow-account-creation API with public key → gets Flow address + tx_id
4. Encrypts private key, inserts into `user_keys`
5. Returns `{ flow_address, public_key, key_index, label }`

### Import Existing Key

1. Frontend sends `POST /keys/import` with `{ privateKey, sigAlgo, hashAlgo, label }`
2. Edge Function derives public key from private key
3. Queries Flow chain to find matching account/key_index
4. Encrypts and stores, returns `{ flow_address, public_key, key_index }`

### Sign Transaction (Interactive)

1. Runner builds unsigned transaction envelope
2. Sends `POST /keys/sign` with `{ keyId, message }` (message = RLP-encoded envelope)
3. Edge Function decrypts private key, signs with FCL-compatible signature
4. Returns `{ signature }` — frontend attaches to envelope and submits to Flow

### Sign Transaction (Automated)

Same as interactive, triggered by scheduled task or webhook instead of user click.

## Frontend Changes

### Signer Selector (Runner)

Add a signer mode toggle near the Execute button:
- **FCL Wallet** — existing flow, opens wallet popup
- **Custodial Key** — dropdown of saved keys, server-side signing

### Key Management Page

Accessible from Runner settings or user profile:
- List saved keys (label, address, source, created date)
- "Create New Address" button
- "Import Key" button (paste private key hex)
- Delete key (with confirmation)

## Security Considerations

- Private keys never sent to or stored on frontend
- RLS ensures user isolation at DB level
- AES-256-GCM is authenticated encryption (tamper detection)
- HTTPS only for all Edge Function calls
- Rate limiting on /keys/sign to prevent abuse
- Import endpoint validates key over HTTPS, private key in transit only once

## Future Upgrades

- Replace env var master key with GCP KMS envelope encryption
- Add per-key spending limits or transaction type restrictions
- Multi-sig support (multiple custodial keys per transaction)
