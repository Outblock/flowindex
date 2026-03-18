"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { FileUIPart, UIMessage, LanguageModelUsage } from "ai";
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Database,
  BarChart3,
  Clock,
  Coins,
  Code2,
  Layers,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Plus,
  Eye,
  EyeOff,
  Wrench,
  Search,
  Bot,
  Download,
  ChevronRight,
  Copy,
  Check,
  Loader2,
  X,
  Share2,
  Link,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputProvider,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
  usePromptInputAttachments,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  Attachments,
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
} from "@/components/ai-elements/attachments";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  ChainOfThought,
  ChainOfThoughtHeader,
  ChainOfThoughtContent,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought";
import {
  Sandbox,
  SandboxHeader,
  SandboxContent,
  SandboxTabs,
  SandboxTabsBar,
  SandboxTabsList,
  SandboxTabsTrigger,
  SandboxTabContent,
} from "@/components/ai-elements/sandbox";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources";
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentBody,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextCacheUsage,
} from "@/components/ai-elements/context";

import { shareSession, unshareSession } from "@/lib/chat-store";
import { SqlResultTable } from "./sql-result-table";
import { ChartArtifact } from "./chart-artifact";
import { ChatBotIcon } from "@flowindex/flow-ui";
import {
  useModelSelector,
  CHAT_MODES,
  type ChatMode,
} from "./model-selector";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

/* ── Collapsible Code Block for tool outputs (matches frontend widget) ── */

