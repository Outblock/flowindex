import { createPasskeyCredential, getPasskeyAssertion, base64UrlToBytes, bytesToBase64Url } from '@flowindex/flow-passkey';
import type { PasskeyAccount, PasskeyInfo, ProvisionResult, PasskeyClientConfig } from './types';

class PasskeyError extends Error {
  code?: string;
  constructor(message: string, code?: string) {
    super(message);
    this.name = 'PasskeyError';
    this.code = code;
  }
}

/**
 * Create a passkey auth client that wraps our passkey-auth edge function.
 *
 * All WebAuthn operations use `@flowindex/flow-passkey` — no direct
 * `navigator.credentials` calls in this module.
 */
export function createPasskeyAuthClient(config: PasskeyClientConfig) {
  const { passkeyAuthUrl, rpId, rpName } = config;

  // Internal helper — calls our passkey-auth edge function
  async function passkeyApi(endpoint: string, data: Record<string, unknown>, accessToken?: string | null) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const res = await fetch(passkeyAuthUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ endpoint, data }),
    });

    const json = await res.json();
    if (!res.ok || !json.success) {
      throw new PasskeyError(
        json?.error?.message || `Passkey API error (${res.status})`,
        json?.error?.code || `HTTP_${res.status}`,
      );
    }
    return json.data;
  }

  return {
    /**
     * Register a new passkey credential for the authenticated user.
     *
     * 1. Calls /register/start to get a WebAuthn challenge
     * 2. Uses flow-passkey's createPasskeyCredential for WebAuthn ceremony
     * 3. Calls /register/finish with the attestation response
     *
     * Returns the credential ID and public key in SEC1 hex format.
     */
    async register(accessToken: string, walletName?: string): Promise<{ credentialId: string; publicKeySec1Hex: string }> {
      // 1. Start registration — get challenge + options from server
      const startData = await passkeyApi('/register/start', {
        rpId,
        rpName,
        walletName: walletName || 'FlowIndex Wallet',
      }, accessToken);

      const { options, challengeId } = startData;

      // 2. Create passkey credential via WebAuthn
      const credential = await createPasskeyCredential({
        rpId,
        rpName,
        challenge: base64UrlToBytes(options.challenge),
        userId: base64UrlToBytes(options.user.id),
        userName: options.user.name,
        excludeCredentials: options.excludeCredentials?.map((c: { id: string; type: 'public-key' }) => ({
          id: c.id,
          type: c.type,
        })),
      });

      // 3. Finish registration — send attestation to server
      const attestation = credential.attestationResponse;
      const finishData = await passkeyApi('/register/finish', {
        rpId,
        challengeId,
        response: {
          id: credential.credentialId,
          rawId: bytesToBase64Url(credential.rawId),
          response: {
            attestationObject: bytesToBase64Url(new Uint8Array(attestation.attestationObject)),
            clientDataJSON: bytesToBase64Url(new Uint8Array(attestation.clientDataJSON)),
          },
          type: credential.type,
          clientExtensionResults: {},
          authenticatorAttachment: undefined,
        },
      }, accessToken);

      return {
        credentialId: credential.credentialId,
        publicKeySec1Hex: finishData.publicKeySec1Hex as string,
      };
    },

    /**
     * Authenticate with a passkey (login).
     *
     * 1. Calls /login/start to get a WebAuthn challenge
     * 2. Uses flow-passkey's getPasskeyAssertion for WebAuthn ceremony
     * 3. Calls /login/finish with the assertion response
     *
     * Returns the tokenHash (for GoTrue exchange) and email.
     */
    async login(options?: { mediation?: CredentialMediationRequirement; signal?: AbortSignal }): Promise<{ tokenHash: string; email: string }> {
      // 1. Start authentication — get challenge from server
      const startData = await passkeyApi('/login/start', { rpId });

      const { options: serverOptions, challengeId } = startData;

      // 2. Get passkey assertion via WebAuthn
      const assertion = await getPasskeyAssertion({
        rpId,
        challenge: base64UrlToBytes(serverOptions.challenge),
        allowCredentials: serverOptions.allowCredentials?.map((c: { id: string; type: 'public-key' }) => ({
          id: c.id,
          type: c.type,
        })),
        mediation: options?.mediation,
        signal: options?.signal,
      });

      // 3. Finish authentication — send assertion to server
      const finishData = await passkeyApi('/login/finish', {
        rpId,
        challengeId,
        response: {
          id: assertion.credentialId,
          rawId: bytesToBase64Url(assertion.rawId),
          response: {
            authenticatorData: bytesToBase64Url(assertion.authenticatorData),
            clientDataJSON: bytesToBase64Url(assertion.clientDataJSON),
            signature: bytesToBase64Url(assertion.signature),
            userHandle: undefined,
          },
          type: 'public-key',
          clientExtensionResults: {},
          authenticatorAttachment: undefined,
        },
      });

      return {
        tokenHash: finishData.tokenHash as string,
        email: finishData.email as string,
      };
    },

    /**
     * Start provisioning Flow accounts (mainnet + testnet) for a credential.
     */
    async provisionAccounts(accessToken: string, credentialId: string): Promise<ProvisionResult> {
      return passkeyApi('/wallet/provision', { credentialId }, accessToken);
    },

    /**
     * Poll the Flow REST API for a sealed transaction and extract the
     * flow.AccountCreated address from its events.
     */
    async pollProvisionTx(txId: string, network: 'mainnet' | 'testnet'): Promise<string> {
      const accessNode = network === 'testnet'
        ? 'https://rest-testnet.onflow.org'
        : 'https://rest-mainnet.onflow.org';

      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const res = await fetch(`${accessNode}/v1/transaction_results/${txId}`);
          if (!res.ok) continue;
          const txResult = await res.json();
          if (txResult.status?.toLowerCase() !== 'sealed') continue;
          if (txResult.error_message) throw new Error(`Tx failed: ${txResult.error_message}`);
          for (const event of txResult.events || []) {
            if (event.type === 'flow.AccountCreated') {
              try {
                const payload = JSON.parse(atob(event.payload));
                const addr = payload?.value?.fields?.find(
                  (f: { name: string }) => f.name === 'address',
                )?.value?.value;
                if (addr) return (addr as string).replace(/^0x/, '');
              } catch { /* try next event */ }
            }
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith('Tx failed:')) throw e;
        }
      }
      throw new Error('Polling timed out');
    },

    /**
     * Save a provisioned address back to the server DB.
     */
    async saveProvisionedAddress(accessToken: string, credentialId: string, network: string, address: string): Promise<void> {
      await passkeyApi('/wallet/provision-save', { credentialId, network, address }, accessToken);
    },

    /**
     * Save a computed EVM smart wallet address for a passkey credential.
     */
    async saveEvmAddress(accessToken: string, credentialId: string, evmAddress: string): Promise<void> {
      await passkeyApi('/wallet/save-evm-address', { credentialId, evmAddress }, accessToken);
    },

    /**
     * List all passkeys for the authenticated user.
     */
    async listPasskeys(accessToken: string): Promise<PasskeyInfo[]> {
      const data = await passkeyApi('/passkeys/list', {}, accessToken);
      return Array.isArray(data.passkeys) ? data.passkeys : [];
    },

    /**
     * List all wallet accounts (passkey-linked Flow addresses) for the authenticated user.
     */
    async listAccounts(accessToken: string): Promise<PasskeyAccount[]> {
      const data = await passkeyApi('/wallet/accounts', {}, accessToken);
      return Array.isArray(data.accounts) ? data.accounts : [];
    },

    /**
     * Remove a passkey by credential ID.
     */
    async removePasskey(accessToken: string, credentialId: string): Promise<void> {
      await passkeyApi('/passkeys/remove', { credentialId }, accessToken);
    },

    /**
     * Update a passkey's authenticator name.
     */
    async updatePasskey(accessToken: string, credentialId: string, authenticatorName: string): Promise<void> {
      await passkeyApi('/passkeys/update', { credentialId, authenticatorName }, accessToken);
    },
  };
}
