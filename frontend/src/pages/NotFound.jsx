import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import GridScan from '../components/GridScan';

function NotFound() {
    return (
        <div className="flex-1 w-full flex flex-col items-center justify-center p-8 text-center bg-black relative overflow-hidden">
            {/* GridScan Background */}
            <GridScan scanColor="#9effe2" className="absolute inset-0 z-0 pointer-events-none" />

            <div className="relative z-10 space-y-8 max-w-2xl mx-auto flex flex-col items-center">
                <h1 className="text-[12rem] leading-none font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-white/5 tracking-tighter select-none">
                    404
                </h1>
                <div className="space-y-4 max-w-lg">
                    <h2 className="text-2xl font-bold text-white uppercase tracking-widest">Page Not Found</h2>
                    <p className="text-zinc-400 font-mono text-sm leading-relaxed">
                        The block or transaction you are looking for has been pruned or does not exist in this timeline.
                    </p>
                </div>

                <Link
                    to="/"
                    className="inline-flex items-center gap-2 px-8 py-4 bg-white text-black font-bold uppercase tracking-widest hover:bg-[#9effe2] transition-colors duration-300 rounded-sm mt-8"
                >
                    <Home className="w-4 h-4" />
                    <span>Return to Dashboard</span>
                </Link>
            </div>
        </div>
    );
}

export default NotFound;
