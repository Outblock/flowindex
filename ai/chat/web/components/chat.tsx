"use client";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { useState, useCallback } from "react";
import {
  Database,
  BarChart3,
  Clock,
  Coins,
  Code2,
  Layers,
  Sparkles,
} from "lucide-react";

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

import { SqlResultTable } from "./sql-result-table";
import { ChartArtifact } from "./chart-artifact";
import { FlowLogo } from "./flow-logo";

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
  const { messages, sendMessage, status, stop } = useChat();
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
                Flow AI
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
            messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>

      {/* Input area */}
      <div className="prompt-input-flow pb-4 pt-2 px-6">
        <div className="mx-auto max-w-3xl">
          <PromptInput onSubmit={({ text }) => handleSend(text)}>
            <PromptInputTextarea
              value={input}
              onChange={(e) => setInput(e.currentTarget.value)}
              placeholder="Ask about Flow — blocks, transactions, Cadence scripts..."
              className="!min-h-12 !py-3.5 !text-[13.5px] placeholder:text-[var(--text-tertiary)]"
              autoFocus
            />
            <PromptInputFooter className="!pb-2.5 !pt-0">
              <div className="flex items-center gap-1.5">
                <Sparkles size={11} className="text-[var(--text-tertiary)]" />
                <span className="text-[10.5px] text-[var(--text-tertiary)]">
                  Powered by Claude &middot; Results may be inaccurate
                </span>
              </div>
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

function ChatMessage({ message }: { message: UIMessage }) {
  if (message.role === "user") {
    return (
      <Message from="user">
        <MessageContent className="!rounded-2xl !bg-[var(--bg-element)] !px-4 !py-3">
          {message.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text)
            .join("")}
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
          <SqlResultTable result={result} />
        </div>
      )}
    </div>
  );
}

function CadenceToolPart({ part }: { part: any }) {
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
          {isDone && !hasError && result?.result && (
            <ToolOutput output={JSON.stringify(result.result, null, 2)} errorText={undefined} />
          )}
        </ToolContent>
      </Tool>
    </div>
  );
}