function CollapsibleCode({ code, language, label, icon }: { code: string; language: string; label: string; icon: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const langMap: Record<string, string> = { cadence: "swift", sh: "bash", zsh: "bash", shell: "bash", ts: "typescript", js: "javascript", py: "python" };
  const prismLang = langMap[language] || language || "text";

  return (
    <div className="rounded-none border border-white/5 overflow-hidden my-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-white/[0.01] hover:bg-white/[0.03] transition-colors text-left group"
      >
        <motion.div animate={{ rotate: isOpen ? 90 : 0 }} transition={{ duration: 0.15 }}>
          <ChevronRight size={12} className="text-zinc-500 group-hover:text-white" />
        </motion.div>
        {icon}
        <span className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold flex-1">{label}</span>
        <button onClick={handleCopy} className="text-zinc-500 hover:text-white transition-colors p-1">
          {copied ? <Check size={12} className="text-[var(--nothing-green)]" /> : <Copy size={12} />}
        </button>
      </button>
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden border-t border-white/5"
          >
            <SyntaxHighlighter
              language={prismLang}
              style={vscDarkPlus}
              customStyle={{ margin: 0, padding: "16px", fontSize: "12px", lineHeight: "1.6", background: "#050505", borderRadius: 0 }}
              wrapLongLines
            >
              {code}
            </SyntaxHighlighter>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SUGGESTIONS = [
  {
    text: "What is the latest block number?",
    icon: Database,
    label: "Latest block",
  },
  {
    text: "Show me top 10 WFLOW holders",
    icon: Coins,
    label: "Top holders",
  },
  {
    text: "What is the total supply of FLOW?",
    icon: Code2,
    label: "FLOW supply",
  },
  {
    text: "Transaction count in the last 24h",
    icon: Clock,
    label: "24h activity",
  },
  {
    text: "Get the current block height from Cadence",
    icon: Layers,
    label: "Cadence query",
  },
  {
    text: "List all ERC-20 tokens by holder count",
    icon: BarChart3,
    label: "Token rankings",
  },
];

type ChatMessageMetadata = {
  usage?: LanguageModelUsage;
  model?: string;
  contextManagement?: {
    appliedEdits?: Array<{
      type?: string;
    }>;
  };
};

interface ChatProps {
  sessionId: string;
  userId: string | null;
}

export function Chat({ sessionId, userId }: ChatProps) {
  const { mode, selectMode } = useModelSelector();
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Share dialog state
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const handleShare = useCallback(async () => {
    setShareLoading(true);
    setShareDialogOpen(true);
    const result = await shareSession(sessionId);
    if (result) {
      setShareUrl(result.share_url);
    }
    setShareLoading(false);
  }, [sessionId]);

  const handleUnshare = useCallback(async () => {
    setShareLoading(true);
    const ok = await unshareSession(sessionId);
    if (ok) {
      setShareUrl(null);
      setShareDialogOpen(false);
    }
    setShareLoading(false);
  }, [sessionId]);

  const handleCopyShareUrl = useCallback(() => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  }, [shareUrl]);

  const modeFetch = useCallback(async (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.body) {
      try {
        const parsed = JSON.parse(init.body as string);
        parsed.mode = modeRef.current;
        init = { ...init, body: JSON.stringify(parsed) };
      } catch { /* not JSON */ }
    }
    return globalThis.fetch(url, init);
  }, []);

  const transport = useMemo(
    () => new DefaultChatTransport({ api: "/api/chat", fetch: modeFetch as typeof globalThis.fetch }),
    [modeFetch]
  );

  const { messages, sendMessage, status, stop } = useChat({ transport });
  const [hideTools, setHideTools] = useState(false);

  // Extract token usage from the last assistant message's metadata
  const CONTEXT_WINDOW = 200_000;
  const lastAssistantMetadata = useMemo((): ChatMessageMetadata | null => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const metadata = (msg as any).metadata as ChatMessageMetadata | undefined;
      if (msg.role === "assistant" && metadata?.usage) {
        return metadata;
      }
    }
    return null;
  }, [messages]);
  const lastUsage = lastAssistantMetadata?.usage ?? null;
  const lastModel = lastAssistantMetadata?.model;
  const didCompactContext = Boolean(
    lastAssistantMetadata?.contextManagement?.appliedEdits?.some(
      (edit) => edit?.type === "compact_20260112"
    )
  );

  const handleSend = useCallback(
    ({ text, files }: PromptInputMessage) => {
      if (!text.trim() && files.length === 0) return;
      sendMessage({ text, files });
    },
    [sendMessage]
  );

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-3xl px-6 py-8">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              {/* Logo with green glow */}
              <div className="relative mb-8">
                <div className="absolute inset-0 blur-2xl opacity-20 bg-[var(--flow-green)] rounded-full scale-150" />
                <ChatBotIcon size={56} className="relative text-[var(--flow-green)]" />
              </div>

              <h1 className="dot-matrix text-[32px] mb-4 text-white">
                FLOWINDEX AI
              </h1>
              <p className="text-[12px] text-[var(--text-secondary)] mb-12 max-w-sm text-center leading-relaxed font-mono uppercase tracking-wider">
                Blockchain Intelligence / Natural Language Interface
              </p>

              {/* Suggestion grid */}
              <div className="grid grid-cols-2 gap-3 w-full max-w-lg">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => handleSend({ text: s.text, files: [] })}
                    className="group flex items-start gap-3 rounded-none border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-5 py-4 text-left transition-all duration-300 hover:border-[var(--nothing-green)] hover:bg-[var(--bg-element)] cursor-pointer relative overflow-hidden"
                  >
                    <div className="absolute top-0 left-0 w-[2px] h-0 bg-[var(--nothing-green)] transition-all duration-300 group-hover:h-full" />
                    <s.icon
                      size={14}
                      className="mt-0.5 shrink-0 text-[var(--text-tertiary)] group-hover:text-white transition-colors duration-200"
                    />
                    <span className="text-[11px] uppercase font-bold tracking-widest text-[var(--text-secondary)] group-hover:text-white transition-colors duration-200">
                      {s.label}
                    </span>
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <ChatMessage
                  key={msg.id}
                  message={msg}
                  isStreaming={(status === "streaming" || status === "submitted") && idx === messages.length - 1}
                  hideTools={hideTools}
                />
              ))}
              {/* Pending indicator: avatar + shiny text while waiting for first token */}
              {(status === "streaming" || status === "submitted") &&
                messages.length > 0 &&
                messages[messages.length - 1].role === "user" && (
                  <Message from="assistant">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 mt-0.5">
                        <ChatBotIcon isThinking size={22} className="text-[var(--flow-green)]" />
                      </div>
                      <div
                        className="inline-block animate-shine-green text-[12px] font-mono uppercase tracking-widest font-bold"
                      >
                        Processing...
                      </div>
                    </div>
                  </Message>
                )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input area */}
      <div className="pb-8 pt-4 px-6">
        <div className="mx-auto max-w-3xl">
          <PromptInputProvider>
            <PromptInput onSubmit={handleSend} accept="image/*" multiple className="prompt-input-nothing !rounded-none !p-1">
              <PendingPromptAttachments />
              <PromptInputTextarea
                placeholder="INPUT COMMAND OR QUERY..."
                className="!min-h-14 !py-4 !text-[13px] placeholder:text-[var(--text-tertiary)] font-mono uppercase tracking-tight !bg-transparent"
                autoFocus
              />
              <PromptInputFooter className="!pb-3 !pt-1 !px-3">
                <ContextStatus
                  contextWindow={CONTEXT_WINDOW}
                  didCompactContext={didCompactContext}
                  modelId={lastModel}
                  lastUsage={lastUsage}
                  mode={mode}
                />
                <PromptInputSubmit
                  status={status}
                  onStop={stop}
                  className="!rounded-none !bg-[var(--nothing-green)] !text-white hover:!bg-[var(--nothing-green-dim)] !size-8 !transition-all !duration-200"
                />
              </PromptInputFooter>
            </PromptInput>

            <ComposerToolbar
              hideTools={hideTools}
              mode={mode}
              selectMode={selectMode}
              setHideTools={setHideTools}
              showShare={!!userId && messages.length > 0}
              onShare={handleShare}
            />
          </PromptInputProvider>
        </div>
      </div>

      {/* Share Dialog */}
      <AnimatePresence>
        {shareDialogOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            onClick={() => setShareDialogOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="w-full max-w-md mx-4 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-6"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-[15px] font-semibold text-white flex items-center gap-2">
                  <Share2 size={16} />
                  Share Conversation
                </h2>
                <button
                  onClick={() => setShareDialogOpen(false)}
                  className="p-1 text-zinc-400 hover:text-white transition-colors"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="text-[12px] text-zinc-400 mb-4 leading-relaxed">
                Anyone with the link can view a read-only copy of this conversation.
              </p>

              {shareLoading && !shareUrl ? (
                <div className="flex items-center gap-2 text-[12px] text-zinc-400 py-4">
                  <Loader2 size={14} className="animate-spin" />
                  Generating share link...
                </div>
              ) : shareUrl ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 flex items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-sm text-[12px] text-zinc-300 font-mono overflow-hidden">
                      <Link size={12} className="shrink-0 text-zinc-500" />
                      <span className="truncate">{shareUrl}</span>
                    </div>
                    <button
                      onClick={handleCopyShareUrl}
                      className="shrink-0 px-3 py-2 bg-[var(--flow-green)] text-black text-[12px] font-semibold rounded-sm hover:bg-[var(--flow-green-dim)] transition-colors flex items-center gap-1.5"
                    >
                      {shareCopied ? <Check size={12} /> : <Copy size={12} />}
                      {shareCopied ? "Copied" : "Copy"}
                    </button>
                  </div>

                  <button
                    onClick={handleUnshare}
                    disabled={shareLoading}
                    className="text-[11px] text-red-400 hover:text-red-300 transition-colors disabled:opacity-50 flex items-center gap-1"
                  >
                    <X size={10} />
                    Revoke share link
                  </button>
                </div>
              ) : (
                <p className="text-[12px] text-red-400">Failed to generate share link. Please try again.</p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Threshold in characters for collapsing user messages */
const USER_MSG_COLLAPSE_CHARS = 280;
/** Threshold in line count for collapsing user messages */
const USER_MSG_COLLAPSE_LINES = 4;
/** Collapsed preview height in px */
const USER_MSG_COLLAPSED_HEIGHT = 96;

function CollapsibleUserMessage({ text }: { text: string }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const lineCount = text.split("\n").length;
    const charCount = text.length;
    setIsOverflowing(
      charCount > USER_MSG_COLLAPSE_CHARS || lineCount > USER_MSG_COLLAPSE_LINES
    );
  }, [text]);

  const needsCollapse = isOverflowing && !expanded;

  return (
    <div className="relative">
      <motion.div
        ref={contentRef}
        initial={false}
        animate={{
          height: needsCollapse ? USER_MSG_COLLAPSED_HEIGHT : "auto",
        }}
        transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
        className="overflow-hidden whitespace-pre-wrap break-words"
      >
        {text}
      </motion.div>

      {/* Gradient fade when collapsed */}
      <AnimatePresence>
        {needsCollapse && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-[var(--bg-element)] to-transparent pointer-events-none rounded-b-2xl"
          />
        )}
      </AnimatePresence>

      {/* Expand / Collapse button */}
      {isOverflowing && (
        <motion.button
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 flex items-center gap-1 text-[11px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors cursor-pointer"
          type="button"
        >
          <motion.span
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ duration: 0.25 }}
            className="inline-flex"
          >
            <ChevronDown size={12} />
          </motion.span>
          {expanded ? "Show less" : "Show more"}
        </motion.button>
      )}
    </div>
  );
}

