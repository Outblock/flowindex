import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Home, Box, ArrowRightLeft, Users, BarChart2, FileText, Layers, Activity, ChevronLeft, ChevronRight, Sun, Moon } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';

export default function Sidebar() {
    const location = useLocation();
    const { theme, toggleTheme } = useTheme();
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isMobileOpen, setIsMobileOpen] = useState(false);

    const isActive = (path) => {
        if (path === '/') return location.pathname === '/';
        return location.pathname.startsWith(path);
    };

    const navItems = [
        { label: 'Home Page', path: '/', icon: Home },
        { label: 'Scheduled', path: '#', icon: Activity, disabled: true },
        { label: 'Transactions', path: '/transactions', icon: ArrowRightLeft, disabled: true },
        { label: 'Blocks', path: '/blocks', icon: Box, disabled: true },
        { label: 'Contracts', path: '#', icon: FileText, disabled: true },
        { label: 'Accounts', path: '/accounts', icon: Users, disabled: true },
        { label: 'Nodes', path: '#', icon: Layers, disabled: true },
        { label: 'Analytics', path: '/stats', icon: BarChart2 },
        { label: 'API Docs', path: '/api-docs', icon: FileText },
    ];

    const activeItem = navItems.find(item => isActive(item.path) && !item.disabled);

    return (
        <>
            {/* Mobile Dropdown Trigger */}
            <div className="md:hidden fixed bottom-6 right-6 z-50">
                <div className="relative">
                    <AnimatePresence>
                        {isMobileOpen && (
                            <>
                                {/* Backdrop */}
                                <motion.div
                                    initial={{ opacity: 0 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    onClick={() => setIsMobileOpen(false)}
                                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
                                />

                                {/* Menu */}
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95, y: 10 }}
                                    animate={{ opacity: 1, scale: 1, y: 0 }}
                                    exit={{ opacity: 0, scale: 0.95, y: 10 }}
                                    className="absolute bottom-full right-0 mb-4 w-64 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50 py-2"
                                >
                                    {navItems.map((item) => (
                                        <Link
                                            key={item.label}
                                            to={item.disabled ? '#' : item.path}
                                            onClick={(e) => {
                                                if (item.disabled) e.preventDefault();
                                                else setIsMobileOpen(false);
                                            }}
                                            className={`flex items-center space-x-3 px-4 py-3 transition-colors ${item.disabled ? 'opacity-40 cursor-not-allowed' : 'hover:bg-white/5'
                                                } ${isActive(item.path) && !item.disabled ? 'text-nothing-green bg-nothing-green/10' : 'text-zinc-400'}`}
                                        >
                                            <item.icon className="w-5 h-5 shrink-0" />
                                            <span className="font-medium">{item.label}</span>
                                        </Link>
                                    ))}

                                    <div className="h-px bg-white/10 my-2" />

                                    <button
                                        onClick={(e) => {
                                            toggleTheme(e);
                                            // Keep menu open or close? Maybe keep open to see change.
                                        }}
                                        className="w-full flex items-center space-x-3 px-4 py-3 hover:bg-white/5 text-zinc-400 transition-colors"
                                    >
                                        {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
                                        <span className="font-medium">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
                                    </button>
                                </motion.div>
                            </>
                        )}
                    </AnimatePresence>

                    <button
                        onClick={() => setIsMobileOpen(!isMobileOpen)}
                        className="flex items-center gap-2 bg-zinc-900 text-white border border-white/10 px-5 py-3 rounded-full shadow-lg hover:bg-zinc-800 transition-all active:scale-95"
                    >
                        {isMobileOpen ? (
                            <ChevronRight className="w-5 h-5 rotate-90" />
                        ) : (
                            <span className="flex items-center gap-2">
                                {activeItem ? (
                                    <>
                                        <activeItem.icon className="w-4 h-4" />
                                        <span>{activeItem.label}</span>
                                    </>
                                ) : (
                                    <span>Menu</span>
                                )}
                            </span>
                        )}
                        {!isMobileOpen && <ChevronLeft className="w-4 h-4 rotate-90" />}
                    </button>
                </div>
            </div>

            {/* Desktop Sidebar */}
            <motion.div
                initial={false}
                animate={{ width: isCollapsed ? 80 : 260 }}
                className="hidden md:flex h-screen bg-black dark:bg-black bg-white border-r border-zinc-200 dark:border-white/5 flex-col shrink-0 sticky top-0 transition-colors duration-300 z-50"
            >
                {/* Logo Section */}
                <div className={`p-6 flex items-center ${isCollapsed ? 'justify-center' : 'space-x-3'} mb-6 h-[88px]`}>
                    <Box className="h-8 w-8 text-nothing-green rotate-12 shrink-0" />
                    <AnimatePresence>
                        {!isCollapsed && (
                            <motion.div
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                className="flex flex-col whitespace-nowrap overflow-hidden"
                            >
                                <span className="text-2xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase italic leading-none">
                                    flow<span className="text-nothing-green">scan</span>
                                </span>
                            </motion.div>
                        )}
                    </AnimatePresence>
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
