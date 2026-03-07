import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.0';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from 'npm:@simplewebauthn/server@11.0.0';

interface RequestBody {
  endpoint: string;
  data: Record<string, unknown>;
}

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

const CHALLENGE_TTL_MINUTES = 5;
const SUPPORTED_ALGORITHMS = [-7, -257];
const RATE_LIMITS = { ip: { maxAttempts: 5, windowMinutes: 1 }, email: { maxAttempts: 10, windowMinutes: 1 } };

function success<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

function error(code: string, message: string): ApiResponse {
  return { success: false, error: { code, message } };
}

function getOrigin(request: Request): string {
  // Prefer the browser's Origin header (passed through proxy chain)
  const origin = request.headers.get('origin');
  if (origin) return origin;
  // Reconstruct from X-Forwarded-Proto + Host (set by reverse proxies)
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const host = request.headers.get('host');
  if (host && !host.startsWith('localhost') && !host.startsWith('127.')) {
    return `${proto}://${host}`;
  }
  // Last resort: parse from request URL
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

function getClientIP(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    '0.0.0.0';
}

function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Full CBOR decoder (based on github.com/Outblock/Passkey CborSimpleDecoder).
 * Decodes CBOR bytes into JS objects: numbers, Uint8Array, strings, arrays, maps.
 */
class CborReader {
  private view: DataView;
  private offset = 0;
  constructor(bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  private readUInt8() { const v = this.view.getUint8(this.offset); this.offset += 1; return v; }
  private readUInt16() { const v = this.view.getUint16(this.offset); this.offset += 2; return v; }
  private readUInt32() { const v = this.view.getUint32(this.offset); this.offset += 4; return v; }
  private readBytes(len: number) {
    const v = new Uint8Array(this.view.buffer, this.view.byteOffset + this.offset, len);
    this.offset += len;
    return v;
  }
  private readHeader(): { major: number; length: number } {
    const h = this.readUInt8();
    const major = (h >> 5) & 0x7;
    const info = h & 0x1f;
    let length = info;
    if (info === 24) length = this.readUInt8();
    else if (info === 25) length = this.readUInt16();
    else if (info === 26) length = this.readUInt32();
    return { major, length };
  }
  readObject(): unknown {
    const { major, length } = this.readHeader();
    switch (major) {
      case 0: return length;                              // positive int
      case 1: return -1 - length;                         // negative int
      case 2: return this.readBytes(length);              // byte string → Uint8Array
      case 3: return new TextDecoder().decode(this.readBytes(length)); // text string
      case 4: {                                           // array
        const arr: unknown[] = [];
        for (let i = 0; i < length; i++) arr.push(this.readObject());
        return arr;
      }
      case 5: {                                           // map
        const map: Record<number | string, unknown> = {};
        for (let i = 0; i < length; i++) {
          const key = this.readObject();
          map[key as number | string] = this.readObject();
        }
        return map;
      }
      default: throw new Error(`CBOR: unsupported major=${major}`);
    }
  }
}

/**
 * Extract P-256 x,y from COSE public key bytes → uncompressed SEC1 hex.
 * COSE EC2 key map: { 1: 2(EC), 3: -7(ES256), -1: 1(P-256), -2: x, -3: y }
 */
function decodeCoseP256Key(bytes: Uint8Array): { x: Uint8Array; y: Uint8Array } | null {
  try {
    const cose = new CborReader(bytes).readObject() as Record<number, unknown>;
    const x = cose[-2];
    const y = cose[-3];
    if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) return null;
    return { x, y };
  } catch {
    return null;
  }
}

/**
 * Convert COSE public key bytes to uncompressed SEC1 P-256 hex: "04" + hex(x) + hex(y)
 */
function coseToSec1Hex(coseBytes: Uint8Array): string | null {
  const key = decodeCoseP256Key(coseBytes);
  if (!key || key.x.length !== 32 || key.y.length !== 32) return null;
  return '04' + uint8ArrayToHex(key.x) + uint8ArrayToHex(key.y);
}

function generateWebAuthnUserId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return uint8ArrayToBase64Url(bytes);
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-client-info',
      },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
  const origin = getOrigin(req);
  const clientIP = getClientIP(req);

  try {
    const { endpoint, data }: RequestBody = await req.json();
    const { rpId, rpName, email, walletName, challengeId, response: authResponse } = data as Record<string, unknown>;

    let result: ApiResponse;
    const getAuthenticatedUser = async () => {
      const authHeader = req.headers.get('Authorization');
      const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader || '' } },
      });
      const { data: { user } } = await userClient.auth.getUser();
      return user;
    };

    switch (endpoint) {
      case '/register/start': {
        const user = await getAuthenticatedUser();
        if (!user) {
          result = error('UNAUTHORIZED', 'Sign in first, then bind a passkey');
          break;
        }

        const ipBlocked = await supabaseAdmin.rpc('check_passkey_rate_limit', {
          p_identifier: clientIP, p_identifier_type: 'ip', p_endpoint: endpoint, p_max_attempts: RATE_LIMITS.ip.maxAttempts
        });
        if (ipBlocked.error || ipBlocked.data) {
          result = error('RATE_LIMITED', 'Too many requests');
          break;
        }

        const userEmail = user.email || `user-${user.id}@flowindex.io`;
        // Display name shown in browser passkey dialog
        const displayName = (walletName as string) || userEmail;

        const webauthnUserId = generateWebAuthnUserId();
        const { data: existingUserCreds } = await supabaseAdmin.from('passkey_credentials')
          .select('id').eq('user_id', user.id).limit(50);

        const excludeCredentials = existingUserCreds?.map((c: { id: string }) => ({
          id: c.id, type: 'public-key' as const
        })) || [];

        const options = await generateRegistrationOptions({
          rpName: rpName as string,
          rpID: rpId as string,
          userName: displayName,
          userDisplayName: displayName,
          userID: new TextEncoder().encode(webauthnUserId),
          attestationType: 'none',
          excludeCredentials,
          authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
          supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
        });

        const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000);
        const { data: challenge } = await supabaseAdmin.from('passkey_challenges').insert({
          challenge: options.challenge, user_id: user.id, email: userEmail, type: 'registration', expires_at: expiresAt.toISOString(), webauthn_user_id: webauthnUserId
        }).select().single();

        await supabaseAdmin.rpc('log_passkey_audit_event', {
          p_event_type: 'registration_started', p_user_id: user.id, p_email: userEmail, p_ip_address: clientIP, p_origin: origin
        });

        result = success({ options, challengeId: challenge.id });
        break;
      }

      case '/register/finish': {
        const user = await getAuthenticatedUser();
        if (!user) {
          result = error('UNAUTHORIZED', 'Sign in first, then bind a passkey');
          break;
        }

        const { data: challenge } = await supabaseAdmin.from('passkey_challenges')
          .select('*').eq('id', challengeId).eq('type', 'registration').eq('user_id', user.id).single();

        await supabaseAdmin.from('passkey_challenges').delete().eq('id', challengeId);

        if (!challenge) {
          result = error('CHALLENGE_MISMATCH', 'Invalid or expired challenge');
          break;
        }

        if (new Date(challenge.expires_at) < new Date()) {
          await supabaseAdmin.rpc('log_passkey_audit_event', {
            p_event_type: 'challenge_expired', p_email: challenge.email, p_ip_address: clientIP
          });
          result = error('CHALLENGE_EXPIRED', 'Challenge has expired');
          break;
        }

        try {
          // Allow requests from any *.flowindex.io subdomain
          const allowedOrigins = [
            origin,
            'https://flowindex.io',
            'https://run.flowindex.io',
            'https://ai.flowindex.io',
          ];
          console.log('[passkey-auth] register/finish origin:', origin, 'rpId:', rpId);
          const verification = await verifyRegistrationResponse({
            response: authResponse as Parameters<typeof verifyRegistrationResponse>[0]['response'],
            expectedChallenge: challenge.challenge,
            expectedOrigin: allowedOrigins,
            expectedRPID: rpId as string,
            supportedAlgorithmIDs: SUPPORTED_ALGORITHMS,
            requireUserVerification: false,
          });

          if (!verification.verified || !verification.registrationInfo) {
            throw new Error('Verification failed');
          }

          const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
          const publicKeyBytes = credential.publicKey;
          const publicKeyHex = '\\x' + uint8ArrayToHex(publicKeyBytes);
          const sec1Hex = coseToSec1Hex(publicKeyBytes);
          console.log('[passkey-auth] COSE key hex:', uint8ArrayToHex(publicKeyBytes), 'SEC1:', sec1Hex ? sec1Hex.slice(0, 20) + '...' : 'NULL');

          const authenticatorName = (data as { authenticatorName?: string }).authenticatorName || null;

          const { data: insertedCred, error: insertError } = await supabaseAdmin.from('passkey_credentials').insert({
            id: credential.id,
            user_id: user.id,
            webauthn_user_id: challenge.webauthn_user_id,
            public_key: publicKeyHex,
            public_key_sec1_hex: sec1Hex,
            counter: credential.counter,
            device_type: credentialDeviceType,
            backed_up: credentialBackedUp,
            transports: credential.transports,
            authenticator_name: authenticatorName,
          }).select().single();
          if (insertError) {
            console.error('[passkey-auth] credential INSERT failed:', insertError.message, insertError.details, insertError.hint);
            throw new Error(`Credential insert failed: ${insertError.message}`);
          }

          await supabaseAdmin.rpc('log_passkey_audit_event', {
            p_event_type: 'registration_completed', p_user_id: user.id, p_credential_id: credential.id, p_email: challenge.email, p_ip_address: clientIP
          });

          result = success({
            verified: true,
            publicKeySec1Hex: sec1Hex,
            passkey: insertedCred ? {
              id: insertedCred.id,
              authenticatorName: insertedCred.authenticator_name,
              deviceType: insertedCred.device_type,
              backedUp: insertedCred.backed_up,
              createdAt: insertedCred.created_at,
              lastUsedAt: insertedCred.last_used_at,
            } : null
          });
        } catch (e) {
          console.error('[passkey-auth] register/finish error:', e);
          await supabaseAdmin.rpc('log_passkey_audit_event', {
            p_event_type: 'registration_failed', p_email: challenge.email, p_ip_address: clientIP, p_error_message: e instanceof Error ? e.message : 'Unknown'
          });
          result = error('VERIFICATION_FAILED', e instanceof Error ? e.message : 'Registration verification failed');
        }
        break;
      }

      case '/login/start': {
        console.log('[passkey-auth] login/start email:', email || '(none/discoverable)', 'rpId:', rpId);
        const ipBlocked = await supabaseAdmin.rpc('check_passkey_rate_limit', {
          p_identifier: clientIP, p_identifier_type: 'ip', p_endpoint: endpoint, p_max_attempts: RATE_LIMITS.ip.maxAttempts
        });
        if (ipBlocked.error || ipBlocked.data) {
          console.log('[passkey-auth] login/start RATE_LIMITED ip:', clientIP);
          result = error('RATE_LIMITED', 'Too many requests');
          break;
        }

        let allowCredentials: { id: string; type: 'public-key' }[] | undefined;
        let userEmail = email as string | undefined;

        if (email) {
          const { data: users } = await supabaseAdmin.auth.admin.listUsers();
          const user = users?.users?.find((u) => u.email === email);
          if (!user) {
            result = error('CREDENTIAL_NOT_FOUND', 'No passkey found for this email');
            break;
          }

          const { data: credentials } = await supabaseAdmin.from('passkey_credentials')
            .select('id, transports').eq('user_id', user.id);

          if (!credentials?.length) {
            result = error('CREDENTIAL_NOT_FOUND', 'No passkey found for this email');
            break;
          }

          allowCredentials = credentials.map((c) => ({ id: c.id, type: 'public-key' as const }));
        }

        const options = await generateAuthenticationOptions({
          rpID: rpId as string,
          userVerification: 'preferred',
          allowCredentials,
        });

        const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MINUTES * 60 * 1000);
        const { data: challenge } = await supabaseAdmin.from('passkey_challenges').insert({
          challenge: options.challenge, email: userEmail, type: 'authentication', expires_at: expiresAt.toISOString()
        }).select().single();

        console.log('[passkey-auth] login/start challengeId:', challenge?.id, 'allowCredentials:', allowCredentials?.length ?? 'none(discoverable)');

        await supabaseAdmin.rpc('log_passkey_audit_event', {
          p_event_type: 'authentication_started', p_email: userEmail, p_ip_address: clientIP
        });

        result = success({ options, challengeId: challenge.id });
        break;
      }

      case '/login/finish': {
        console.log('[passkey-auth] login/finish challengeId:', challengeId, 'origin:', origin);
        const { data: challenge } = await supabaseAdmin.from('passkey_challenges')
          .select('*').eq('id', challengeId).eq('type', 'authentication').single();

        await supabaseAdmin.from('passkey_challenges').delete().eq('id', challengeId);

        if (!challenge) {
          console.error('[passkey-auth] login/finish CHALLENGE_MISMATCH id:', challengeId);
          result = error('CHALLENGE_MISMATCH', 'Invalid or expired challenge');
          break;
        }

        if (new Date(challenge.expires_at) < new Date()) {
          console.error('[passkey-auth] login/finish CHALLENGE_EXPIRED');
          result = error('CHALLENGE_EXPIRED', 'Challenge has expired');
          break;
        }

        const credentialId = (authResponse as { id: string }).id;
        const { data: credential, error: credError } = await supabaseAdmin.from('passkey_credentials')
          .select('*').eq('id', credentialId).single();

        console.log('[passkey-auth] login/finish credentialId:', credentialId, 'found:', !!credential, 'error:', credError?.message);
        if (credError || !credential) {
          result = error('CREDENTIAL_NOT_FOUND', 'Credential not found');
          break;
        }

        try {
          const publicKeyHex = credential.public_key.replace('\\x', '');
          const publicKeyBytes = hexToUint8Array(publicKeyHex);

          const allowedOrigins = [
            origin,
            'https://flowindex.io',
            'https://run.flowindex.io',
            'https://ai.flowindex.io',
          ];
          const verification = await verifyAuthenticationResponse({
            response: authResponse as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
            expectedChallenge: challenge.challenge,
            expectedOrigin: allowedOrigins,
            expectedRPID: rpId as string,
            requireUserVerification: false,
            credential: {
              id: credential.id,
              publicKey: publicKeyBytes,
              counter: credential.counter,
            },
          });

          if (!verification.verified) {
            throw new Error('Verification failed');
          }

          await supabaseAdmin.from('passkey_credentials').update({
            counter: verification.authenticationInfo.newCounter, last_used_at: new Date().toISOString()
          }).eq('id', credentialId);

          const { data: userData } = await supabaseAdmin.auth.admin.getUserById(credential.user_id);
          const userEmail = userData?.user?.email || challenge.email;
          const { data: linkData } = await supabaseAdmin.auth.admin.generateLink({
            type: 'magiclink', email: userEmail
          });

          await supabaseAdmin.rpc('log_passkey_audit_event', {
            p_event_type: 'authentication_completed', p_user_id: credential.user_id, p_credential_id: credentialId, p_ip_address: clientIP
          });

          console.log('[passkey-auth] login/finish SUCCESS user:', credential.user_id);
          result = success({ verified: true, tokenHash: linkData.properties?.hashed_token, email: userEmail });
        } catch (e) {
          console.error('[passkey-auth] login/finish VERIFY_FAILED:', e instanceof Error ? e.message : e);
          await supabaseAdmin.rpc('log_passkey_audit_event', {
            p_event_type: 'authentication_failed', p_credential_id: credentialId, p_ip_address: clientIP, p_error_message: e instanceof Error ? e.message : 'Unknown'
          });
          result = error('VERIFICATION_FAILED', 'Authentication verification failed');
        }
        break;
      }

      case '/passkeys/list': {
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
          .select('*').eq('user_id', user.id).order('created_at', { ascending: false });

        result = success({
          passkeys: credentials?.map((c) => ({
            id: c.id, authenticatorName: c.authenticator_name, deviceType: c.device_type,
            backedUp: c.backed_up, createdAt: c.created_at, lastUsedAt: c.last_used_at
          })) || []
        });
        break;
      }

      case '/passkeys/remove': {
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

        const { credentialId: removeCredId } = data as { credentialId: string };
        await supabaseAdmin.from('passkey_credentials').delete().eq('id', removeCredId).eq('user_id', user.id);

        await supabaseAdmin.rpc('log_passkey_audit_event', {
          p_event_type: 'passkey_removed', p_user_id: user.id, p_credential_id: removeCredId, p_ip_address: clientIP
        });

        result = success({ removed: true });
        break;
      }

      case '/passkeys/update': {
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

        const { credentialId: updateCredId, authenticatorName } = data as { credentialId: string; authenticatorName: string };
        const { data: updated } = await supabaseAdmin.from('passkey_credentials')
          .update({ authenticator_name: authenticatorName }).eq('id', updateCredId).eq('user_id', user.id).select().single();

        if (!updated) {
          result = error('CREDENTIAL_NOT_FOUND', 'Passkey not found');
          break;
        }

        await supabaseAdmin.rpc('log_passkey_audit_event', {
          p_event_type: 'passkey_updated', p_user_id: user.id, p_credential_id: updateCredId, p_ip_address: clientIP
        });

        result = success({ passkey: updated });
        break;
      }

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
          result = success({ address: cred.flow_address });
          break;
        }

        // Use the same Lilico/FRW OpenAPI as flow-keys edge function
        const lilicoBase = 'https://openapi.lilico.app';
        const lilicoEndpoint = `${lilicoBase}/v1/address`;
        const trimmedKey = cred.public_key_sec1_hex.startsWith('04')
          ? cred.public_key_sec1_hex.slice(2)
          : cred.public_key_sec1_hex;

        const accountRes = await fetch(lilicoEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: Deno.env.get('LILICO_API_KEY') || '',
          },
          body: JSON.stringify({
            publicKey: trimmedKey,
            signatureAlgorithm: 'ECDSA_P256',
            hashAlgorithm: 'SHA2_256',
            weight: 1000,
          }),
        });

        if (!accountRes.ok) {
          const errBody = await accountRes.text();
          console.error('[passkey-auth] Lilico API error:', accountRes.status, errBody);
          result = error('PROVISION_FAILED', `Account creation failed (${accountRes.status})`);
          break;
        }

        const accountJson = await accountRes.json();
        const txId = accountJson.txId || accountJson.data?.txId;
        if (!txId) {
          console.error('[passkey-auth] Lilico API: no txId:', JSON.stringify(accountJson));
          result = error('PROVISION_FAILED', 'No txId in account creation response');
          break;
        }

        // Poll for sealed transaction to extract new account address
        const accessNode = 'https://rest-mainnet.onflow.org';
        let flowAddress: string | null = null;
        for (let i = 0; i < 30; i++) {
          await new Promise((r) => setTimeout(r, 2000));
          const txRes = await fetch(`${accessNode}/v1/transaction_results/${txId}`);
          if (!txRes.ok) continue;
          const txResult = await txRes.json();
          if (txResult.status !== 'SEALED') continue;
          if (txResult.error_message) {
            result = error('PROVISION_FAILED', `Account tx failed: ${txResult.error_message}`);
            break;
          }
          for (const event of txResult.events || []) {
            if (event.type === 'flow.AccountCreated') {
              try {
                const payload = JSON.parse(atob(event.payload));
                const addr = payload?.value?.fields?.find(
                  (f: { name: string }) => f.name === 'address',
                )?.value?.value;
                if (addr) { flowAddress = addr.replace(/^0x/, ''); break; }
              } catch { /* try next event */ }
            }
          }
          if (flowAddress) break;
        }

        if (!flowAddress) {
          if (!result || result.success !== false) {
            result = error('PROVISION_FAILED', 'Account creation timed out');
          }
          break;
        }

        await supabaseAdmin.from('passkey_credentials')
          .update({ flow_address: flowAddress })
          .eq('id', provCredId);

        console.log('[passkey-auth] Account provisioned:', flowAddress, 'for credential:', provCredId);
        result = success({ address: flowAddress });
        break;
      }

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

      default:
        result = error('NOT_FOUND', `Unknown endpoint: ${endpoint}`);
    }

    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  } catch (e) {
    console.error('[passkey-auth] Unhandled error:', e);
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify(error('UNKNOWN_ERROR', msg)), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
}, { port: Number(Deno.env.get('PORT')) || 8000 });
