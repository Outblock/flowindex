import { Link, useLocation } from 'react-router-dom';
import { Home, Box, ArrowRightLeft, Users, BarChart2, FileText, Layers, Activity } from 'lucide-react';

export default function Sidebar() {
    const location = useLocation();

    const isActive = (path) => {
        if (path === '/') return location.pathname === '/';
        return location.pathname.startsWith(path);
    };

    const navItems = [
        { label: 'Home Page', path: '/', icon: Home },
        { label: 'Scheduled', path: '#', icon: Activity, disabled: true }, // Placeholder
        { label: 'Transactions', path: '/transactions', icon: ArrowRightLeft, disabled: true }, // Placeholder linking to list someday
        { label: 'Blocks', path: '/blocks', icon: Box, disabled: true }, // Placeholder
        { label: 'Contracts', path: '#', icon: FileText, disabled: true }, // Placeholder
        { label: 'Accounts', path: '/accounts', icon: Users, disabled: true }, // Placeholder
        { label: 'Nodes', path: '#', icon: Layers, disabled: true }, // Placeholder
        { label: 'Analytics', path: '/stats', icon: BarChart2 },
        { label: 'API Docs', path: '/api-docs', icon: FileText },
    ];

    return (
        <div className="w-[260px] h-screen bg-black border-r border-white/5 flex flex-col shrink-0 sticky top-0">
            {/* Logo Section */}
            <div className="p-6 flex items-center space-x-3 mb-6">
                <Box className="h-8 w-8 text-nothing-green rotate-12" />
                <div className="flex flex-col">
                    <span className="text-2xl font-black tracking-tighter text-white uppercase italic leading-none">
                        flow<span className="text-nothing-green">scan</span>
                    </span>
                </div>
            </div>

            {/* Navigation */}
            <nav className="flex-1 px-4 space-y-2 overflow-y-auto custom-scrollbar">
                {navItems.map((item) => (
                    <Link
                        key={item.label}
                        to={item.disabled ? '#' : item.path}
                        className={`flex items-center space-x-3 px-4 py-3 rounded-sm transition-all duration-200 group ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5'} ${isActive(item.path) && !item.disabled ? 'bg-nothing-green/10 text-nothing-green border-r-2 border-nothing-green' : 'text-zinc-400'}`}
                        onClick={(e) => item.disabled && e.preventDefault()}
                    >
                        <item.icon className={`h-5 w-5 ${isActive(item.path) && !item.disabled ? 'text-nothing-green' : 'text-zinc-500 group-hover:text-zinc-300'}`} />
                        <span className={`text-sm font-medium tracking-wide ${isActive(item.path) && !item.disabled ? 'text-white' : ''}`}>{item.label}</span>
                    </Link>
                ))}
            </nav>

            {/* Footer / Version */}
            <div className="p-6 border-t border-white/5">
                <div className="text-[10px] text-zinc-600 uppercase tracking-widest text-center">
                    v1.0.0 Beta
                </div>
            </div>
        </div>
    );
}
