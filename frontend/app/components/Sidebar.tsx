import { useState } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import { Home, Box, ArrowRightLeft, Users, FileText, Layers, Globe, ChevronLeft, ChevronRight, Sun, Moon, Coins, Image, Clock, BarChart3, Code2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useMobileMenu } from '../contexts/MobileMenuContext';
import { FlowIndexLogo } from './FlowIndexLogo';
import { motion, AnimatePresence } from 'framer-motion';

export default function Sidebar() {
    const routerState = useRouterState();
    const location = routerState.location;
    const { theme, toggleTheme } = useTheme();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const { isOpen: isMobileOpen, close: closeMobileMenu } = useMobileMenu();

    const isActive = (path: string) => {
        if (path === '/') return location.pathname === '/';
        return location.pathname.startsWith(path);
    };

    const navItems: Array<{ label: string; path: string; icon: typeof Home; disabled?: boolean }> = [
        { label: 'Home Page', path: '/', icon: Home },
        { label: 'Analytics', path: '/analytics', icon: BarChart3 },
        { label: 'Transactions', path: '/txs', icon: ArrowRightLeft },
        { label: 'Blocks', path: '/blocks', icon: Box },
        { label: 'Tokens', path: '/tokens', icon: Coins },
        { label: 'NFTs', path: '/nfts', icon: Image },
        { label: 'Contracts', path: '/contracts', icon: FileText },
        { label: 'Accounts', path: '/accounts', icon: Users },
        { label: 'Scheduled Txs', path: '/scheduled', icon: Clock },
        { label: 'Nodes', path: '/nodes', icon: Globe },
        { label: 'Indexing Status', path: '/stats', icon: Layers },
        { label: 'API Docs', path: '/api-docs', icon: FileText },
        { label: 'Developer', path: '/developer', icon: Code2 },
    ];

    return (
        <>
            {/* Mobile Slide-out Drawer */}
            <AnimatePresence>
                {isMobileOpen && (
                    <>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            onClick={() => closeMobileMenu()}
                            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
                        />
                        <motion.div
                            initial={{ x: -280 }}
                            animate={{ x: 0 }}
                            exit={{ x: -280 }}
                            transition={{ type: "spring", bounce: 0, duration: 0.3 }}
                            className="md:hidden fixed inset-y-0 left-0 w-[280px] bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-white/10 z-50 flex flex-col"
                        >
                            {/* Logo */}
                            <div className="p-6 flex items-center space-x-3 h-[64px]">
                                <FlowIndexLogo size={22} className="text-nothing-green shrink-0" />
                                <span className="text-xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase italic leading-none">
                                    flow<span className="text-nothing-green">index</span>
                                </span>
                            </div>

                            {/* Nav Items */}
                            <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
                                {navItems.map((item) => (
                                    <Link
                                        key={item.label}
                                        to={item.disabled ? '#' : item.path}
                                        onClick={(e) => {
                                            if (item.disabled) e.preventDefault();
                                            else closeMobileMenu();
                                        }}
                                        className={`flex items-center space-x-3 px-4 py-3 rounded-sm transition-colors ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-100 dark:hover:bg-white/5'
                                            } ${isActive(item.path) && !item.disabled ? 'text-nothing-green bg-nothing-green/10' : 'text-zinc-600 dark:text-zinc-400'}`}
                                    >
                                        <item.icon className="w-5 h-5 shrink-0" />
                                        <span className="text-sm font-medium">{item.label}</span>
                                    </Link>
                                ))}
                            </nav>

                            {/* Footer */}
                            <div className="p-4 border-t border-zinc-200 dark:border-white/5">
                                <button
                                    onClick={(e) => toggleTheme(e)}
                                    className="w-full flex items-center space-x-3 px-4 py-2 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400 transition-colors"
                                >
                                    {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                                    <span className="text-sm font-medium">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                                </button>
                            </div>
                        </motion.div>
                    </>
                )}
            </AnimatePresence>

            {/* Desktop Sidebar */}
            <motion.div
                initial={false}
                animate={{ width: isCollapsed ? 80 : 260 }}
                className="hidden md:flex h-screen bg-black dark:bg-black bg-white border-r border-zinc-200 dark:border-white/5 flex-col shrink-0 sticky top-0 transition-colors duration-300 z-50"
            >
                {/* Logo Section */}
                <div className={`p-6 flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} mb-6 h-[88px]`}>
                    <Link to="/" className="flex items-center space-x-3">
                        <FlowIndexLogo size={26} className="text-nothing-green shrink-0" />
                        <AnimatePresence>
                            {!isCollapsed && (
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: -10 }}
                                    className="flex flex-col whitespace-nowrap overflow-hidden"
                                >
                                    <span className="text-2xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase italic leading-none">
                                        flow<span className="text-nothing-green">index</span>
                                    </span>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </Link>
                </div>

                {/* Navigation */}
                <nav className="flex-1 px-4 space-y-2 overflow-y-auto custom-scrollbar overflow-x-hidden">
                    {navItems.map((item) => (
                        <Link
                            key={item.label}
                            to={item.disabled ? '#' : item.path}
                            className={`flex items-center ${isCollapsed ? 'justify-center px-2' : 'space-x-3 px-4'} py-3 rounded-sm transition-all duration-200 group relative
                                ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-zinc-100 dark:hover:bg-white/5'} 
                                ${isActive(item.path) && !item.disabled
                                    ? 'bg-nothing-green/10 text-nothing-green border-r-2 border-nothing-green'
                                    : 'text-zinc-600 dark:text-zinc-400'}`}
                            onClick={(e) => item.disabled && e.preventDefault()}
                            title={isCollapsed ? item.label : ''}
                        >
                            <item.icon className={`h-5 w-5 shrink-0 ${isActive(item.path) && !item.disabled ? 'text-nothing-green' : 'text-zinc-500 dark:text-zinc-500 group-hover:text-zinc-900 dark:group-hover:text-zinc-300'}`} />

                            {!isCollapsed && (
                                <span className={`text-sm font-medium tracking-wide whitespace-nowrap ${isActive(item.path) && !item.disabled ? 'text-zinc-900 dark:text-white' : ''}`}>
                                    {item.label}
                                </span>
                            )}
                        </Link>
                    ))}
                </nav>

                {/* Footer / Controls */}
                <div className="p-4 border-t border-zinc-200 dark:border-white/5 flex flex-col gap-4">

                    {/* Theme Toggle */}
                    <button
                        onClick={(e) => toggleTheme(e)}
                        className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3 px-4'} py-2 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400 transition-colors`}
                        title={theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                    >
                        {theme === 'dark' ? <Sun className="h-5 w-5 shrink-0" /> : <Moon className="h-5 w-5 shrink-0" />}
                        {!isCollapsed && (
                            <span className="text-sm font-medium">
                                {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
                            </span>
                        )}
                    </button>

                    {/* Collapse Toggle */}
                    <button
                        onClick={() => setIsCollapsed(!isCollapsed)}
                        className={`w-full flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3 px-4'} py-2 rounded-sm hover:bg-zinc-100 dark:hover:bg-white/5 text-zinc-600 dark:text-zinc-400 transition-colors`}
                        title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
                    >
                        {isCollapsed ? <ChevronRight className="h-5 w-5 shrink-0" /> : <ChevronLeft className="h-5 w-5 shrink-0" />}
                        {!isCollapsed && (
                            <span className="text-sm font-medium">
                                Collapse
                            </span>
                        )}
                    </button>

                    {!isCollapsed && (
                        <div className="text-[10px] text-zinc-400 dark:text-zinc-600 uppercase tracking-widest text-center">
                            v1.0.0 Beta
                        </div>
                    )}
                </div>
            </motion.div>
        </>
    );
}
