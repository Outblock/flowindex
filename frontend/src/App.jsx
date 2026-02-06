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
import { WebSocketProvider } from './components/WebSocketProvider';

function App() {
  return (
    <WebSocketProvider>
      <div className="bg-black min-h-screen text-zinc-300 font-mono antialiased selection:bg-nothing-green selection:text-black">
        <IndexingStatus />
        <Header />
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
        </Routes>
        <Footer />
      </div>
    </WebSocketProvider>
  );
}

export default App;
