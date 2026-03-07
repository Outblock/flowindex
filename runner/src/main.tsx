import React from 'react';
import ReactDOM from 'react-dom/client';
import Router from './Router';
import { AuthProvider } from './auth/AuthContext';
import './index.css';

const FRONTEND_ORIGIN = import.meta.env.VITE_FRONTEND_ORIGIN || 'https://flowindex.io';

// Remove the static HTML loading indicator
document.getElementById('loading')?.remove();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
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
  </React.StrictMode>
);
