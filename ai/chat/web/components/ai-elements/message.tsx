"use client";

import type { UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";

import { Button } from "@/components/ui/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@/components/ui/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Streamdown } from "streamdown";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full max-w-[95%] flex-col gap-2",
      from === "user" ? "is-user ml-auto justify-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm",
      "group-[.is-user]:ml-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground",
      "group-[.is-assistant]:text-foreground",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  currentBranch: number;
  totalBranches: number;
  goToPrevious: () => void;
  goToNext: () => void;
  branches: ReactElement[];
  setBranches: (branches: ReactElement[]) => void;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = useCallback(
    (newBranch: number) => {
      setCurrentBranch(newBranch);
      onBranchChange?.(newBranch);
    },
    [onBranchChange]
  );

  const goToPrevious = useCallback(() => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const goToNext = useCallback(() => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  }, [currentBranch, branches.length, handleBranchChange]);

  const contextValue = useMemo<MessageBranchContextType>(
    () => ({
      branches,
      currentBranch,
      goToNext,
      goToPrevious,
      setBranches,
      totalBranches: branches.length,
    }),
    [branches, currentBranch, goToNext, goToPrevious]
  );

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = useMemo(
    () => (Array.isArray(children) ? children : [children]),
    [children]
  );

  // Use useEffect to update branches when they change
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup>;

export const MessageBranchSelector = ({
  className,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Don't render if there's only one branch
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-l-md [&>*:not(:last-child)]:rounded-r-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Previous branch"
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label="Next branch"
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = HTMLAttributes<HTMLSpanElement>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      {currentBranch + 1} of {totalBranches}
    </ButtonGroupText>
  );
};

/* ── Auto-link hex addresses/hashes ── */

const HEX_RE = /\b(0x[0-9a-fA-F]{16}|0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64})\b/g;

function classifyHex(val: string): { url: string | null } {
  const hex = val.toLowerCase();
  const has0x = hex.startsWith("0x");
  const bare = has0x ? hex.slice(2) : hex;
  if (bare.length === 16 && /^[0-9a-f]+$/.test(bare)) {
    return { url: `https://flowindex.io/accounts/${has0x ? val : `0x${val}`}` };
  }
  if (bare.length === 40 && /^[0-9a-f]+$/.test(bare)) {
    return { url: `https://evm.flowindex.io/address/${has0x ? val : `0x${val}`}` };
  }
  if (bare.length === 64 && /^[0-9a-f]+$/.test(bare)) {
    return has0x
      ? { url: `https://evm.flowindex.io/tx/${val}` }
      : { url: `https://flowindex.io/txs/${val}` };
  }
  return { url: null };
}

function LinkedHex({ val }: { val: string }) {
  const { url } = classifyHex(val);
  if (!url) return <span className="text-[var(--flow-green)]/70">{val}</span>;
  const short = val.length > 20 ? `${val.slice(0, 10)}...${val.slice(-8)}` : val;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="text-[var(--flow-green)]/90 hover:text-[var(--flow-green)] hover:underline" title={val}>
      {short}
    </a>
  );
}

function AutoLinkText({ children }: { children: React.ReactNode }): React.ReactNode {
  return processChildren(children);
}

function processChildren(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") return linkifyHex(children);
  if (Array.isArray(children)) return children.map((c, i) => <span key={i}>{processChildren(c)}</span>);
  return children;
}

function linkifyHex(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  HEX_RE.lastIndex = 0;
  while ((m = HEX_RE.exec(text)) !== null) {
    if (m.index > lastIdx) parts.push(text.slice(lastIdx, m.index));
    parts.push(<LinkedHex key={m.index} val={m[1]} />);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}


const streamdownPlugins = { cjk, code, math, mermaid };

/* eslint-disable @typescript-eslint/no-explicit-any */
const mdComponents: Record<string, any> = {
  h1: ({ children, ...props }: any) => <h1 className="text-base font-bold text-white mt-3 mb-1" {...props}>{children}</h1>,
  h2: ({ children, ...props }: any) => <h2 className="text-sm font-bold text-white mt-3 mb-1" {...props}>{children}</h2>,
  h3: ({ children, ...props }: any) => <h3 className="text-[13px] font-bold text-white mt-2 mb-1" {...props}>{children}</h3>,
  h4: ({ children, ...props }: any) => <h4 className="text-[13px] font-semibold text-zinc-100 mt-2 mb-0.5" {...props}>{children}</h4>,
  p: ({ children, ...props }: any) => <p className="mb-2 last:mb-0" {...props}><AutoLinkText>{children}</AutoLinkText></p>,
  strong: ({ children, ...props }: any) => <strong className="font-bold text-white" {...props}>{children}</strong>,
  em: ({ children, ...props }: any) => <em className="italic" {...props}>{children}</em>,
  a: ({ children, href, ...props }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[var(--flow-green)] hover:underline" {...props}>{children}</a>
  ),
  ul: ({ children, ...props }: any) => <ul className="ml-3 mb-2 space-y-0.5" {...props}>{children}</ul>,
  ol: ({ children, ...props }: any) => <ol className="ml-3 mb-2 space-y-0.5 list-decimal list-inside" {...props}>{children}</ol>,
  li: ({ children, ...props }: any) => (
    <li className="flex gap-1.5" {...props}>
      <span className="text-[var(--flow-green)] shrink-0 mt-[1px]">-</span>
      <span className="flex-1"><AutoLinkText>{children}</AutoLinkText></span>
    </li>
  ),
  blockquote: ({ children, ...props }: any) => (
    <blockquote className="border-l-2 border-[var(--flow-green)]/40 pl-3 my-2 text-zinc-400 italic" {...props}>{children}</blockquote>
  ),
  hr: () => <hr className="my-3 border-white/10" />,
  table: ({ children, ...props }: any) => (
    <div className="overflow-x-auto my-2 rounded-sm border border-white/10">
      <table className="w-full text-left border-collapse text-[12px]" {...props}>{children}</table>
    </div>
  ),
  thead: ({ children, ...props }: any) => <thead className="bg-white/[0.03]" {...props}>{children}</thead>,
  th: ({ children, ...props }: any) => (
    <th className="px-3 py-1.5 text-[11px] font-bold text-zinc-400 uppercase tracking-wider border-b border-white/10 whitespace-nowrap" {...props}>{children}</th>
  ),
  td: ({ children, ...props }: any) => (
    <td className="px-3 py-1.5 text-zinc-400 border-b border-white/5 font-mono" {...props}><AutoLinkText>{children}</AutoLinkText></td>
  ),
  inlineCode: ({ children, ...props }: any) => (
    <code className="text-[11px] bg-white/10 px-1 py-0.5 rounded font-mono text-purple-400" {...props}>
      {children}
    </code>
  ),
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type MessageResponseProps = HTMLAttributes<HTMLDivElement> & {
  children: string;
  streaming?: boolean;
};

export const MessageResponse = memo(
  ({ className, children, streaming, ...props }: MessageResponseProps) => (
    <div
      className={cn(
        "text-[13px] text-zinc-300 leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        className
      )}
      {...props}
    >
      <Streamdown
        mode={streaming ? "streaming" : "static"}
        animated={streaming ? { animation: "blurIn", duration: 600, easing: "ease-out" } : false}
        components={mdComponents}
        plugins={streamdownPlugins}
      >
        {children}
      </Streamdown>
    </div>
  ),
  (prevProps, nextProps) => prevProps.children === nextProps.children && prevProps.streaming === nextProps.streaming
);

MessageResponse.displayName = "MessageResponse";

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
