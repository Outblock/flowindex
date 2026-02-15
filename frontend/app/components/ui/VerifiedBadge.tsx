import { useState } from 'react';

/**
 * Twitter/X-style verified badge with tooltip on hover.
 * Uses a filled shield-check SVG icon in the project's accent green.
 */
export function VerifiedBadge({
  size = 14,
  tooltip = 'Verified by Flowindex',
  className = '',
}: {
  size?: number;
  tooltip?: string;
  className?: string;
}) {
  const [show, setShow] = useState(false);

  return (
    <span
      className={`relative inline-flex items-center flex-shrink-0 ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {/* Filled shield-check icon — similar to Twitter/X verified */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-nothing-green drop-shadow-[0_0_3px_rgba(0,255,136,0.3)]"
      >
        <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-1.5 14.59l-3.5-3.5 1.41-1.41L10.5 12.76l5.09-5.09 1.41 1.41-6.5 6.51z" />
      </svg>

      {/* Tooltip */}
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 text-[10px] font-medium text-white bg-zinc-900 dark:bg-zinc-700 rounded shadow-lg whitespace-nowrap pointer-events-none z-50 animate-in fade-in duration-150">
          {tooltip}
          <span className="absolute top-full left-1/2 -translate-x-1/2 -mt-px border-4 border-transparent border-t-zinc-900 dark:border-t-zinc-700" />
        </span>
      )}
    </span>
  );
}
