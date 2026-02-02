import { Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import BlockDetail from './pages/BlockDetail';
import TransactionDetail from './pages/TransactionDetail';
import AccountDetail from './pages/AccountDetail';
import { IndexingStatus } from './components/IndexingStatus';

function App() {
  return (
    <div className="bg-black min-h-screen text-zinc-300 font-mono antialiased selection:bg-nothing-green selection:text-black">
      <IndexingStatus />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/blocks/:height" element={<BlockDetail />} />
        <Route path="/transactions/:txId" element={<TransactionDetail />} />
        <Route path="/accounts/:address" element={<AccountDetail />} />
      </Routes>
    </div>
  );
}

export default App;
