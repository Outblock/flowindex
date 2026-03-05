"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { UIMessage } from "ai";
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
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

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
  Tool,
  ToolHeader,
  ToolContent,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  CodeBlock,
  CodeBlockHeader,
  CodeBlockTitle,
  CodeBlockFilename,
  CodeBlockActions,
  CodeBlockCopyButton,
} from "@/components/ai-elements/code-block";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import {
  Sources,
  SourcesTrigger,
  SourcesContent,
  Source,
} from "@/components/ai-elements/sources";
import { useArtifactPanel } from "@/components/artifact-panel";

import { SqlResultTable } from "./sql-result-table";
import { ChartArtifact } from "./chart-artifact";
import { FlowLogo } from "./flow-logo";
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

const SQL_INLINE_MAX_ROWS = 5;
const CADENCE_INLINE_MAX_LINES = 10;

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

export function Chat() {
  const { mode, selectMode } = useModelSelector();
  const modeRef = useRef(mode);
  modeRef.current = mode;

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
  const [input, setInput] = useState("");
  const [hideTools, setHideTools] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      sendMessage({ text });
      setInput("");
    },
    [sendMessage]
  );

  return (
    <div className="flex h-full flex-col">
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto max-w-3xl px-6 py-8">
          {messages.length === 0 ? (
            <ConversationEmptyState>
              {/* Logo with glow */}
              <div className="relative mb-8">
                <div className="absolute inset-0 blur-2xl opacity-20 bg-[var(--flow-green)] rounded-full scale-150" />
                <FlowLogo size={56} className="relative" />
              </div>

              <h1 className="text-[28px] font-semibold tracking-tight text-foreground mb-2">
                FlowIndex AI
              </h1>
              <p className="text-[13px] text-[var(--text-tertiary)] mb-10 max-w-sm text-center leading-relaxed">
                Query the Flow blockchain with natural language — SQL and
                Cadence.
              </p>

              {/* Suggestion grid */}
              <div className="grid grid-cols-2 gap-2.5 w-full max-w-md">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.text}
                    onClick={() => handleSend(s.text)}
                    className="group flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-panel)] px-4 py-3.5 text-left transition-all duration-200 hover:border-[var(--border-strong)] hover:bg-[var(--bg-element)] cursor-pointer"
                  >
                    <s.icon
                      size={16}
                      className="mt-0.5 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--flow-green)] transition-colors duration-200"
                    />
                    <span className="text-[12.5px] leading-snug text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors duration-200">
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
                        <FlowLogo size={22} />
                      </div>
                      <div
                        className="inline-block bg-clip-text animate-shine text-[13px]"
                        style={{
                          backgroundImage: "linear-gradient(120deg, rgba(255,255,255,0.3) 40%, #1c9c4d 50%, rgba(255,255,255,0.3) 60%)",
                          backgroundSize: "200% 100%",
                          WebkitBackgroundClip: "text",
                          backgroundClip: "text",
                          WebkitTextFillColor: "transparent",
                          color: "transparent",
                        }}
                      >
                        Thinking...
                      </div>
                    </div>
                  </Message>
                )}
            </>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => { e.target.value = ''; }}
      />

      {/* Input area */}
      <div className="prompt-input-flow pb-4 pt-2 px-6">
        <div className="mx-auto max-w-3xl">
          <PromptInput
            onSubmit={({ text }) => handleSend(text)}
            accept="image/*"
            multiple
          >
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about Flow — blocks, transactions, Cadence scripts..."
              className="!min-h-12 !py-3.5 !text-[13.5px] placeholder:text-[var(--text-tertiary)]"
              autoFocus
            />
            <PromptInputFooter className="!pb-2.5 !pt-0">
              <PromptInputSubmit
                status={status}
                onStop={stop}
                className="!rounded-lg !bg-[var(--flow-green)] !text-black hover:!bg-[var(--flow-green-dim)] !size-7 !transition-all !duration-200"
              />
            </PromptInputFooter>
          </PromptInput>

          {/* Bottom row: attach + mode selector + tools + MCP */}
          <div className="flex items-center gap-1.5 mt-1.5">
            {/* + attach button */}
            <div className="relative group/attach">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-7 h-7 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-white/10 rounded-sm transition-colors border border-transparent hover:border-white/10"
                title="Attach image or PDF"
              >
                <Plus size={13} />
              </button>
              <div className="absolute bottom-full left-0 mb-1 hidden group-hover/attach:block z-50 pointer-events-none">
                <div className="bg-zinc-700 text-white text-[10px] px-2 py-1 rounded whitespace-nowrap">
                  Upload images or PDFs
                </div>
              </div>
            </div>

            {/* Mode selector dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-all bg-amber-500/10 border border-amber-500/30 text-amber-500 hover:bg-amber-500/20"
                >
                  {(() => {
                    const current = CHAT_MODES.find(m => m.key === mode) || CHAT_MODES[0];
                    const CurrentIcon = current.icon;
                    return <><CurrentIcon size={10} />{current.label}</>;
                  })()}
                  <ChevronUp size={8} className="ml-0.5 opacity-60" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="start" className="min-w-[200px] z-[80] bg-zinc-900 border border-white/10 shadow-lg p-1">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest text-zinc-400 px-2 py-1">Model</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-white/10" />
                {CHAT_MODES.map(({ key, label, icon: Icon, desc, model }) => (
                  <DropdownMenuItem
                    key={key}
                    onSelect={() => selectMode(key)}
                    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-sm cursor-pointer transition-colors ${
                      mode === key
                        ? 'bg-[var(--flow-green)]/10 text-[var(--flow-green)]'
                        : 'text-zinc-300'
                    }`}
                  >
                    <Icon size={14} className="shrink-0" />
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium leading-tight">{label}</span>
                      <span className={`text-[10px] leading-tight ${mode === key ? 'text-[var(--flow-green)]/60' : 'text-zinc-500'}`}>{model} · {desc}</span>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* TOOLS toggle */}
            <button
              type="button"
              onClick={() => setHideTools(v => !v)}
              className={`flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold transition-all ${
                hideTools
                  ? 'bg-zinc-500/10 border border-zinc-500/30 text-zinc-500'
                  : 'text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] border border-transparent hover:border-white/10'
              }`}
              title={hideTools ? 'Show tool calls' : 'Hide tool calls'}
            >
              {hideTools ? <EyeOff size={10} /> : <Eye size={10} />}
              Tools
            </button>

            {/* MCP hover popover */}
            <div className="relative group/mcp">
              <button
                type="button"
                className="flex items-center gap-1 px-2 py-1 rounded-sm text-[10px] uppercase tracking-widest font-bold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] border border-transparent hover:border-white/10 transition-all"
                title="Connected MCP tools"
              >
                <Wrench size={10} />
                MCP
              </button>
              <div className="absolute bottom-full left-0 mb-1.5 hidden group-hover/mcp:block z-50">
                <div className="bg-zinc-900 border border-white/10 rounded-sm shadow-xl p-2.5 w-56">
                  <p className="text-[9px] uppercase tracking-widest font-bold text-zinc-400 mb-2">Connected Tools</p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Database size={10} className="text-[var(--flow-green)] shrink-0" />
                      <span className="text-[11px] text-zinc-300">FlowIndex SQL</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Database size={10} className="text-blue-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">EVM Blockscout SQL</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Code2 size={10} className="text-purple-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">Cadence Scripts</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Code2 size={10} className="text-purple-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">Cadence Check & Docs</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Bot size={10} className="text-orange-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">EVM RPC (Chain 747)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Search size={10} className="text-amber-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">Web Search</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ChevronRight size={10} className="text-cyan-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">API Fetch</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Download size={10} className="text-pink-400 shrink-0" />
                      <span className="text-[11px] text-zinc-300">Charts</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
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