type AttachmentListItem = FileUIPart & { id: string };

function getAttachmentVariant(files: AttachmentListItem[]) {
  return files.every((file) => file.mediaType?.startsWith("image/"))
    ? "grid"
    : "list";
}

function AttachmentList({
  files,
  onRemove,
  className,
}: {
  files: AttachmentListItem[];
  onRemove?: (id: string) => void;
  className?: string;
}) {
  if (files.length === 0) return null;

  const variant = getAttachmentVariant(files);

  return (
    <Attachments variant={variant} className={className}>
      {files.map((file) => (
        <Attachment
          key={file.id}
          data={file}
          onRemove={onRemove ? () => onRemove(file.id) : undefined}
          className={
            variant === "grid"
              ? "border border-white/10 bg-white/[0.03]"
              : "border-white/10 bg-white/[0.03]"
          }
        >
          <AttachmentPreview />
          {variant !== "grid" && (
            <AttachmentInfo
              showMediaType
              className="text-[12px] text-zinc-300"
            />
          )}
          {onRemove && <AttachmentRemove className="text-zinc-300" />}
        </Attachment>
      ))}
    </Attachments>
  );
}

function PendingPromptAttachments() {
  const attachments = usePromptInputAttachments();

  if (attachments.files.length === 0) return null;

  return (
    <AttachmentList
      files={attachments.files}
      onRemove={attachments.remove}
      className="mb-3 !ml-0 !w-full"
    />
  );
}

