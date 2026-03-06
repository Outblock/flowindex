// ---------------------------------------------------------------------------
// ExpandableFlowContainer — inline + fullscreen modal for ReactFlow diagrams
// ---------------------------------------------------------------------------

import { useState, useEffect, type ReactNode } from 'react';
import { Maximize2, X } from 'lucide-react';

interface Props {
  label: string;
  subtitle?: string;
  icon?: ReactNode;
  height: number | string;
  footer?: ReactNode;
  children: ReactNode;
}

export default function ExpandableFlowContainer({ label, subtitle, icon, height, footer, children }: Props) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  return (
    <>
      {/* Inline view */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <div className="text-[10px] text-zinc-500 uppercase tracking-widest">{label}</div>
          <button
            onClick={() => setExpanded(true)}
            className="inline-flex items-center gap-1.5 px-2 py-1 text-[10px] text-zinc-500 hover:text-white uppercase tracking-widest border border-zinc-700 hover:border-zinc-500 rounded transition-colors"
          >
            <Maximize2 className="w-3 h-3" />
            Expand
          </button>
        </div>
        <div
          className="border border-zinc-800 rounded-lg overflow-hidden"
          style={{ height }}
        >
          {children}
        </div>
        {footer}
      </div>

      {/* Fullscreen modal */}
      {expanded && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setExpanded(false)} />
          <div className="relative w-[95vw] h-[85vh] max-w-[1400px] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-700 flex-shrink-0">
              <div className="flex items-center gap-3">
                {icon}
                <span className="text-xs text-zinc-300 uppercase tracking-widest font-bold">{label}</span>
                {subtitle && (
                  <span className="text-[10px] text-zinc-500 font-mono">{subtitle}</span>
                )}
              </div>
              <button
                onClick={() => setExpanded(false)}
                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* Diagram */}
            <div className="flex-1 min-h-0">
              {children}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
