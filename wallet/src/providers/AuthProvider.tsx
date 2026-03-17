import { AuthProvider as BaseAuthProvider } from '@flowindex/auth-ui';
import type { AuthConfig } from '@flowindex/auth-ui';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321';
const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';

const config: AuthConfig = {
  gotrueUrl: supabaseUrl + '/auth/v1',
  passkeyAuthUrl: supabaseUrl + '/functions/v1/passkey-auth',
  rpId: import.meta.env.VITE_RP_ID || 'flowindex.io',
  rpName: 'FlowIndex Wallet',
  // On localhost: use 'localhost' domain without secure flag (handled by cookie.ts)
  cookieDomain: isLocalhost ? 'localhost' : undefined,
};

export function WalletAuthProvider({ children }: { children: React.ReactNode }) {
  return <BaseAuthProvider config={config}>{children}</BaseAuthProvider>;
}
