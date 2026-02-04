import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Box, Search } from 'lucide-react';

function Header() {
  const [searchQuery, setSearchQuery] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e) => {
    e.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;

    if (/^\d+$/.test(query)) {
      navigate(`/blocks/${query}`);
    } else if (/^[a-fA-F0-9]{64}$/.test(query)) {
      navigate(`/transactions/${query}`);
    } else if (/^0x[a-fA-F0-9]{16}$/.test(query)) {
      navigate(`/accounts/${query}`);
    } else if (query.startsWith('0x')) {
      navigate(`/accounts/${query}`);
    } else {
      navigate(`/transactions/${query}`);
    }
  };

  return (
    <header className="sticky top-0 z-50 bg-nothing-dark/95 backdrop-blur-md border-b border-white/5 py-4">
      <div className="container mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="w-full md:w-auto flex items-center justify-between md:justify-start">
          <Link to="/" className="flex items-center space-x-2 group">
            <Box className="h-6 w-6 text-nothing-green group-hover:rotate-12 transition-transform" />
            <div className="flex flex-col">
              <span className="text-xl font-black tracking-tighter text-white uppercase italic leading-none">
                Flow<span className="text-nothing-green">Scan</span>
              </span>
            </div>
          </Link>
        </div>

        <form
          onSubmit={handleSearch}
          className="w-full md:w-96 relative"
        >
          <div className="relative">
            <input
              type="text"
              placeholder="Search by block / tx / address"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-3 bg-black/30 border border-white/10 text-white text-sm placeholder-zinc-500 focus:border-nothing-green/50 focus:outline-none"
            />
            <button
              type="submit"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-white transition-colors"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>
    </header>
  );
}

export default Header;