function ChatMessage({ message, isStreaming: isMessageStreaming = false, hideTools = false }: { message: UIMessage; isStreaming?: boolean; hideTools?: boolean }) {
  if (message.role === "user") {
    const text = message.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text)
      .join("");

    return (
      <Message from="user">
        <MessageContent className="!rounded-2xl !bg-[var(--bg-element)] !px-4 !py-3">
          <CollapsibleUserMessage text={text} />
        </MessageContent>
      </Message>
    );
  }

  return (
    <Message from="assistant">
      <div className="flex gap-3">
        <div className="shrink-0 mt-1.5">
          <FlowLogo size={22} />
        </div>
        <MessageContent>
          {message.parts.map((part, i) => {
            if (part.type === "reasoning") {
              const reasoningPart = part as any;
              return (
                <Reasoning key={i} isStreaming={isMessageStreaming && !!reasoningPart.reasoning}>
                  <ReasoningTrigger />
                  <ReasoningContent>{reasoningPart.reasoning || ""}</ReasoningContent>
                </Reasoning>
              );
            }

            if (part.type === "text") {
              if (!part.text.trim()) return null;
              return <MessageResponse key={i}>{part.text}</MessageResponse>;
            }

            if (
              part.type === "tool-invocation" ||
              part.type === "dynamic-tool" ||
              part.type.startsWith("tool-")
            ) {
              if (hideTools) return null;
              const toolPart = part as any;
              const name =
                toolPart.toolName ??
                toolPart.type?.split("-").slice(1).join("-") ?? "";
              if (name === "createChart") {
                return <ChartToolPart key={i} part={toolPart} />;
              }
              if (name === "run_cadence") {
                return <CadenceToolPart key={i} part={toolPart} />;
              }
              if (name === "run_sql" || name === "runSQL" || name === "run_flowindex_sql" || name === "run_evm_sql") {
                return <SqlToolPart key={i} part={toolPart} />;
              }
              // web_search / fetch_api — compact status line
              if (name === "web_search" || name === "web_search_20250305" || name === "fetch_api") {
                const label = name.startsWith("web_search") ? "Searching the web" : `Fetching ${toolPart.args?.url || toolPart.input?.url || "API"}`;
                const done = toolPart.state === "output-available" || toolPart.state === "result";
                const err = toolPart.state === "output-error";
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 px-2.5 my-1 text-[11px] text-zinc-500 bg-white/[0.03] border border-white/5 rounded-sm">
                    {!done && !err ? (
                      <span className="inline-block w-2.5 h-2.5 border border-zinc-400 border-t-transparent rounded-full animate-spin" />
                    ) : err ? (
                      <span className="text-red-400 text-[10px]">✕</span>
                    ) : (
                      <Search size={10} className="text-[var(--flow-green)]" />
                    )}
                    <span className="truncate">{done ? (name.startsWith("web_search") ? "Web search complete" : "Fetched API") : label}...</span>
                  </div>
                );
              }
              // Generic tool fallback — expandable details
              const toolDone = toolPart.state === "output-available" || toolPart.state === "result";
              const toolErr = toolPart.state === "output-error";
              const toolOutput = toolDone ? toolPart.output : toolErr ? (toolPart.errorText || "Tool call failed") : null;
              const toolInput = toolPart.input ?? toolPart.args;
              const hasDetails = toolInput || toolOutput;
              const friendlyName = name.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase());
              const inputSummary = toolInput
                ? typeof toolInput === "string"
                  ? toolInput.slice(0, 60)
                  : (() => { const s = JSON.stringify(toolInput); return s.length > 80 ? s.slice(0, 77) + "..." : s; })()
                : "";
              const truncateOutput = (v: unknown) => {
                const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
                return s.length > 2000 ? s.slice(0, 2000) + "\n...[truncated]" : s;
              };
              return (
                <details key={i} className="my-1 rounded-sm border border-white/5 overflow-hidden">
                  <summary className="flex items-center gap-2 py-1.5 px-2.5 text-[11px] text-zinc-400 bg-white/[0.02] cursor-pointer hover:bg-white/[0.04] select-none">
                    {!toolDone && !toolErr ? (
                      <span className="inline-block w-2.5 h-2.5 border border-zinc-400 border-t-transparent rounded-full animate-spin shrink-0" />
                    ) : toolErr ? (
                      <span className="text-red-400 text-[10px] shrink-0">✕</span>
                    ) : (
                      <span className="text-[var(--flow-green)] text-[10px] shrink-0">✓</span>
                    )}
                    <span className="font-bold truncate">{friendlyName}</span>
                    {inputSummary && <span className="text-zinc-500 truncate ml-1 font-mono text-[10px]">{inputSummary}</span>}
                  </summary>
                  {hasDetails && (
                    <div className="px-3 py-2 text-[11px] font-mono space-y-1.5 bg-zinc-900 text-zinc-400 max-h-[200px] overflow-auto">
                      {toolInput && (
                        <div>
                          <span className="text-zinc-500">Input: </span>
                          <pre className="whitespace-pre-wrap break-words text-zinc-300">{typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput, null, 2)}</pre>
                        </div>
                      )}
                      {toolOutput && (
                        <div>
                          <span className="text-zinc-500">Output: </span>
                          <pre className={`whitespace-pre-wrap break-words ${toolErr ? "text-red-400" : "text-zinc-300"}`}>{truncateOutput(toolOutput)}</pre>
                        </div>
                      )}
                    </div>
                  )}
                </details>
              );
            }

            return null;
          })}
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
              <Sources>
                <SourcesTrigger count={unique.length} />
                <SourcesContent>
                  {unique.map((s) => (
                    <Source key={s.url} href={s.url} title={s.title} />
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
  const { openArtifact } = useArtifactPanel();
  const hasAutoOpened = useRef(false);

  useEffect(() => {
    if (isDone && part.output && !hasAutoOpened.current) {
      hasAutoOpened.current = true;
      openArtifact({
        type: "chart",
        title: part.output.title || "Chart",
        data: part.output,
      });
    }
  }, [isDone, openArtifact, part.output]);

  if (!isDone) {
    return (
      <Tool>
        <ToolHeader
          title="Creating Chart"
          type={part.type}
          state={part.state}
          toolName="createChart"
        />
      </Tool>
    );
  }

  return <ChartArtifact data={part.output} />;
}

function SqlToolPart({ part }: { part: any }) {
  const { openArtifact } = useArtifactPanel();

  const toolName = part.toolName ?? part.type?.split("-").slice(1).join("-") ?? "";
  if (toolName !== "runSQL" && toolName !== "run_sql" && toolName !== "run_flowindex_sql" && toolName !== "run_evm_sql") return null;

  const isDone =
    part.state === "output-available" || part.state === "result";
  const isError = part.state === "output-error";
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;
  const hasData = result?.rows && result?.columns;

  const sql: string | undefined =
    (part.input?.sql as string) ?? (part.args?.sql as string);

  return (
    <div className="space-y-3">
      <Tool>
        <ToolHeader
          title="SQL Query"
          type={part.type}
          state={part.state}
          toolName={toolName}
        />
        <ToolContent>
          {sql && (
            <CodeBlock code={sql} language="sql">
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <CodeBlockFilename>query.sql</CodeBlockFilename>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
          )}
          {hasError && (
            <ToolOutput
              output={null}
              errorText={
                isError
                  ? part.errorText || "Query execution failed"
                  : result?.error
              }
            />
          )}
        </ToolContent>
      </Tool>

      {hasData && (
        <div className="animate-in slide-in-from-top-2">
          {result.rows.length > SQL_INLINE_MAX_ROWS ? (
            <div className="rounded-lg border border-[var(--border-subtle)] overflow-hidden">
              <div className="flex items-center justify-between px-3.5 py-2.5 bg-[var(--bg-element)]/40">
                <span className="text-[11px] text-[var(--text-tertiary)] font-medium tabular-nums">
                  {result.rows.length} rows &middot; {result.columns.length} columns
                </span>
                <button
                  onClick={() =>
                    openArtifact({
                      type: "sql",
                      title: "SQL Query Result",
                      data: result,
                    })
                  }
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[var(--flow-green)] hover:text-[var(--flow-green-dim)] bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-md hover:border-[var(--flow-green)]/30 transition-all duration-150 cursor-pointer"
                >
                  <Maximize2 size={12} />
                  Open in panel
                </button>
              </div>
              <SqlResultTable result={{ columns: result.columns, rows: result.rows.slice(0, SQL_INLINE_MAX_ROWS) }} />
            </div>
          ) : (
            <SqlResultTable result={result} />
          )}
        </div>
      )}
    </div>
  );
}

function CadenceToolPart({ part }: { part: any }) {
  const { openArtifact } = useArtifactPanel();

  const isDone =
    part.state === "output-available" || part.state === "result";
  const isError = part.state === "output-error";
  const result = isDone ? part.output : null;
  const hasError = isError || result?.error;

  const script: string | undefined =
    (part.input?.script as string) ?? (part.args?.script as string);

  return (
    <div className="space-y-3">
      <Tool>
        <ToolHeader
          title="Cadence Script"
          type={part.type}
          state={part.state}
          toolName="run_cadence"
        />
        <ToolContent>
          {script && (
            <CodeBlock code={script} language="swift">
              <CodeBlockHeader>
                <CodeBlockTitle>
                  <CodeBlockFilename>script.cdc</CodeBlockFilename>
                </CodeBlockTitle>
                <CodeBlockActions>
                  <CodeBlockCopyButton />
                </CodeBlockActions>
              </CodeBlockHeader>
            </CodeBlock>
          )}
          {hasError && (
            <ToolOutput
              output={null}
              errorText={
                isError
                  ? part.errorText || "Script execution failed"
                  : result?.error
              }
            />
          )}
          {isDone && !hasError && result?.result && (() => {
            const outputStr = JSON.stringify(result.result, null, 2);
            const lineCount = outputStr.split("\n").length;
            if (lineCount > CADENCE_INLINE_MAX_LINES) {
              return (
                <div className="flex items-center justify-between px-3 py-2 bg-[var(--bg-element)]/40 rounded-md">
                  <span className="text-[11px] text-[var(--text-tertiary)]">
                    Output: {lineCount} lines
                  </span>
                  <button
                    onClick={() =>
                      openArtifact({
                        type: "cadence",
                        title: "Cadence Script Result",
                        data: { script: script || "", result: result.result },
                      })
                    }
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-[var(--flow-green)] hover:text-[var(--flow-green-dim)] bg-[var(--bg-panel)] border border-[var(--border-subtle)] rounded-md hover:border-[var(--flow-green)]/30 transition-all duration-150 cursor-pointer"
                  >
                    <Maximize2 size={12} />
                    Open in panel
                  </button>
                </div>
              );
            }
            return <ToolOutput output={outputStr} errorText={undefined} />;
          })()}
        </ToolContent>
      </Tool>
    </div>
  );
}
