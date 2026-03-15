import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { configureFcl } from './flow/fclConfig';

const App = lazy(() => import('./App'));
const DeployDashboard = lazy(() => import('./deploy/DeployDashboard'));
const InteractPage = lazy(() => import('./interact/InteractPage'));

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center h-screen bg-zinc-900">
      <div className="w-5 h-5 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
    </div>
  );
}

export default function Router() {
  // Configure FCL with mainnet defaults so the deploy page wallet works
  // (Editor reconfigures FCL when its own network selector changes)
  useEffect(() => {
    configureFcl('mainnet');
  }, []);

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route path="/editor" element={<App />} />
          <Route path="/deploy/*" element={<DeployDashboard />} />
          <Route path="/interact" element={<InteractPage />} />
          <Route path="*" element={<Navigate to="/editor" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
