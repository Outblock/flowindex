import { useState, useRef, useEffect } from 'react';
import { useChat } from '@ai-sdk/react';
import { Bot, X, Send, Code, ChevronRight } from 'lucide-react';

const AI_CHAT_URL = import.meta.env.VITE_AI_CHAT_URL || 'https://ai.flowindex.io';

interface AIPanelProps {
  onInsertCode: (code: string) => void;
}

/** Extract code blocks from markdown-like text. Returns segments of text and code. */
function parseCodeBlocks(text: string): Array<{ type: 'text' | 'code'; content: string; lang?: string }> {
  const parts: Array<{ type: 'text' | 'code'; content: string; lang?: string }> = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({ type: 'code', content: match[2].trimEnd(), lang: match[1] || undefined });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  return parts.length === 0 ? [{ type: 'text', content: text }] : parts;
}

export default function AIPanel({ onInsertCode }: AIPanelProps) {
  const [open, setOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading } = useChat({
    api: `${AI_CHAT_URL}/api/chat`,
    initialMessages: [],
    body: {
      system: 'You are a Cadence programming assistant. Help write Flow blockchain scripts and transactions. Keep answers concise and include code examples when helpful.',
    },
  });

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-center w-10 h-full bg-zinc-900 border-r border-zinc-700 hover:bg-zinc-800 transition-colors shrink-0"
        title="Open AI Assistant"
      >
        <Bot className="w-5 h-5 text-zinc-400" />
        <ChevronRight className="w-3 h-3 text-zinc-500 mt-1" />
      </button>
    );
  }

  return (
    <div className="flex flex-col w-80 h-full bg-zinc-900 border-r border-zinc-700 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <div className="flex items-center gap-2">
          <Bot className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-zinc-200">AI Assistant</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0">
        {messages.length === 0 && (
          <div className="text-xs text-zinc-500 mt-4 text-center">
            Ask about Cadence, Flow scripts, transactions, or smart contracts.
          </div>
        )}
        {messages.map((msg) => (
          <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
            <div
              className={`max-w-[95%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-emerald-700/40 text-zinc-100'
                  : 'bg-zinc-800 text-zinc-200'
              }`}
            >
              {parseCodeBlocks(msg.content).map((part, i) =>
                part.type === 'code' ? (
                  <div key={i} className="my-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-zinc-500 uppercase">{part.lang || 'code'}</span>
                      <button
                        onClick={() => onInsertCode(part.content)}
                        className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 transition-colors"
                        title="Insert into editor"
                      >
                        <Code className="w-3 h-3" />
                        Insert
                      </button>
                    </div>
                    <pre className="bg-zinc-950 rounded p-2 overflow-x-auto text-[11px] text-zinc-300 font-mono whitespace-pre-wrap">
                      {part.content}
                    </pre>
                  </div>
                ) : (
                  <span key={i} className="whitespace-pre-wrap">{part.content}</span>
                )
              )}
            </div>
          </div>
        ))}
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
            onChange={handleInputChange}
            placeholder="Ask about Cadence..."
            className="flex-1 bg-zinc-800 text-zinc-200 text-xs rounded px-3 py-2 border border-zinc-700 focus:outline-none focus:border-zinc-500 placeholder:text-zinc-500"
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="p-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </form>
    </div>
  );
}
