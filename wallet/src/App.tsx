import { Routes, Route } from 'react-router-dom';
import { WalletAuthProvider } from './providers/AuthProvider';
import { WalletProvider } from './providers/WalletProvider';
import Authn from './pages/Authn';

function Placeholder({ name }: { name: string }) {
  return <div className="flex items-center justify-center min-h-screen text-2xl font-mono text-nothing-green">{name}</div>;
}

export default function App() {
  return (
    <WalletAuthProvider>
      <WalletProvider>
        <Routes>
          <Route path="/" element={<Placeholder name="Dashboard" />} />
          <Route path="/authn" element={<Authn />} />
          <Route path="/authz" element={<Placeholder name="Authz" />} />
          <Route path="/sign-message" element={<Placeholder name="Sign Message" />} />
          <Route path="/send" element={<Placeholder name="Send" />} />
          <Route path="/nfts" element={<Placeholder name="NFTs" />} />
          <Route path="/activity" element={<Placeholder name="Activity" />} />
          <Route path="/settings" element={<Placeholder name="Settings" />} />
        </Routes>
      </WalletProvider>
    </WalletAuthProvider>
  );
}
