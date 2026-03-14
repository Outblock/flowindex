"use client";

import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { listSessions, deleteSession, type ChatSession } from "@/lib/chat-store";
import { AuthModal } from "./auth-modal";
import { ChevronRight, LogOut, Plus, Trash2, User as UserIcon } from "lucide-react";
import { FlowLogo } from "./flow-logo";
// import { DotAnime } from "dot-anime-react";

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
      <div className="w-14 h-screen bg-black border-r border-white/5 flex flex-col items-center py-6 shrink-0 z-40 relative">
        <button onClick={() => setCollapsed(false)} className="p-2 text-zinc-500 hover:text-white transition-all hover:bg-white/5">
          <ChevronRight size={18} />
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="w-72 h-screen bg-black border-r border-white/5 flex flex-col shrink-0 z-40 relative">
        {/* Header */}
        <div className="flex flex-col border-b border-white/5 bg-zinc-950/50">
          <div className="flex items-center justify-between px-5 py-5">
            <div className="flex items-center gap-3">
               <div className="grayscale brightness-200 opacity-80">
                  <FlowLogo size={20} />
               </div>
              <div>
                <h3 className="text-[11px] font-bold text-white uppercase tracking-[0.2em] dot-matrix">FLOWSCAN</h3>
              </div>
            </div>
            <button onClick={() => setCollapsed(true)} className="p-1.5 text-zinc-600 hover:text-white hover:bg-white/5 transition-colors">
               <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
          </div>
          
          {/* <div className="px-5 pb-4 overflow-hidden pointer-events-none opacity-30">
            <DotAnime 
              width={240} 
              height={24} 
              dotSize={1} 
              gap={3} 
              color="#00ef8b" 
              speed={0.4} 
              type="line"
            />
          </div> */}
        </div>

        {/* New Chat */}
        <div className="px-4 py-4">
          <button
            onClick={onNewChat}
            className="w-full flex items-center justify-between px-4 py-3 text-[10px] uppercase tracking-widest font-bold text-zinc-400 hover:text-white border border-white/5 hover:border-white/20 transition-all bg-white/[0.02] group"
          >
            <div className="flex items-center gap-2.5">
              <Plus size={14} className="text-zinc-500 group-hover:text-[var(--nothing-green)] transition-colors" />
              NEW SESSION
            </div>
            <span className="text-[9px] text-zinc-600 font-mono">01</span>
          </button>
        </div>

        {/* Session list */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-2 space-y-1">
          {sessions.length === 0 && (
            <div className="mt-12 px-6 text-center">
               <p className="text-[10px] uppercase tracking-widest text-zinc-600 font-bold leading-relaxed">
                  {user ? "Memory Buffer Empty" : "Authentication Required"}
               </p>
               <div className="mt-4 flex justify-center">
                  <div className="w-8 h-[1px] bg-zinc-800" />
               </div>
            </div>
          )}
          {sessions.map((s, idx) => (
            <button
              key={s.id}
              onClick={() => onSelectSession(s.id)}
              className={`group w-full text-left px-4 py-3 rounded-none text-[11px] transition-all flex items-center justify-between border border-transparent ${
                s.id === activeSessionId
                  ? "bg-white/[0.04] text-white border-white/5 !border-l-[var(--nothing-green)]"
                  : "text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.01]"
              }`}
            >
              <span className="truncate flex-1 font-mono uppercase tracking-tight">
                {s.title}
              </span>
              <div className="flex items-center gap-2">
                 {s.source === "widget" && (
                  <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-tighter bg-zinc-800 text-zinc-500 font-bold">
                    WDG
                  </span>
                )}
                <button
                  onClick={(e) => handleDelete(e, s.id)}
                  className="hidden group-hover:flex p-1 text-zinc-600 hover:text-[var(--nothing-green)] transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </button>
          ))}
        </div>

        {/* Auth section */}
        <div className="border-t border-white/5 px-4 py-5">
          {user ? (
            <div className="flex items-center gap-3 px-1">
              <div className="w-8 h-8 rounded-none bg-zinc-900 border border-white/5 flex items-center justify-center text-[10px] font-bold text-zinc-400">
                <UserIcon size={14} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-mono text-zinc-500 truncate uppercase">{user.email?.split('@')[0]}</p>
                <p className="text-[9px] text-zinc-700 truncate uppercase tracking-tighter">Status: Authorized</p>
              </div>
              <button
                onClick={handleSignOut}
                className="p-2 text-zinc-600 hover:text-[var(--nothing-green)] transition-colors bg-white/5 border border-white/5"
                title="Sign out"
              >
                <LogOut size={14} />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowAuth(true)}
              className="w-full flex items-center justify-center gap-2.5 px-4 py-3 text-[10px] uppercase tracking-[0.2em] font-bold text-white bg-[var(--nothing-green)] hover:bg-[var(--nothing-green-dim)] transition-all relative overflow-hidden group"
            >
              <div className="absolute inset-0 opacity-0 group-hover:opacity-10 bg-white transition-opacity" />
              SIGN IN
            </button>
          )}
        </div>
      </div>

      {/* Auth Modal */}
      <AuthModal open={showAuth} onClose={() => setShowAuth(false)} />
    </>
  );
}
