import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import {
  Bot, X, Send, Copy, Check, ReplaceAll, ChevronLeft, ChevronRight,
  Coins, Image, Search, SendHorizonal, Sparkles, Zap, Loader2,
  Wrench, Trash2, Square,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { TEMPLATES, type Template } from '../fs/fileSystem';

const AI_CHAT_URL = import.meta.env.VITE_AI_CHAT_URL || 'https://ai.flowindex.io';

interface AIPanelProps {
  onInsertCode: (code: string) => void;
  onLoadTemplate: (template: Template) => void;
  editorCode?: string;
  network?: string;
  onClose?: () => void;
}

const PRESET_PROMPTS = [
  { label: 'Create a Fungible Token', icon: Coins, prompt: 'Write a complete Cadence 1.0 Fungible Token contract that implements FungibleToken standard with mint, burn and transfer capabilities.' },
  { label: 'Create an NFT Collection', icon: Image, prompt: 'Write a complete Cadence 1.0 NFT contract that implements NonFungibleToken and MetadataViews standards with mint function and Display view.' },
  { label: 'Query an account balance', icon: Search, prompt: 'Write a Cadence script to query the FLOW token balance of any address using FungibleToken.Balance capability.' },
  { label: 'Send FLOW tokens', icon: SendHorizonal, prompt: 'Write a Cadence transaction to transfer FLOW tokens from the signer to a recipient address.' },
  { label: 'Fix my code', icon: Zap, prompt: 'Please review my current editor code, identify any issues, and provide the fixed version.' },
];

/* ── Code Block with syntax highlighting, copy, and replace ── */

function CodeBlock({ code, language, onInsertCode }: { code: string; language: string; onInsertCode?: (code: string) => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const langMap: Record<string, string> = { cadence: 'swift', cdc: 'swift', sh: 'bash', zsh: 'bash', shell: 'bash', ts: 'typescript', js: 'javascript', py: 'python', yml: 'yaml' };
  const prismLang = langMap[language] || language || 'text';
  const isCadence = language === 'cadence' || language === 'cdc';

  return (
    <div className="rounded border border-zinc-700 overflow-hidden my-2">
      <div className="flex items-center justify-between px-2.5 py-1.5 bg-zinc-800/80 border-b border-zinc-700">
        <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-bold">{language || 'code'}</span>
        <div className="flex items-center gap-1.5">
          {isCadence && onInsertCode && (
            <button
              onClick={() => onInsertCode(code)}
              className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 rounded transition-colors font-medium"
              title="Replace editor content"
            >
              <ReplaceAll className="w-3 h-3" />
              Replace
            </button>
          )}
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors"
            title="Copy to clipboard"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <SyntaxHighlighter
        language={prismLang}
        style={vscDarkPlus}
        customStyle={{ margin: 0, padding: '10px', fontSize: '11px', lineHeight: '1.5', background: '#09090b', borderRadius: 0 }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

/* ── Tool call indicator ── */

function ToolCallIndicator({ toolName, state }: { toolName: string; state: string }) {
  const isDone = state === 'result';
  const labels: Record<string, string> = {
    run_cadence: 'Running Cadence script',
    cadence_check: 'Checking Cadence code',
    search_docs: 'Searching documentation',
    web_search: 'Searching the web',
    fetch_api: 'Fetching data',
    get_doc: 'Reading documentation',
    browse_docs: 'Browsing documentation',
    cadence_hover: 'Getting type info',
    cadence_definition: 'Finding definition',
    cadence_symbols: 'Listing symbols',
    get_contract_source: 'Fetching contract source',
    cadence_security_scan: 'Security scanning',
  };
  const label = labels[toolName] || `Using ${toolName}`;

  return (
    <div className="flex items-center gap-2 py-1 px-2 my-1 rounded bg-zinc-800/50 border border-zinc-700/50">
      {isDone ? (
        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : (
        <Loader2 className="w-3 h-3 text-zinc-400 animate-spin shrink-0" />
      )}
      <Wrench className="w-3 h-3 text-zinc-500 shrink-0" />
      <span className="text-[11px] text-zinc-400">{label}{isDone ? '' : '...'}</span>
    </div>
  );
}

/* ── Markdown components for the runner (dark theme) ── */

function createMarkdownComponents(onInsertCode: (code: string) => void): Components {
  return {
    h1: ({ children }) => <h1 className="text-sm font-bold text-white mt-3 mb-1">{children}</h1>,
    h2: ({ children }) => <h2 className="text-[13px] font-bold text-white mt-3 mb-1">{children}</h2>,
    h3: ({ children }) => <h3 className="text-xs font-bold text-white mt-2 mb-1">{children}</h3>,
    h4: ({ children }) => <h4 className="text-xs font-semibold text-zinc-100 mt-2 mb-0.5">{children}</h4>,
    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
    em: ({ children }) => <em className="italic">{children}</em>,
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-emerald-400 hover:underline">
        {children}
      </a>
    ),
    ul: ({ children }) => <ul className="ml-3 mb-2 space-y-0.5">{children}</ul>,
    ol: ({ children }) => <ol className="ml-3 mb-2 space-y-0.5 list-decimal list-inside">{children}</ol>,
    li: ({ children }) => (
      <li className="flex gap-1.5">
        <span className="text-emerald-500 shrink-0 mt-[1px]">-</span>
        <span className="flex-1">{children}</span>
      </li>
    ),
    blockquote: ({ children }) => (
      <blockquote className="border-l-2 border-emerald-500/40 pl-3 my-2 text-zinc-400 italic">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-3 border-zinc-700" />,
    table: ({ children }) => (
      <div className="overflow-x-auto my-2 rounded border border-zinc-700">
        <table className="w-full text-left border-collapse text-[11px]">{children}</table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-zinc-800/80">{children}</thead>,
    th: ({ children }) => (
      <th className="px-2 py-1.5 text-[10px] font-bold text-zinc-400 uppercase tracking-wider border-b border-zinc-700 whitespace-nowrap">
        {children}
      </th>
    ),
    td: ({ children }) => (
      <td className="px-2 py-1.5 text-zinc-300 border-b border-zinc-800 font-mono">
        {children}
      </td>
    ),
    code: ({ className, children }) => {
      const match = /language-(\w+)/.exec(className || '');
      const lang = match ? match[1] : '';
      const codeString = String(children).replace(/\n$/, '');

      if (lang || codeString.includes('\n')) {
        return <CodeBlock code={codeString} language={lang || 'text'} onInsertCode={onInsertCode} />;
      }

      return (
        <code className="text-[11px] bg-zinc-700/60 px-1 py-0.5 rounded font-mono text-purple-400">
          {children}
        </code>
      );
    },
    pre: ({ children }) => <>{children}</>,
  };
}

/* ── Extract text from UIMessage parts ── */

function getMessageText(msg: { parts: Array<{ type: string; text?: string }> }): string {
  return msg.parts
    .filter((p): p is { type: 'text'; text: string } => p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('');
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function getToolParts(msg: { parts: Array<any> }): Array<any> {
  return msg.parts.filter(
    (p) => p.type === 'tool-invocation'
  );
}

function getReasoningParts(msg: { parts: Array<any> }): Array<any> {
  return msg.parts.filter(
    (p) => p.type === 'reasoning' || p.type === 'thinking'
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ── Collapsible Reasoning Block ── */

function ReasoningBlock({ text }: { text: string }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="rounded border border-amber-500/20 overflow-hidden my-1.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left"
      >
        <ChevronRight className={`w-3 h-3 text-amber-400/60 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        <span className="text-[10px] text-amber-400/70 uppercase tracking-widest font-bold">Thinking</span>
      </button>
      {isOpen && (
        <div className="px-3 py-2 text-[11px] text-zinc-500 leading-relaxed whitespace-pre-wrap border-t border-amber-500/10">
          {text}
        </div>
      )}
    </div>
  );
}

/* ── Main Component ── */

export default function AIPanel({ onInsertCode, onLoadTemplate, editorCode, network, onClose }: AIPanelProps) {
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, stop, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: `${AI_CHAT_URL}/api/runner-chat`,
      body: {
        editorCode: editorCode || '',
        network: network || 'mainnet',
      },
    }),
  });

  const isLoading = status === 'streaming' || status === 'submitted';

  const mdComponents = useCallback(
    () => createMarkdownComponents(onInsertCode),
    [onInsertCode]
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    sendMessage({ text });
  };

  const handlePresetClick = (prompt: string) => {
    if (isLoading) return;
    sendMessage({ text: prompt });
  };

  const handleClear = () => {
    setMessages([]);
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 min-w-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded hover:bg-zinc-800"
              title="Clear chat"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 text-zinc-500 hover:text-zinc-300 transition-colors rounded hover:bg-zinc-800"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="space-y-4 mt-2">
            {/* Welcome */}
            <div className="text-center space-y-1">
              <Sparkles className="w-5 h-5 text-emerald-400 mx-auto" />
              <p className="text-xs text-zinc-300 font-medium">What would you like to build?</p>
              <p className="text-[10px] text-zinc-600">I can see your editor code and help you write Cadence.</p>
            </div>

            {/* Preset prompts */}
            <div className="space-y-1.5">
              {PRESET_PROMPTS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <button
                    key={preset.label}
                    onClick={() => handlePresetClick(preset.prompt)}
                    className="flex items-center gap-2 w-full px-2.5 py-2 rounded-lg bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/50 hover:border-zinc-600 text-left transition-colors group"
                  >
                    <Icon className="w-3.5 h-3.5 text-emerald-500/70 group-hover:text-emerald-400 shrink-0" />
                    <span className="text-[11px] text-zinc-400 group-hover:text-zinc-200">{preset.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Templates */}
            <div className="pt-2 border-t border-zinc-800">
              <p className="text-[10px] text-zinc-600 uppercase tracking-wider font-medium mb-2 px-1">Templates</p>
              <div className="grid grid-cols-2 gap-1.5">
                {TEMPLATES.map((template) => (
                  <button
                    key={template.label}
                    onClick={() => onLoadTemplate(template)}
                    className="flex flex-col gap-0.5 px-2 py-1.5 rounded-md bg-zinc-800/40 hover:bg-zinc-800 border border-zinc-700/30 hover:border-zinc-600 text-left transition-colors"
                    title={template.description}
                  >
                    <span className="text-[10px] text-zinc-300 font-medium leading-tight">{template.label}</span>
                    <span className="text-[9px] text-zinc-600 leading-tight truncate">{template.description}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {messages.map((msg) => {
          const text = getMessageText(msg);
          const toolParts = getToolParts(msg);
          const reasoningParts = getReasoningParts(msg);
          const hasContent = text || toolParts.length > 0 || reasoningParts.length > 0;
          if (!hasContent) return null;

          return (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div
                className={`max-w-[95%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-emerald-700/40 text-zinc-100'
                    : 'bg-zinc-800 text-zinc-200'
                }`}
              >
                {/* Reasoning blocks */}
                {reasoningParts.map((part, i) => (
                  <ReasoningBlock key={`r-${i}`} text={part.reasoning || part.text || ''} />
                ))}

                {/* Tool call indicators */}
                {toolParts.map((part, i) => (
                  <ToolCallIndicator
                    key={`t-${i}`}
                    toolName={part.toolInvocation?.toolName || part.toolName || 'unknown'}
                    state={part.toolInvocation?.state || part.state || 'partial-call'}
                  />
                ))}

                {/* Markdown content */}
                {text && msg.role === 'user' ? (
                  <span className="whitespace-pre-wrap">{text}</span>
                ) : text ? (
                  <div className="ai-markdown">
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents()}>
                      {text}
                    </ReactMarkdown>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role === 'user' && (
          <div className="flex items-start">
            <div className="bg-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-400">
              <span className="inline-flex gap-1">
                <span className="animate-pulse">.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.2s' }}>.</span>
                <span className="animate-pulse" style={{ animationDelay: '0.4s' }}>.</span>
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-zinc-700 p-2 shrink-0">
        <div className="flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about Cadence..."
            className="flex-1 bg-zinc-800 text-zinc-200 text-xs rounded px-3 py-2 border border-zinc-700 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-500 min-w-0"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={() => stop()}
              className="p-2 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
              title="Stop generating"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="p-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
