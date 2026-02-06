import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import GridScan from '../components/GridScan';

function NotFound() {
    return (
        <div className="flex-1 w-full flex flex-col items-center justify-center p-8 text-center bg-black relative overflow-hidden">
            {/* GridScan Background */}
            <GridScan scanColor="#9effe2" className="absolute inset-0 pointer-events-none" />

            <div className="relative z-10 space-y-6 max-w-lg mx-auto">
                <div className="space-y-2">
                    <h2 className="text-2xl font-bold text-white uppercase tracking-widest">Page Not Found</h2>
                    <p className="text-zinc-400 font-mono text-sm leading-relaxed">
                        The block or transaction you are looking for has been pruned or does not exist in this timeline.
                    </p>
                </div>

                <Link
                    to="/"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-white text-black font-bold uppercase tracking-widest hover:bg-[#9effe2] transition-colors duration-300 rounded-sm"
                >
                    <Home className="w-4 h-4" />
                    <span>Return to Dashboard</span>
                </Link>
            </div>
        </div>
    );
}

export default NotFound;
