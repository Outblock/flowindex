import React from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
    title: string;
    subtitle?: string | React.ReactNode;
    children?: React.ReactNode;
    className?: string;
    backgroundImage?: string;
}

export function PageHeader({ title, subtitle, children, className, backgroundImage }: PageHeaderProps) {
    return (
        <div className={cn("relative overflow-hidden rounded-2xl mb-8 p-8 md:p-12", className)}>
            {/* Background with gradient and optional image/texture */}
            <div className="absolute inset-0 bg-gradient-to-br from-zinc-100 to-zinc-200 dark:from-zinc-900 dark:to-black z-0" />

            {backgroundImage && (
                <div
                    className="absolute inset-0 opacity-10 dark:opacity-20 z-0 bg-cover bg-center"
                    style={{ backgroundImage: `url(${backgroundImage})` }}
                />
            )}

            {/* Subtle noise texture overlay */}
            <div className="absolute inset-0 opacity-[0.03] dark:opacity-[0.05] z-0 pointer-events-none mix-blend-overlay"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}
            />

            <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
                <div className="space-y-2">
                    <h1 className="text-3xl md:text-5xl font-black tracking-tighter text-zinc-900 dark:text-white uppercase">
                        {title}
                    </h1>
                    {subtitle && (
                        <div className="text-sm md:text-base text-zinc-600 dark:text-zinc-400 font-mono tracking-tight">
                            {subtitle}
                        </div>
                    )}
                </div>
                {children && (
                    <div className="flex-shrink-0">
                        {children}
                    </div>
                )}
            </div>
        </div>
    );
}
