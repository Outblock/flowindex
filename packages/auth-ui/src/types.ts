import type { AuthUser, PasskeyAccount, PasskeyInfo, ProvisionResult } from '@flowindex/auth-core';
import type { PasskeySignResult } from '@flowindex/flow-passkey';

export type OAuthProvider = 'github' | 'google';

export interface AuthConfig {
  gotrueUrl: string;
  passkeyAuthUrl?: string;
  cookieDomain?: string;
  enableLogoutDetection?: boolean;
  enableRoles?: boolean;
  rpId?: string;
  rpName?: string;
  /** Override the OAuth callback path or full URL. Default: `/developer/callback`.
   *  If starts with `http`, used as-is (cross-origin). Otherwise prepended with window.location.origin. */
  callbackPath?: string;
}

export interface PasskeyState {
  hasSupport: boolean;
  hasBoundPasskey: boolean;
  accounts: PasskeyAccount[];
  passkeys: PasskeyInfo[];
  selectedAccount: PasskeyAccount | null;
  loading: boolean;
  selectAccount(credentialId: string): void;
  register(walletName?: string): Promise<{ credentialId: string; publicKeySec1Hex: string }>;
  login(): Promise<void>;
  startConditionalLogin(onSuccess?: () => void): AbortController;
  sign(messageHex: string): Promise<PasskeySignResult>;
  getFlowAuthz(address: string, keyIndex: number): (account: any) => any;
  provisionAccounts(credentialId: string): Promise<ProvisionResult>;
  pollProvisionTx(txId: string, network: 'mainnet' | 'testnet'): Promise<string>;
  saveProvisionedAddress(credentialId: string, network: string, address: string): Promise<void>;
  saveEvmAddress(credentialId: string, evmAddress: string): Promise<void>;
  refreshState(): Promise<void>;
}

export interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  loading: boolean;

  signInWithProvider(provider: OAuthProvider, redirectTo?: string): void;
  sendMagicLink(email: string, redirectTo?: string): Promise<void>;
  verifyOtp(email: string, token: string): Promise<void>;
  signOut(): void;
  handleCallback(hash: string): void;
  applyTokenData(data: { access_token: string; refresh_token: string }): void;

  passkey?: PasskeyState;
}
