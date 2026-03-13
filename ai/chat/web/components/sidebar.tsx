"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { listSessions, deleteSession, type ChatSession } from "@/lib/chat-store";
import { AuthModal } from "./auth-modal";

interface SidebarProps {
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  refreshKey: number;
}

export function Sidebar({ activeSessionId, onSelectSession, onNewChat, refreshKey }: SidebarProps) {
  const [user, setUser] = useState<User | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [showAuth, setShowAuth] = useState(false);

  const supabase = createClient();

  // Auth state
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Load sessions
  useEffect(() => {
    listSessions(user?.id ?? null).then(setSessions);
  }, [user, refreshKey]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
    e.stopPropagation();
    await deleteSession(sessionId, user?.id ?? null);
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    if (activeSessionId === sessionId) onNewChat();
  };

  if (collapsed) {
    return (
      <div className="w-12 h-screen bg-zinc-950 border-r border-white/10 flex flex-col items-center py-3 shrink-0">
        <button onClick={() => setCollapsed(false)} className="p-2 text-zinc-400 hover:text-white transition-colors">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="w-64 h-screen bg-zinc-950 border-r border-white/10 flex flex-col shrink-0">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-sm bg-[var(--flow-green)]/10 border border-[var(--flow-green)]/20 flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--flow-green)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/>
              </svg>
            </div>
            <div>
              <h3 className="text-[12px] font-bold text-white uppercase tracking-widest">FlowIndex AI</h3>
            </div>
          </div>
          <button onClick={() => setCollapsed(true)} className="p-1.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-sm transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
        </div>

        {/* New Chat */}
        <div className="px-3 py-2">
          <button
            onClick={onNewChat}
            className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-zinc-400 hover:text-white border border-white/10 rounded-sm hover:border-[var(--flow-green)]/30 hover:bg-[var(--flow-green)]/5 transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Chat
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 py-1">
          {sessions.length === 0 && (
            <p className="text-[11px] text-zinc-500 text-center mt-8 px-4 leading-relaxed">
              {user ? "No conversations yet" : "Sign in to save conversations"}
            </p>
          )}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className={`group w-full text-left px-3 py-2 rounded-sm text-[12px] mb-0.5 transition-all flex items-center justify-between ${
                s.id === activeSessionId
                  ? "bg-white/5 text-white border-l-2 border-[var(--flow-green)]"
                  : "text-zinc-400 hover:text-white hover:bg-white/[0.03]"
              }`}
            >
              <span className="truncate flex-1">
                {s.title}
                {s.source === "widget" && (
                  <span className="ml-1.5 px-1.5 py-0.5 text-[10px] bg-zinc-700 text-zinc-400 rounded">
                    widget
                  </span>
                )}
              </span>
              <button
                onClick={(e) => handleDelete(e, s.id)}
                className="hidden group-hover:flex p-0.5 text-zinc-500 hover:text-red-400 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </button>
          ))}
        </div>

        {/* Auth section */}
        <div className="border-t border-white/10 px-3 py-3">
          {user ? (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-sm bg-[var(--flow-green)]/10 border border-[var(--flow-green)]/20 flex items-center justify-center text-[10px] font-bold text-[var(--flow-green)]">
                {user.email?.[0]?.toUpperCase() ?? "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-zinc-300 truncate">{user.email}</p>
              </div>
              <button
                onClick={handleSignOut}
                className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"
                title="Sign out"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[12px] font-semibold text-black bg-[var(--flow-green)] hover:bg-[var(--flow-green-dim)] rounded-lg transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
                <polyline points="10 17 15 12 10 7"/>
                <line x1="15" y1="12" x2="3" y2="12"/>
              </svg>
              Sign In
            </button>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
    </>
  );
}