function ContextStatus({
  contextWindow,
  didCompactContext,
  lastUsage,
  modelId,
  mode,
}: {
  contextWindow: number;
  didCompactContext: boolean;
  lastUsage: LanguageModelUsage | null;
  modelId?: string;
  mode: ChatMode;
}) {
  if (!lastUsage) return null;

  return (
    <div className="ml-auto flex items-center gap-2">
      {didCompactContext && (
        <span className="rounded-sm border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-400/80">
          Compacted
        </span>
      )}
      <Context
        usedTokens={(lastUsage.inputTokens ?? 0) + (lastUsage.outputTokens ?? 0)}
        maxTokens={contextWindow}
        usage={lastUsage}
        modelId={modelId ?? CHAT_MODES.find((m) => m.key === mode)?.model}
      >
        <ContextTrigger className="!h-6 !px-1.5 !py-0 !text-[10px] !gap-1 text-zinc-500 hover:text-zinc-300" />
        <ContextContent side="top" align="end" className="bg-zinc-900 border-white/10">
          <ContextContentHeader className="text-zinc-300" />
          <ContextContentBody className="space-y-1">
            <ContextInputUsage className="text-zinc-400" />
            <ContextOutputUsage className="text-zinc-400" />
            <ContextReasoningUsage className="text-zinc-400" />
            <ContextCacheUsage className="text-zinc-400" />
          </ContextContentBody>
        </ContextContent>
      </Context>
    </div>
  );
}

