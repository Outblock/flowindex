import { useAuth } from './useAuth';
import type { PasskeyState } from './types';

export function usePasskeyAuth(): PasskeyState {
  const { passkey } = useAuth();
  if (!passkey) throw new Error('Passkey auth not configured. Set passkeyAuthUrl in AuthProvider config.');
  return passkey;
}
