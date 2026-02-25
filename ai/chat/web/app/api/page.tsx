"use client";

import Link from "next/link";

export default function ApiDocsPage() {
  return (
    <div className="flex-1 overflow-y-auto no-scrollbar relative">
      <div className="max-w-6xl mx-auto px-10 py-16">
        {/* Hero */}
        <div className="mb-20 animate-reveal">
          <div className="flex items-center gap-4 mb-6">
             <div className="w-1.5 h-8 bg-[var(--flow-green)] rounded-full" />
             <h1 className="text-4xl font-black italic uppercase tracking-tighter text-[var(--flow-text)]">
                API <span className="text-[var(--flow-green)] not-italic">Reference</span>
             </h1>
          </div>
          <p className="text-xs text-[var(--flow-text-secondary)] mono-label max-w-xl leading-relaxed border-l border-[var(--flow-green)] pl-5">
            Internal interface documentation for Flow EVM SQL Engine. 
            Automate blockchain data retrieval via REST and SSE protocols.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-16">
          {/* Side Nav */}
          <div className="lg:col-span-3 space-y-12">
            <div>
               <h4 className="text-[9px] mono-label text-[var(--flow-text-dim)] mb-6 tracking-widest">Analytics (v1)</h4>
               <div className="flex flex-col gap-4">
                  <ApiLink href="#ask" label="Ask" />
                  <ApiLink href="#generate" label="Generate" />
                  <ApiLink href="#run" label="Run" />
               </div>
            </div>
            <div>
               <h4 className="text-[9px] mono-label text-[var(--flow-text-dim)] mb-6 tracking-widest">Protocol (v2)</h4>
               <div className="flex flex-col gap-4">
                  <ApiLink href="#chat_sse" label="Stream" />
                  <ApiLink href="#chat_poll" label="Poll" />
               </div>
            </div>
          </div>

          {/* Docs */}
          <div className="lg:col-span-9 space-y-24">
            <section id="ask" className="animate-reveal">
               <EndpointHeader method="POST" path="/api/v1/ask" title="Execute Inquiry" />
               <p className="text-sm text-[var(--flow-text-secondary)] mb-8 leading-relaxed font-medium">
                  Direct natural language to data pipeline. Generates SQL and returns execution results in one-shot.
               </p>
               <CodeBlock 
                  request={`{ "question": "Latest block?", "execute": true }`}
                  response={`{ "question": "...", "sql": "...", "rows": [...], "row_count": 1 }`}
               />
            </section>

            <section id="chat_sse" className="animate-reveal">
               <EndpointHeader method="POST" path="/api/vanna/v2/chat_sse" title="Stream Processor" />
               <p className="text-sm text-[var(--flow-text-secondary)] mb-8 leading-relaxed font-medium">
                  Real-time Server-Sent Events stream for interactive interfaces. 
                  Provides granular updates on agent logic and result streaming.
               </p>
               <CodeBlock 
                  request={`{ "message": "Wealth distribution", "conversation_id": null }`}
                  response={`data: {"rich": {"type": "status_bar_update", ...}} \ndata: {"rich": {"type": "dataframe", ...}} \ndata: [DONE]`}
               />
            </section>

            <section id="chat_poll" className="animate-reveal">
               <EndpointHeader method="POST" path="/api/vanna/v2/chat_poll" title="Polling Endpoint" />
               <p className="text-sm text-[var(--flow-text-secondary)] mb-8 leading-relaxed font-medium">
                  Synchronous alternative to streaming. Returns the full execution trace once processing is complete.
               </p>
               <CodeBlock 
                  request={`{ "message": "Get top 10 holders" }`}
                  response={`{ "chunks": [...], "conversation_id": "...", "status": "complete" }`}
               />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}

function ApiLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} className="text-[10px] mono-label text-[var(--flow-text-dim)] hover:text-[var(--flow-green)] transition-all flex items-center gap-3 group">
       <span className="w-0.5 h-0.5 rounded-full bg-[var(--flow-text-dim)] group-hover:bg-[var(--flow-green)] group-hover:scale-150 transition-all" />
       {label}
    </a>
  );
}

function EndpointHeader({ method, path, title }: { method: string; path: string; title: string }) {
  return (
    <div className="mb-6">
       <div className="flex items-center gap-3 mb-2">
          <span className={`text-[9px] mono-label px-1.5 py-0.5 rounded bg-[var(--flow-gray)] border border-[var(--flow-border)] ${method === 'POST' ? 'text-[var(--flow-green)]' : 'text-[var(--flow-blue)]'}`}>{method}</span>
          <code className="text-[10px] mono-label text-[var(--flow-text-dim)]">{path}</code>
       </div>
       <h3 className="text-lg font-bold text-[var(--flow-text)] uppercase tracking-tight italic">{title}</h3>
    </div>
  );
}

function CodeBlock({ request, response }: { request?: string; response: string }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
       {request && (
         <div className="space-y-2">
            <span className="text-[8px] mono-label text-[var(--flow-text-dim)]">Request</span>
            <pre className="p-4 rounded-lg bg-[var(--flow-gray)] border border-[var(--flow-border)] text-[10px] font-mono text-[var(--flow-green)]/70 overflow-x-auto">{request}</pre>
         </div>
       )}
       <div className="space-y-2">
          <span className="text-[8px] mono-label text-[var(--flow-text-dim)]">Response</span>
          <pre className="p-4 rounded-lg bg-[var(--flow-gray)] border border-[var(--flow-border)] text-[10px] font-mono text-blue-400/70 overflow-x-auto">{response}</pre>
       </div>
    </div>
  );
}
