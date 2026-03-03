import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0';
import { p256 } from 'npm:@noble/curves@1.8.0/p256';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestBody {
  endpoint: string;
  data: Record<string, unknown>;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

// ---------------------------------------------------------------------------
// Response helpers (same pattern as passkey-auth)
// ---------------------------------------------------------------------------

function success<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function error(code: string, message: string): ApiResponse {
  return { success: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// Byte / hex / base64url conversion helpers
// ---------------------------------------------------------------------------

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = Number.parseInt(clean.substring(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64urlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const binary = atob(b64 + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64url(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------------------------------------------------------------------------
// AES-256-GCM encryption / decryption for private keys
// ---------------------------------------------------------------------------

async function getEncryptionKey(): Promise<CryptoKey> {
  const keyHex = Deno.env.get('ENCRYPTION_KEY')!;
  return crypto.subtle.importKey(
    'raw',
    hexToBytes(keyHex),
    'AES-GCM',
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptPrivateKey(privateKeyHex: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await getEncryptionKey();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(privateKeyHex),
  );
  const combined = new Uint8Array(iv.length + new Uint8Array(ciphertext).length);
  combined.set(iv);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decryptPrivateKey(encrypted: string): Promise<string> {
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);
  const key = await getEncryptionKey();
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(decrypted);
}

// ---------------------------------------------------------------------------
// P-256 key helpers (using @noble/curves — avoids Web Crypto DER issues)
// ---------------------------------------------------------------------------

function generateP256KeyPair(): { publicKeyHex: string; privateKeyHex: string } {
  const privateKeyBytes = p256.utils.randomPrivateKey();
  const privateKeyHex = bytesToHex(privateKeyBytes);
  const publicKeyPoint = p256.getPublicKey(privateKeyBytes, false); // uncompressed (65 bytes)
  const publicKeyHex = bytesToHex(publicKeyPoint.slice(1)); // strip 0x04 prefix → 64 bytes
  return { publicKeyHex, privateKeyHex };
}

function derivePublicKey(privateKeyHex: string): string {
  const publicKeyPoint = p256.getPublicKey(hexToBytes(privateKeyHex), false);
  return bytesToHex(publicKeyPoint.slice(1)); // strip 0x04 prefix
}

function signMessage(privateKeyHex: string, messageHex: string): string {
  // Flow expects the signer to hash-then-sign. The FCL adapter sends pre-hashed
  // message bytes, so we sign the raw bytes directly (prehash: false is default).
  // lowS: true ensures canonical signatures.
  const sig = p256.sign(hexToBytes(messageHex), hexToBytes(privateKeyHex), {
    lowS: true,
    prehash: false,
  });
  return sig.toCompactHex(); // r||s as 128 hex chars (64 bytes)
}

// ---------------------------------------------------------------------------
// Flow Account Creation API
// ---------------------------------------------------------------------------

async function createFlowAccount(
  publicKeyHex: string,
  network: 'mainnet' | 'testnet' = 'mainnet',
): Promise<{ address: string }> {
  const lilicoBase = 'https://openapi.lilico.app';
  const endpoint = network === 'testnet'
    ? `${lilicoBase}/v1/address/testnet`
    : `${lilicoBase}/v1/address`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: Deno.env.get('LILICO_API_KEY') || '',
    },
    body: JSON.stringify({
      publicKey: publicKeyHex,
      signatureAlgorithm: 'ECDSA_P256',
      hashAlgorithm: 'SHA2_256',
      weight: 1000,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Lilico API error (${res.status}): ${body}`);
  }

  const json = await res.json();

  // Lilico returns { txId } — need to poll for sealed result
  const txId = json.txId || json.data?.txId;
  if (!txId) {
    // Some responses may include address directly
    const address = json.address || json.data?.address;
    if (address) return { address };
    throw new Error(`Lilico API: no txId or address in response: ${JSON.stringify(json)}`);
  }

  // Poll Flow Access Node REST API for sealed transaction
  const accessNode = network === 'testnet'
    ? 'https://rest-testnet.onflow.org'
    : 'https://rest-mainnet.onflow.org';

  const maxAttempts = 30;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const txRes = await fetch(`${accessNode}/v1/transaction_results/${txId}`);
    if (!txRes.ok) continue;

    const txResult = await txRes.json();
    if (txResult.status !== 'SEALED') continue;

    if (txResult.error_message) {
      throw new Error(`Account creation tx failed: ${txResult.error_message}`);
    }

    // Extract address from flow.AccountCreated event
    for (const event of txResult.events || []) {
      if (event.type === 'flow.AccountCreated') {
        try {
          const payload = JSON.parse(atob(event.payload));
          const address = payload?.value?.fields?.find(
            (f: { name: string }) => f.name === 'address',
          )?.value?.value;
          if (address) return { address: address.replace(/^0x/, '') };
        } catch {
          // Try next event
        }
      }
    }

    throw new Error('Account created but could not extract address from events');
  }

  throw new Error('Account creation timed out — transaction not sealed within 60s');
}

// ---------------------------------------------------------------------------
// Auth helper — extracts authenticated user from JWT
// ---------------------------------------------------------------------------

async function getAuthUser(
  req: Request,
  supabaseUrl: string,
): Promise<{ id: string } | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;

  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const {
    data: { user },
  } = await userClient.auth.getUser();
  return user;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type, Authorization, apikey, x-client-info',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const { endpoint, data }: RequestBody = await req.json();

    // All endpoints require authentication
    const user = await getAuthUser(req, supabaseUrl);
    if (!user) {
      return new Response(
        JSON.stringify(error('UNAUTHORIZED', 'Authentication required')),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
          },
        },
      );
    }

    let result: ApiResponse;

    switch (endpoint) {
      // -------------------------------------------------------------------
      // /keys/create — Generate keypair, create Flow account, store key
      // -------------------------------------------------------------------
      case '/keys/create': {
        const { label, network } = data as {
          label?: string;
          network?: 'mainnet' | 'testnet';
        };

        // 1. Generate P-256 keypair
        const { publicKeyHex, privateKeyHex } = generateP256KeyPair();

        // 2. Create Flow account via API
        let flowAddress: string;
        try {
          const account = await createFlowAccount(publicKeyHex, network || 'mainnet');
          flowAddress = account.address;
        } catch (e) {
          result = error(
            'ACCOUNT_CREATION_FAILED',
            e instanceof Error ? e.message : 'Failed to create Flow account',
          );
          break;
        }

        // 3. Encrypt private key
        const encryptedKey = await encryptPrivateKey(privateKeyHex);

        // 4. Insert into user_keys using service role client (bypasses RLS)
        const { data: insertedKey, error: insertError } = await supabaseAdmin
          .from('user_keys')
          .insert({
            user_id: user.id,
            label: label || '',
            flow_address: flowAddress,
            public_key: publicKeyHex,
            encrypted_private_key: encryptedKey,
            key_index: 0,
            sig_algo: 'ECDSA_P256',
            hash_algo: 'SHA2_256',
            source: 'created',
          })
          .select(
            'id, flow_address, public_key, key_index, label, sig_algo, hash_algo, created_at',
          )
          .single();

        if (insertError) {
          result = error('DB_ERROR', insertError.message);
          break;
        }

        result = success(insertedKey);
        break;
      }

      // -------------------------------------------------------------------
      // /keys/import — Accept private key, derive public key, store
      // -------------------------------------------------------------------
      case '/keys/import': {
        const { privateKey, label, flowAddress, keyIndex } = data as {
          privateKey: string;
          label?: string;
          flowAddress?: string;
          keyIndex?: number;
        };

        // Validate private key hex (64 hex chars = 32 bytes for P-256)
        const cleanKey = privateKey.startsWith('0x')
          ? privateKey.slice(2)
          : privateKey;
        if (!/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
          result = error(
            'INVALID_KEY',
            'Private key must be 64 hex characters (32 bytes)',
          );
          break;
        }

        // Derive public key
        let publicKeyHex: string;
        try {
          publicKeyHex = derivePublicKey(cleanKey);
        } catch (e) {
          result = error(
            'INVALID_KEY',
            'Could not derive public key from private key',
          );
          break;
        }

        if (!flowAddress) {
          result = error(
            'MISSING_ADDRESS',
            'flowAddress is required when importing a key',
          );
          break;
        }

        // Encrypt and store
        const encryptedKey = await encryptPrivateKey(cleanKey);

        const { data: insertedKey, error: insertError } = await supabaseAdmin
          .from('user_keys')
          .insert({
            user_id: user.id,
            label: label || '',
            flow_address: flowAddress,
            public_key: publicKeyHex,
            encrypted_private_key: encryptedKey,
            key_index: keyIndex ?? 0,
            sig_algo: 'ECDSA_P256',
            hash_algo: 'SHA3_256',
            source: 'imported',
          })
          .select(
            'id, flow_address, public_key, key_index, label, sig_algo, hash_algo, created_at',
          )
          .single();

        if (insertError) {
          result = error('DB_ERROR', insertError.message);
          break;
        }

        result = success(insertedKey);
        break;
      }

      // -------------------------------------------------------------------
      // /keys/list — Return user's keys (no private key data)
      // -------------------------------------------------------------------
      case '/keys/list': {
        const { data: keys, error: listError } = await supabaseAdmin
          .from('user_keys')
          .select(
            'id, flow_address, public_key, key_index, label, sig_algo, hash_algo, source, created_at',
          )
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (listError) {
          result = error('DB_ERROR', listError.message);
          break;
        }

        result = success({ keys: keys || [] });
        break;
      }

      // -------------------------------------------------------------------
      // /keys/sign — Decrypt private key, sign message, return signature
      // -------------------------------------------------------------------
      case '/keys/sign': {
        const { keyId, message } = data as {
          keyId: string;
          message: string;
        };

        if (!keyId || !message) {
          result = error(
            'MISSING_PARAMS',
            'keyId and message are required',
          );
          break;
        }

        // Validate message is hex
        const cleanMessage = message.startsWith('0x')
          ? message.slice(2)
          : message;
        if (!/^[0-9a-fA-F]*$/.test(cleanMessage) || cleanMessage.length === 0) {
          result = error('INVALID_MESSAGE', 'message must be a hex string');
          break;
        }

        // Fetch the key — must belong to this user
        const { data: keyRow, error: fetchError } = await supabaseAdmin
          .from('user_keys')
          .select('encrypted_private_key')
          .eq('id', keyId)
          .eq('user_id', user.id)
          .single();

        if (fetchError || !keyRow) {
          result = error('KEY_NOT_FOUND', 'Key not found or access denied');
          break;
        }

        // Decrypt and sign
        const privateKeyHex = await decryptPrivateKey(
          keyRow.encrypted_private_key,
        );
        const signature = signMessage(privateKeyHex, cleanMessage);

        result = success({ signature });
        break;
      }

      // -------------------------------------------------------------------
      // /keys/delete — Remove a key by id
      // -------------------------------------------------------------------
      case '/keys/delete': {
        const { keyId } = data as { keyId: string };

        if (!keyId) {
          result = error('MISSING_PARAMS', 'keyId is required');
          break;
        }

        const { data: deleted, error: deleteError } = await supabaseAdmin
          .from('user_keys')
          .delete()
          .eq('id', keyId)
          .eq('user_id', user.id)
          .select('id')
          .single();

        if (deleteError || !deleted) {
          result = error('KEY_NOT_FOUND', 'Key not found or access denied');
          break;
        }

        result = success({ deleted: true });
        break;
      }

      default:
        result = error('NOT_FOUND', `Unknown endpoint: ${endpoint}`);
    }

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify(
        error(
          'UNKNOWN_ERROR',
          e instanceof Error ? e.message : 'Internal server error',
        ),
      ),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }
}, { port: Number(Deno.env.get('PORT')) || 8000 });
