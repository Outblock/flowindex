import { Routes, Route } from 'react-router-dom';
import { WalletAuthProvider } from './providers/AuthProvider';
import { WalletProvider } from './providers/WalletProvider';
import WalletLayout from './layouts/WalletLayout';
import Authn from './pages/Authn';
import Authz from './pages/Authz';
import SignMessage from './pages/SignMessage';
import TestHost from './pages/TestHost';
import Dashboard from './pages/Dashboard';
import NFTs from './pages/NFTs';
import Activity from './pages/Activity';
import Settings from './pages/Settings';

function Placeholder({ name }: { name: string }) {
  return (
    <div className="flex items-center justify-center min-h-[60vh] text-2xl font-mono text-nothing-green">
      {name}
    </div>
  );
}

export default function App() {
  return (
    <WalletAuthProvider>
      <WalletProvider>
        <Routes>
          {/* Popup routes - no layout */}
          <Route path="/authn" element={<Authn />} />
          <Route path="/authz" element={<Authz />} />
          <Route path="/sign-message" element={<SignMessage />} />
          <Route path="/test" element={<TestHost />} />

          {/* Dashboard routes - with layout */}
          <Route element={<WalletLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/nfts" element={<NFTs />} />
            <Route path="/send" element={<Placeholder name="Send" />} />
            <Route path="/activity" element={<Activity />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
        </Routes>
      </WalletProvider>
    </WalletAuthProvider>
  );
}
