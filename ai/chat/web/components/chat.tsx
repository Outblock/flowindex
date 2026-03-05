"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useState, useCallback, useRef, useEffect } from "react";
import {
  Database,
  BarChart3,
  Clock,
  Coins,
  Code2,
  Layers,
  Sparkles,
  ChevronDown,
  Maximize2,
  Paperclip,
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
  PromptInputTools,
  PromptInputButton,
  PromptInputActionMenu,
  PromptInputActionMenuTrigger,
  PromptInputActionMenuContent,
  PromptInputActionAddAttachments,
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
  ModelSelector,
  useModelSelector,
  type ChatMode,
} from "./model-selector";

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
  const { messages, sendMessage, status, stop } = useChat({
    body: { mode },
  });
  const [input, setInput] = useState("");

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
                />
              ))}
              {/* Pending indicator: avatar + shimmer while waiting for first token */}
              {(status === "streaming" || status === "submitted") &&
                messages.length > 0 &&
                messages[messages.length - 1].role === "user" && (
                  <Message from="assistant">
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        <FlowLogo size={22} />
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="h-4 w-32 rounded animate-shimmer" />
                        <div className="h-4 w-20 rounded animate-shimmer [animation-delay:0.3s]" />
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
              <PromptInputTools>
                <PromptInputActionMenu>
                  <PromptInputActionMenuTrigger
                    tooltip="Attach"
                    className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                  >
                    <Paperclip size={15} />
                  </PromptInputActionMenuTrigger>
                  <PromptInputActionMenuContent>
                    <PromptInputActionAddAttachments label="Upload image" />
                  </PromptInputActionMenuContent>
                </PromptInputActionMenu>
                <ModelSelector mode={mode} onSelect={selectMode} />
              </PromptInputTools>
              <PromptInputSubmit
                status={status}
                onStop={stop}
                className="!rounded-lg !bg-[var(--flow-green)] !text-black hover:!bg-[var(--flow-green-dim)] !size-7 !transition-all !duration-200"
              />
            </PromptInputFooter>
          </PromptInput>
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

function ChatMessage({ message, isStreaming: isMessageStreaming = false }: { message: UIMessage; isStreaming?: boolean }) {
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
              part.type === "dynamic-tool" ||
              part.type.startsWith("tool-")
            ) {
              const toolPart = part as any;
              const name =
                toolPart.toolName ??
                toolPart.type.split("-").slice(1).join("-");
              if (name === "createChart") {
                return <ChartToolPart key={i} part={toolPart} />;
              }
              if (name === "run_cadence") {
                return <CadenceToolPart key={i} part={toolPart} />;
              }
              return <SqlToolPart key={i} part={toolPart} />;
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

  const toolName = part.toolName ?? part.type.split("-").slice(1).join("-");
  if (toolName !== "runSQL" && toolName !== "run_sql") return null;

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