function ComposerToolbar({
  hideTools,
  mode,
  selectMode,
  setHideTools,
  showShare,
  onShare,
}: {
  hideTools: boolean;
  mode: ChatMode;
  selectMode: (mode: ChatMode) => void;
  setHideTools: React.Dispatch<React.SetStateAction<boolean>>;
  showShare?: boolean;
  onShare?: () => void;
}) {
  const attachments = usePromptInputAttachments();

  return (
    <div className="flex items-center gap-2 mt-2 px-1">
      <div className="relative group/attach">
        <button
          type="button"
          onClick={attachments.openFileDialog}
          className="w-8 h-8 flex items-center justify-center text-[var(--text-tertiary)] hover:text-white hover:bg-white/5 rounded-none transition-all border border-transparent hover:border-white/10"
          title="Attach image"
        >
          <Plus size={14} />
        </button>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 px-3 py-1.5 rounded-none text-[10px] uppercase tracking-[0.15em] font-bold transition-all bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:border-zinc-700"
          >
            {(() => {
              const current = CHAT_MODES.find((m) => m.key === mode) || CHAT_MODES[0];
              const CurrentIcon = current.icon;
              return (
                <>
                  <CurrentIcon size={12} />
                  {current.label}
                </>
              );
            })()}
            <ChevronUp size={10} className="ml-1 opacity-40" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="min-w-[220px] z-[80] bg-zinc-950 border border-zinc-800 shadow-2xl p-1 rounded-none">
          <DropdownMenuLabel className="text-[9px] uppercase tracking-[0.2em] text-zinc-500 px-3 py-2">System Module</DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-zinc-800" />
          {CHAT_MODES.map(({ key, label, icon: Icon, desc, model }) => (
            <DropdownMenuItem
              key={key}
              onSelect={() => selectMode(key)}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-none cursor-pointer transition-colors ${
                mode === key
                  ? "bg-white/5 text-white"
                  : "text-zinc-400 hover:bg-white/[0.02] hover:text-zinc-200"
              }`}
            >
              <Icon size={14} className={`shrink-0 ${mode === key ? "text-[var(--nothing-green)]" : ""}`} />
              <div className="flex flex-col min-w-0">
                <span className="text-xs font-bold uppercase tracking-wider">{label}</span>
                <span className="text-[9px] leading-tight text-zinc-500 mt-0.5">{model}</span>
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <button
        type="button"
        onClick={() => setHideTools((v) => !v)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-none text-[10px] uppercase tracking-[0.15em] font-bold transition-all ${
          hideTools
            ? "bg-zinc-900 border border-zinc-800 text-zinc-500"
            : "text-zinc-500 hover:text-white border border-transparent hover:bg-white/5"
        }`}
        title={hideTools ? "Show System Logs" : "Hide System Logs"}
      >
        {hideTools ? <EyeOff size={12} /> : <Eye size={12} />}
        Logs
      </button>

      <div className="relative group/mcp">
        <button
          type="button"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-none text-[10px] uppercase tracking-[0.15em] font-bold text-zinc-500 hover:text-white border border-transparent hover:bg-white/5 transition-all"
          title="Connected MCP tools"
        >
          <Wrench size={12} />
          MCP
        </button>
        <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/mcp:block z-50">
          <div className="bg-zinc-950 border border-zinc-800 shadow-2xl p-3 w-60">
            <p className="text-[9px] uppercase tracking-[0.2em] font-bold text-zinc-500 mb-3">Active Modules</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2.5">
                <Database size={12} className="text-[var(--nothing-green)] shrink-0" />
                <span className="text-[11px] text-zinc-400 font-mono uppercase">FlowIndex SQL</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Database size={12} className="text-zinc-500 shrink-0" />
                <span className="text-[11px] text-zinc-400 font-mono uppercase">EVM Blockscout SQL</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Code2 size={12} className="text-zinc-500 shrink-0" />
                <span className="text-[11px] text-zinc-400 font-mono uppercase">Cadence Scripts</span>
              </div>
              <div className="flex items-center gap-2.5">
                <Search size={12} className="text-zinc-500 shrink-0" />
                <span className="text-[11px] text-zinc-400 font-mono uppercase">Web Search</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {showShare && (
        <button
          type="button"
          onClick={onShare}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-none text-[10px] uppercase tracking-[0.15em] font-bold text-zinc-500 hover:text-white border border-transparent hover:bg-white/5 transition-all ml-auto"
          title="Share Session"
        >
          <Share2 size={12} />
          Export
        </button>
      )}
    </div>
  );
}

function isFilePart(part: UIMessage["parts"][number]): part is FileUIPart {
  return part.type === "file";
}

function ChatMessage({ message, isStreaming: isMessageStreaming = false, hideTools = false }: { message: UIMessage; isStreaming?: boolean; hideTools?: boolean }) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");
    const files = message.parts
      .filter(isFilePart)
      .map((file, index) => ({
        ...file,
        id: `${message.id}-file-${index}`,
      }));

    return (
      <Message from="user">
        <MessageContent className="!rounded-none !bg-[var(--bg-element)] !border !border-white/5 !px-5 !py-4 !gap-4">
          {files.length > 0 && <AttachmentList files={files} />}
          {text.trim() && <CollapsibleUserMessage text={text} />}
        </MessageContent>
      </Message>
    );
  }

  // Assistant message: group sequential reasoning/tool parts into a ChainOfThought
  const groups: Array<{ type: "process" | "text" | "sources"; parts: any[] }> = [];
  let currentGroup: { type: "process" | "text" | "sources"; parts: any[] } | null = null;

  message.parts.forEach((part) => {
    const isProcess = part.type === "reasoning" || part.type.includes("tool");
    const type = isProcess ? "process" : "text";

    if (currentGroup && currentGroup.type === type) {
      currentGroup.parts.push(part);
    } else {
      currentGroup = { type, parts: [part] };
      groups.push(currentGroup);
    }
  });

  return (
    <Message from="assistant">
      <div className="flex gap-3">
        <div className="shrink-0 mt-1.5">
          <ChatBotIcon size={22} className="text-[var(--flow-green)]" />
        </div>
        <MessageContent className="prose-nothing w-full">
          {groups.map((group, gIdx) => {
            if (group.type === "process") {
              if (hideTools) return null;
              return (
                <ChainOfThought key={gIdx} className="mb-4 border-l border-white/5 pl-4 ml-1">
                  <ChainOfThoughtHeader className="!text-[10px] !uppercase !tracking-[0.2em] !font-bold !text-zinc-500 py-1">
                    System Intelligence Process
                  </ChainOfThoughtHeader>
                  <ChainOfThoughtContent className="!mt-3 space-y-3">
                    {group.parts.map((part, pIdx) => {
                      if (part.type === "reasoning") {
                        return (
                          <ChainOfThoughtStep
                            key={pIdx}
                            label="Reasoning"
                            status={isMessageStreaming ? "active" : "complete"}
                            className="text-zinc-400 font-mono text-[12px]"
                          >
                            <div className="bg-zinc-950/50 p-3 border border-white/5 rounded-none mt-1">
                              {part.reasoning}
                            </div>
                          </ChainOfThoughtStep>
                        );
                      }

                      const toolPart = part as any;
                      const name = toolPart.toolName ?? toolPart.type?.split("-").slice(1).join("-") ?? "";
                      const toolDone = toolPart.state === "output-available" || toolPart.state === "result";
                      const toolErr = toolPart.state === "output-error";

                      if (name === "createChart") {
                        return (
                          <ChainOfThoughtStep key={pIdx} label="Visualization Engine" status={toolDone ? "complete" : "active"}>
                             <ChartToolPart part={toolPart} />
                          </ChainOfThoughtStep>
                        );
                      }
                      if (name === "run_cadence") {
                        return (
                          <ChainOfThoughtStep key={pIdx} label="Cadence Execution" status={toolDone ? "complete" : "active"}>
                            <CadenceToolPart part={toolPart} />
                          </ChainOfThoughtStep>
                        );
                      }
                      if (name === "run_sql" || name === "runSQL" || name === "run_flowindex_sql" || name === "run_evm_sql") {
                        return (
                          <ChainOfThoughtStep key={pIdx} label="SQL Query Engine" status={toolDone ? "complete" : "active"}>
                            <SqlToolPart part={toolPart} />
                          </ChainOfThoughtStep>
                        );
                      }

                      // Generic tool or web search
                      const label = name.startsWith("web_search") ? "Web Search" : name.toUpperCase().replace(/_/g, " ");
                      return (
                        <ChainOfThoughtStep key={pIdx} label={label} status={toolDone ? "complete" : (toolErr ? "complete" : "active")}>
                          <div className="mt-1 border border-white/5 bg-zinc-950/30 p-2 rounded-none">
                            <div className="flex items-center gap-2 text-[10px] uppercase font-bold text-zinc-600">
                               {toolDone ? <Check size={10} className="text-[var(--nothing-green)]" /> : toolErr ? <X size={10} className="text-red-500" /> : <Loader2 size={10} className="animate-spin" />}
                               {toolDone ? "Completed" : toolErr ? "Failed" : "In Progress..."}
                            </div>
                            {toolDone && (
                               <div className="mt-1 text-[11px] text-zinc-500 font-mono truncate">
                                 {typeof toolPart.output === "string" ? toolPart.output.slice(0, 100) : JSON.stringify(toolPart.output).slice(0, 100)}...
                               </div>
                            )}
                          </div>
                        </ChainOfThoughtStep>
                      );
                    })}
                  </ChainOfThoughtContent>
                </ChainOfThought>
              );
            }

            // group.type === "text"
            return group.parts.map((part, pIdx) => {
              if (part.type !== "text" || !part.text?.trim()) return null;
              const isCompaction = (part.providerMetadata?.anthropic as { type?: string } | undefined)?.type === "compaction";
              if (isCompaction) {
                return (
                  <div
                    key={`${gIdx}-${pIdx}`}
                    className="flex items-center gap-2 py-2 px-3 my-2 text-[10px] uppercase font-bold tracking-widest text-zinc-500 bg-zinc-900 border border-white/5 rounded-none"
                  >
                    <Sparkles size={10} className="shrink-0" />
                    <span>Memory Optimized</span>
                  </div>
                );
              }
              return <MessageResponse key={`${gIdx}-${pIdx}`} streaming={isMessageStreaming}>{part.text}</MessageResponse>;
            });
          })}

          {/* Render Sources at the end if any */}
          {(() => {
            const sources: { title: string; url: string }[] = [];
            for (const part of message.parts) {
              const toolPart = part as any;
              if (
                (part.type === "tool-invocation" || part.type === "dynamic-tool" || part.type.startsWith("tool-")) &&
                (toolPart.toolName === "web_search" || toolPart.toolName === "web_search_20250305")
              ) {
                const output = toolPart.output ?? toolPart.result;
                if (output) {
                  const items = Array.isArray(output) ? output : output.results || output.search_results || [];
                  for (const item of items) {
                    if (item.url && item.title) {
                      sources.push({ title: item.title, url: item.url });
                    }
                  }
                }
              }
            }
            if (sources.length === 0) return null;
            const unique = [...new Map(sources.map((s) => [s.url, s])).values()];
            return (
              <Sources className="mt-4 pt-4 border-t border-white/5">
                <SourcesTrigger count={unique.length} className="!text-[10px] !uppercase !tracking-widest !font-bold !text-zinc-500" />
                <SourcesContent className="!bg-zinc-950 !border-white/5 !rounded-none">
                  {unique.map((s) => (
                    <Source key={s.url} href={s.url} title={s.title} className="!text-zinc-400 hover:!text-white" />
                  ))}
                </SourcesContent>
              </Sources>
            );
          })()}
        </MessageContent>
      </div>
    </Message>
  );
}

