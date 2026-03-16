export interface AuthUser {
  id: string;
  email: string;
  role?: string;
  roles?: string[];
  team?: string;
  teams?: string[];
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export interface TokenData {
  access_token: string;
  refresh_token: string;
}

export type OAuthProvider = 'github' | 'google';

export interface PasskeyAccount {
  credentialId: string;
  flowAddress?: string;
  evmAddress?: string;
  flowAddressTestnet?: string;
  publicKeySec1Hex: string;
  authenticatorName?: string;
}

export interface PasskeyInfo {
  id: string;
  authenticatorName?: string;
  deviceType?: string;
  backedUp?: boolean;
  createdAt?: string;
  lastUsedAt?: string;
}

export interface ProvisionResult {
  networks: Record<string, { txId?: string; address?: string; error?: string }>;
  publicKeySec1Hex: string;
}

export interface PasskeyClientConfig {
  passkeyAuthUrl: string;
  rpId: string;
  rpName: string;
}
