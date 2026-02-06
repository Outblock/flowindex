import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import Footer from './components/Footer';
import Sidebar from './components/Sidebar';
import { IndexingStatus } from './components/IndexingStatus';
import { WebSocketProvider } from './components/WebSocketProvider';

// Eager load core dashboard pages
import Home from './pages/Home';
import BlockDetail from './pages/BlockDetail';
import TransactionDetail from './pages/TransactionDetail';
import AccountDetail from './pages/AccountDetail';

// Lazy load heavy/less frequent pages
const Stats = lazy(() => import('./pages/Stats'));
const ApiDocs = lazy(() => import('./pages/ApiDocs'));
const NotFound = lazy(() => import('./pages/NotFound'));

function App() {
  return (
    <WebSocketProvider>
      <div className="bg-gray-50 dark:bg-black min-h-screen text-zinc-700 dark:text-zinc-300 font-mono antialiased selection:bg-nothing-green selection:text-black flex transition-colors duration-300">
        {/* Sidebar */}
        <Sidebar />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col h-screen overflow-hidden relative">
          <IndexingStatus />
          <Header />
          <main className="flex-1 flex flex-col overflow-y-auto overflow-x-hidden relative scroll-smooth focus:scroll-auto">
            <div className="flex-1">
              <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-nothing-green border-t-transparent rounded-full animate-spin"></div></div>}>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/blocks/:height" element={<BlockDetail />} />
                  <Route path="/transactions/:txId" element={<TransactionDetail />} />
                  <Route path="/accounts/:address" element={<AccountDetail />} />
                  <Route path="/stats" element={<Stats />} />
                  <Route
                    path="/api-docs"
                    element={<ApiDocs specUrl="/openapi/v1.json" />}
                  />
                  <Route
                    path="/api-docs/v1"
                    element={<ApiDocs specUrl="/openapi/v1.json" />}
                  />
                  <Route
                    path="/api-docs/v2"
                    element={<ApiDocs specUrl="/openapi/v2.json" />}
                  />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
            </div>
            <Footer />
          </main>
        </div>
      </div>
    </WebSocketProvider>
  );
}

export default App;