function ChartToolPart({ part }: { part: any }) {
  const isDone =
    part.state === "output-available" || part.state === "result";

  if (!isDone) {
    return (
      <div className="flex items-center gap-2 py-1.5 px-2.5 my-1 text-[11px] text-zinc-500 bg-white/[0.03] border border-white/5 rounded-sm">
        <Loader2 size={10} className="animate-spin" />
        <span>Creating chart...</span>
      </div>
    );
  }

  return <ChartArtifact data={part.output} />;
}

function SqlToolPart({ part }: { part: any }) {
  const toolName = part.toolName ?? part.type?.split("-").slice(1).join("-") ?? "";
  if (toolName !== "runSQL" && toolName !== "run_sql" && toolName !== "run_flowindex_sql" && toolName !== "run_evm_sql") return null;

  const isDone = part.state === "output-available" || part.state === "result";
  const isError = part.state === "output-error";
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;
  const hasData = result?.rows && result?.columns;
  const sql: string | undefined = (part.input?.sql as string) ?? (part.args?.sql as string);
  const isEvm = toolName === "run_evm_sql";

  return (
    <Sandbox className="border-white/5 bg-black !rounded-none !mb-4">
      <SandboxHeader
        title={isEvm ? "EVM DATA_STREAM" : "FLOWINDEX DATA_STREAM"}
        state={part.state}
        className="px-4 py-2.5 bg-zinc-950/50"
      />
      <SandboxContent>
        <SandboxTabs defaultValue="result">
          <SandboxTabsBar className="bg-zinc-950/80">
            <SandboxTabsList>
              <SandboxTabsTrigger value="query" className="text-[10px] uppercase tracking-widest px-4 py-2">Query</SandboxTabsTrigger>
              <SandboxTabsTrigger value="result" className="text-[10px] uppercase tracking-widest px-4 py-2">Result</SandboxTabsTrigger>
            </SandboxTabsList>
          </SandboxTabsBar>
          <SandboxTabContent value="query">
            <div className="p-0">
              <SyntaxHighlighter
                language="sql"
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: "16px", fontSize: "12px", lineHeight: "1.6", background: "#050505", borderRadius: 0 }}
                wrapLongLines
              >
                {sql || ""}
              </SyntaxHighlighter>
            </div>
          </SandboxTabContent>
          <SandboxTabContent value="result">
            <div className="min-h-[100px]">
              {hasError && (
                <div className="px-4 py-3 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 m-4">
                  {isError ? (part.errorText || "Query failed") : result?.error}
                </div>
              )}
              {hasData && <SqlResultTable result={result} className="border-0" />}
              {!isDone && !isError && (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-600 gap-3">
                  <Loader2 size={24} className="animate-spin text-[var(--nothing-green)]" />
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold">Executing Query...</span>
                </div>
              )}
              {isDone && !hasError && !hasData && (
                <div className="py-12 text-center text-[10px] text-zinc-600 uppercase tracking-widest font-bold">
                  Zero Rows Returned
                </div>
              )}
            </div>
          </SandboxTabContent>
        </SandboxTabs>
      </SandboxContent>
    </Sandbox>
  );
}

