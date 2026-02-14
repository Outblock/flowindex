import { useState, useCallback } from 'react';
import { Check, Copy } from 'lucide-react';

export interface CopyButtonProps {
  content: string;
  className?: string;
  /** Kept for backward compat — ignored (always ghost-like) */
  variant?: string;
  /** Kept for backward compat — ignored */
  size?: string;
}

function CopyButton({ content, className = '' }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (!content) return;
      navigator.clipboard.writeText(content).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      });
    },
    [content],
  );

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy'}
      className={`inline-flex items-center justify-center p-0 rounded-sm text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors cursor-pointer ${className}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" />
      ) : (
        <Copy className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

export { CopyButton };
