import { ChevronLeft, ChevronRight } from 'lucide-react';

export function Pagination({ currentPage, onPageChange, hasNext }) {
    return (
        <div className="flex items-center justify-center space-x-4 mt-8">
            <button
                onClick={() => onPageChange(currentPage - 1)}
                disabled={currentPage <= 1}
                className="flex items-center px-4 py-2 border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200 text-zinc-900 dark:text-white"
            >
                <ChevronLeft className="w-4 h-4 mr-2" />
                <span className="text-xs uppercase tracking-widest font-mono">Prev</span>
            </button>

            <div className="flex items-center space-x-1">
                <span className="w-1 h-1 bg-zinc-300 dark:bg-white rounded-full opacity-30"></span>
                <span className="w-1 h-1 bg-nothing-green rounded-full"></span>
                <span className="w-1 h-1 bg-zinc-300 dark:bg-white rounded-full opacity-30"></span>
                <span className="text-sm font-mono font-bold text-zinc-900 dark:text-white px-2">Page {currentPage}</span>
                <span className="w-1 h-1 bg-zinc-300 dark:bg-white rounded-full opacity-30"></span>
            </div>

            <button
                onClick={() => onPageChange(currentPage + 1)}
                disabled={!hasNext}
                className="flex items-center px-4 py-2 border border-zinc-200 dark:border-white/10 bg-white dark:bg-nothing-dark hover:bg-zinc-50 dark:hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-200 text-zinc-900 dark:text-white"
            >
                <span className="text-xs uppercase tracking-widest font-mono">Next</span>
                <ChevronRight className="w-4 h-4 ml-2" />
            </button>
        </div>
    );
}