function CadenceToolPart({ part }: { part: any }) {
  const isDone = part.state === "output-available" || part.state === "result";
  const isError = part.state === "output-error";
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;
  const script: string | undefined = (part.input?.script as string) ?? (part.args?.script as string);

  return (
    <Sandbox className="border-white/5 bg-black !rounded-none !mb-4">
      <SandboxHeader
        title="CADENCE MODULE"
        state={part.state}
        className="px-4 py-2.5 bg-zinc-950/50"
      />
      <SandboxContent>
        <SandboxTabs defaultValue="result">
          <SandboxTabsBar className="bg-zinc-950/80">
            <SandboxTabsList>
              <SandboxTabsTrigger value="script" className="text-[10px] uppercase tracking-widest px-4 py-2">Script</SandboxTabsTrigger>
              <SandboxTabsTrigger value="result" className="text-[10px] uppercase tracking-widest px-4 py-2">Output</SandboxTabsTrigger>
            </SandboxTabsList>
          </SandboxTabsBar>
          <SandboxTabContent value="script">
            <div className="p-0">
              <SyntaxHighlighter
                language="swift"
                style={vscDarkPlus}
                customStyle={{ margin: 0, padding: "16px", fontSize: "12px", lineHeight: "1.6", background: "#050505", borderRadius: 0 }}
                wrapLongLines
              >
                {script || ""}
              </SyntaxHighlighter>
            </div>
          </SandboxTabContent>
          <SandboxTabContent value="result">
            <div className="min-h-[100px]">
              {hasError && (
                <div className="px-4 py-3 text-[12px] text-red-400 bg-red-500/10 border border-red-500/20 m-4">
                  {isError ? (part.errorText || "Script failed") : result?.error}
                </div>
              )}
              {isDone && !hasError && result?.result && (
                <div className="px-4 py-3 text-[12px] text-zinc-300 bg-zinc-900 border border-white/5 m-4 font-mono whitespace-pre-wrap">
                  {typeof result.result === "string" ? result.result : JSON.stringify(result.result, null, 2)}
                </div>
              )}
              {!isDone && !isError && (
                <div className="flex flex-col items-center justify-center py-12 text-zinc-600 gap-3">
                  <Loader2 size={24} className="animate-spin text-purple-400" />
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold">Running Script...</span>
                </div>
              )}
            </div>
          </SandboxTabContent>
        </SandboxTabs>
      </SandboxContent>
    </Sandbox>
  );
}

