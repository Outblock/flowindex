import { Outlet } from 'react-router-dom';
import { DesktopSidebar, MobileBottomNav } from '../components/Sidebar';

export default function WalletLayout() {
  return (
    <div className="min-h-screen bg-wallet-bg text-white">
      <DesktopSidebar />
      <MobileBottomNav />

      {/* Main content area */}
      <main className="md:pl-[72px] pb-20 md:pb-0 min-h-screen">
        <div className="max-w-2xl mx-auto px-4 py-6">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
