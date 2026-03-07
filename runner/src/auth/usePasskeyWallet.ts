/**
 * Passkey Wallet hook — WebAuthn-based Flow wallet using P256 passkeys.
 * Handles registration, login, account provisioning, and transaction signing.
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from './AuthContext';
import {
  sha256, hexToBytes, bytesToHex, derToP256Raw, buildExtensionData,
} from './passkeyEncode';

class PasskeyError extends Error {
  code?: string;

  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

function asPasskeyError(err: unknown, fallbackMessage: string): PasskeyError {
  if (err instanceof PasskeyError) return err;
  if (err instanceof DOMException) {
    if (err.name === 'AbortError') return new PasskeyError('Passkey request aborted', 'REQUEST_ABORTED');
    if (err.name === 'NotAllowedError') return new PasskeyError('Passkey request was cancelled', 'USER_CANCELLED');
    if (err.name === 'InvalidStateError') return new PasskeyError('Passkey already exists on this authenticator', 'CREDENTIAL_ALREADY_EXISTS');
    if (err.name === 'NotSupportedError') return new PasskeyError('Passkey is not supported in this browser', 'NOT_SUPPORTED');
  }
  if (err instanceof Error) return new PasskeyError(err.message);
  return new PasskeyError(fallbackMessage, 'UNKNOWN_ERROR');
}

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
  signature: string;
  extensionData: string;
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
  if (!res.ok || !json.success) {
    throw new PasskeyError(
      json?.error?.message || `Passkey API error (${res.status})`,
      json?.error?.code || `HTTP_${res.status}`
    );
  }
  return json.data;
}

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
  const [passkeys, setPasskeys] = useState<Array<{ id: string; authenticatorName?: string }>>([]);
  const [selectedAccount, setSelectedAccount] = useState<PasskeyAccount | null>(null);
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const refreshPasskeyState = useCallback(async (tokenOverride?: string | null) => {
    const token = tokenOverride ?? accessToken;
    if (!token) {
      setPasskeys([]);
      setAccounts([]);
      setSelectedAccount(null);
      return { passkeys: [], accounts: [] as PasskeyAccount[] };
    }

    const [passkeyData, accountData] = await Promise.all([
      passkeyApi('/passkeys/list', {}, token),
      passkeyApi('/wallet/accounts', {}, token),
    ]);

    const passkeyList = Array.isArray(passkeyData.passkeys) ? passkeyData.passkeys : [];
    const accountList: PasskeyAccount[] = Array.isArray(accountData.accounts) ? accountData.accounts : [];

    setPasskeys(passkeyList);
    setAccounts(accountList);
    setSelectedAccount((prev) => {
      if (!accountList.length) return null;
      if (prev) {
        const matched = accountList.find((a) => a.credentialId === prev.credentialId);
        if (matched) return matched;
      }
      return accountList[0];
    });

    return { passkeys: passkeyList, accounts: accountList };
  }, [accessToken]);

  // Load passkey state when user is authenticated
  useEffect(() => {
    if (!user || !accessToken || loadedRef.current) return;
    loadedRef.current = true;
    refreshPasskeyState(accessToken).catch(() => {
      setPasskeys([]);
      setAccounts([]);
      setSelectedAccount(null);
    });
  }, [user, accessToken, refreshPasskeyState]);

  // Reset on logout
  useEffect(() => {
    if (!user) {
      setPasskeys([]);
      setAccounts([]);
      setSelectedAccount(null);
      loadedRef.current = false;
    }
  }, [user]);

  const register = useCallback(async (walletName?: string) => {
    if (!user || !accessToken) {
      throw new PasskeyError('Please sign in first, then bind a passkey', 'UNAUTHORIZED');
    }

    setLoading(true);
    try {
      // 1. Start registration for current authenticated user
      const startData = await passkeyApi('/register/start', {
        rpId: RP_ID,
        rpName: RP_NAME,
        walletName: walletName || user.email || 'FlowIndex Wallet',
      }, accessToken);

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

      let credential: PublicKeyCredential;
      try {
        credential = await navigator.credentials.create({
          publicKey: publicKeyOptions,
        }) as PublicKeyCredential;
      } catch (err) {
        throw asPasskeyError(err, 'Passkey creation failed');
      }

      if (!credential) throw new PasskeyError('Passkey creation cancelled', 'USER_CANCELLED');

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
      }, accessToken);

      const { publicKeySec1Hex } = finishData;

      // 4. Provision Flow wallet immediately so passkey is self-custody + usable signer.
      const provisionData = await passkeyApi('/wallet/provision', {
        credentialId: credential.id,
      }, accessToken);

      const newAccount: PasskeyAccount = {
        credentialId: credential.id,
        flowAddress: provisionData.address || '',
        publicKeySec1Hex: publicKeySec1Hex || '',
      };

      setAccounts(prev => {
        const next = prev.filter((a) => a.credentialId !== credential.id);
        next.unshift(newAccount);
        return next;
      });
      setSelectedAccount(newAccount);
      await refreshPasskeyState(accessToken).catch(() => {});
      return newAccount;
    } catch (err) {
      throw asPasskeyError(err, 'Passkey registration failed');
    } finally {
      setLoading(false);
    }
  }, [user, accessToken, refreshPasskeyState]);

  const loginOnly = useCallback(async (opts?: { signal?: AbortSignal; mediation?: CredentialMediationRequirement }) => {
    console.log('[passkey] loginOnly start, mediation:', opts?.mediation || 'modal');
    // 1. Start authentication
    const startData = await passkeyApi('/login/start', {
      rpId: RP_ID,
    });
    console.log('[passkey] loginOnly got challenge, allowCredentials:', startData.options?.allowCredentials?.length ?? 'none');

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

    const credentialRequest: CredentialRequestOptions = {
      publicKey: publicKeyOptions,
      ...(opts?.signal && { signal: opts.signal }),
      ...(opts?.mediation && { mediation: opts.mediation }),
    };

    console.log('[passkey] calling navigator.credentials.get, mediation:', opts?.mediation || 'modal');
    let assertion: PublicKeyCredential;
    try {
      assertion = await navigator.credentials.get(credentialRequest) as PublicKeyCredential;
    } catch (err) {
      throw asPasskeyError(err, 'Passkey authentication failed');
    }

    if (!assertion) throw new PasskeyError('Passkey authentication cancelled', 'USER_CANCELLED');
    console.log('[passkey] got assertion, credentialId:', assertion.id);

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
      if (!verifyRes.ok) {
        throw new PasskeyError('Failed to create authenticated session', 'SESSION_EXCHANGE_FAILED');
      }
      const tokenData = await verifyRes.json();
      applyTokenData(tokenData);

      // 5. Load wallet accounts
      await refreshPasskeyState(tokenData.access_token);
    }
  }, [applyTokenData, refreshPasskeyState]);

  const login = useCallback(async () => {
    setLoading(true);
    try {
      await loginOnly();
    } catch (err) {
      throw asPasskeyError(err, 'Passkey authentication failed');
    } finally {
      setLoading(false);
    }
  }, [loginOnly]);

  /** Start conditional UI login — browser shows passkey in autofill.
   *  Returns an AbortController so callers can cancel when the modal closes. */
  const startConditionalLogin = useCallback((onSuccess?: () => void): AbortController => {
    console.log('[passkey] startConditionalLogin');
    const controller = new AbortController();
    loginOnly({ signal: controller.signal, mediation: 'conditional' as CredentialMediationRequirement })
      .then(() => {
        console.log('[passkey] conditional login SUCCESS');
        onSuccess?.();
      })
      .catch((err) => {
        console.log('[passkey] conditional login ended:', err instanceof Error ? err.message : err);
      });
    return controller;
  }, [loginOnly]);

  const sign = useCallback(async (messageHex: string): Promise<PasskeySignResult> => {
    if (!selectedAccount) throw new Error('No passkey account selected');

    // SHA-256 hash of the message (FLIP-264: hash with account key's hashAlgo)
    const challenge = await sha256(hexToBytes(messageHex));

    // WebAuthn assertion with the challenge
    const challengeBuffer = challenge.buffer instanceof ArrayBuffer
      ? challenge.buffer.slice(challenge.byteOffset, challenge.byteOffset + challenge.byteLength)
      : new Uint8Array(challenge).buffer;

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challengeBuffer,
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

  const provisionAccount = useCallback(async (credentialId?: string) => {
    const credId = credentialId || selectedAccount?.credentialId;
    if (!credId) throw new Error('No credential to provision');

    setLoading(true);
    try {
      const data = await passkeyApi('/wallet/provision', { credentialId: credId }, accessToken);
      const address = data.address;

      // Update the account in state
      setAccounts(prev => prev.map(a =>
        a.credentialId === credId ? { ...a, flowAddress: address } : a
      ));
      setSelectedAccount(prev =>
        prev?.credentialId === credId ? { ...prev, flowAddress: address } : prev
      );

      return address as string;
    } finally {
      setLoading(false);
    }
  }, [selectedAccount, accessToken]);

  const selectAccount = useCallback((credentialId: string) => {
    const acct = accounts.find(a => a.credentialId === credentialId);
    if (acct) setSelectedAccount(acct);
  }, [accounts]);

  const hasPasskeySupport = typeof window !== 'undefined' && !!window.PublicKeyCredential;
  const hasBoundPasskey = passkeys.length > 0;

  return {
    register,
    login,
    startConditionalLogin,
    sign,
    provisionAccount,
    accounts,
    passkeys,
    hasBoundPasskey,
    refreshPasskeyState,
    selectedAccount,
    selectAccount,
    loading,
    hasPasskeySupport,
  };
}
