import * as React from 'react';
import { cn } from '../../lib/utils';

/* ── Timeline root ── */
const Timeline = React.forwardRef<HTMLOListElement, React.HTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn('relative space-y-0', className)} {...props} />
  ),
);
Timeline.displayName = 'Timeline';

/* ── Timeline Item ── */
const TimelineItem = React.forwardRef<HTMLLIElement, React.HTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => (
    <li ref={ref} className={cn('relative pl-8 pb-8 last:pb-0', className)} {...props} />
  ),
);
TimelineItem.displayName = 'TimelineItem';

/* ── Connector line between dots ── */
const TimelineConnector = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'absolute left-[11px] top-[28px] bottom-0 w-px bg-zinc-200 dark:bg-white/10',
        className,
      )}
      {...props}
    />
  ),
);
TimelineConnector.displayName = 'TimelineConnector';

/* ── Dot / Icon container ── */
interface TimelineDotProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'success' | 'destructive' | 'info';
}

const dotVariants: Record<string, string> = {
  default: 'bg-zinc-200 dark:bg-zinc-700 text-zinc-500 dark:text-zinc-400',
  success: 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
  destructive: 'bg-red-100 dark:bg-red-500/20 text-red-600 dark:text-red-400',
  info: 'bg-blue-100 dark:bg-blue-500/20 text-blue-600 dark:text-blue-400',
};

const TimelineDot = React.forwardRef<HTMLDivElement, TimelineDotProps>(
  ({ className, variant = 'default', children, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'absolute left-0 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-white dark:ring-zinc-900',
        dotVariants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  ),
);
TimelineDot.displayName = 'TimelineDot';

/* ── Content area ── */
const TimelineContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('pt-0.5', className)} {...props} />
  ),
);
TimelineContent.displayName = 'TimelineContent';

export { Timeline, TimelineItem, TimelineConnector, TimelineDot, TimelineContent };
