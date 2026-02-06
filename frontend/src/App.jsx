import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import BlockDetail from './pages/BlockDetail';
import TransactionDetail from './pages/TransactionDetail';
import AccountDetail from './pages/AccountDetail';
import Stats from './pages/Stats';
import ApiDocs from './pages/ApiDocs';
import { IndexingStatus } from './components/IndexingStatus';
import Header from './components/Header';
import Footer from './components/Footer';
import Sidebar from './components/Sidebar';
import { WebSocketProvider } from './components/WebSocketProvider';
import NotFound from './pages/NotFound';

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
          <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth focus:scroll-auto">
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
            <Footer />
          </main>
        </div>
      </div>
    </WebSocketProvider>
  );
}

export default App;
