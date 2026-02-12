import React from 'react';
import { cn } from '../../lib/utils';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    children: React.ReactNode;
    className?: string;
    intensity?: 'low' | 'medium' | 'high';
}

export function GlassCard({ children, className, intensity = 'medium', ...props }: GlassCardProps) {
    const intensityStyles = {
        low: 'bg-white/40 dark:bg-black/40 border-white/20 dark:border-white/5',
        medium: 'bg-white/60 dark:bg-black/60 border-white/30 dark:border-white/10 backdrop-blur-md',
        high: 'bg-white/80 dark:bg-black/80 border-white/40 dark:border-white/20 backdrop-blur-xl',
    };

    return (
        <div
            className={cn(
                "border shadow-sm transition-all duration-300",
                intensityStyles[intensity],
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
