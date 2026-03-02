"use client";

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { Chat } from "@/components/chat";
import { Sidebar } from "@/components/sidebar";

function generateId() {
  return crypto.randomUUID();
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [sessionId, setSessionId] = useState<string>(generateId());
  const [sidebarRefresh, setSidebarRefresh] = useState(0);

  const supabase = createClient();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user));
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      // Sync shared cross-subdomain cookie for flowindex.io SSO
      try {
        if (session?.access_token && session?.refresh_token) {
          const value = JSON.stringify({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
          });
          document.cookie = `fi_auth=${encodeURIComponent(value)}; domain=.flowindex.io; path=/; max-age=${60 * 60 * 24 * 30}; secure; samesite=lax`;
        } else {
          document.cookie = "fi_auth=; domain=.flowindex.io; path=/; max-age=0; secure; samesite=lax";
        }
      } catch { /* ignore */ }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleNewChat = useCallback(() => {
    setSessionId(generateId());
  }, []);

  const handleSelectSession = useCallback((id: string) => {
    setSessionId(id);
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        activeSessionId={sessionId}
        onSelectSession={handleSelectSession}
        onNewChat={handleNewChat}
        refreshKey={sidebarRefresh}
      />
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <Chat key={sessionId} />
      </main>
    </div>
  );
}
