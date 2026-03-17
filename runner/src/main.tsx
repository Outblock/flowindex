import React from 'react';
import ReactDOM from 'react-dom/client';
import { WagmiProvider } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import Router from './Router';
import { AuthProvider } from './auth/AuthContext';
import { wagmiConfig } from './flow/wagmiConfig';
import './index.css';

const FRONTEND_ORIGIN = import.meta.env.VITE_FRONTEND_ORIGIN || 'https://flowindex.io';

const queryClient = new QueryClient();

// Remove the static HTML loading indicator
document.getElementById('loading')?.remove();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <WagmiProvider config={wagmiConfig}>
        <RainbowKitProvider theme={darkTheme({ accentColor: '#8b5cf6' })}>
          <AuthProvider config={{
            gotrueUrl: import.meta.env.VITE_GOTRUE_URL || 'http://localhost:9999',
            passkeyAuthUrl: `${import.meta.env.VITE_SUPABASE_URL || ''}/functions/v1/passkey-auth`,
            cookieDomain: '.flowindex.io',
            enableLogoutDetection: true,
            rpId: 'flowindex.io',
            rpName: 'FlowIndex',
            callbackPath: `${FRONTEND_ORIGIN}/developer/callback`,
          }}>
            <Router />
          </AuthProvider>
        </RainbowKitProvider>
      </WagmiProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
