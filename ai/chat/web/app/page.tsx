"use client";

import { useState, useCallback, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";
import { persistTokens, clearTokens } from "@flowindex/auth-core";
import { Chat } from "@/components/chat";
import { Sidebar } from "@/components/sidebar";
import { ArtifactPanelProvider, ArtifactPanel } from "@/components/artifact-panel";

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
          persistTokens(session.access_token, session.refresh_token);
        } else {
          clearTokens();
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
    <ArtifactPanelProvider>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar
          activeSessionId={sessionId}
          onSelectSession={handleSelectSession}
          onNewChat={handleNewChat}
          refreshKey={sidebarRefresh}
        />
        <main className="flex-1 flex relative overflow-hidden">
          <div className="flex-1 flex flex-col overflow-hidden">
            <Chat key={sessionId} />
          </div>
          <ArtifactPanel />
        </main>
      </div>
    </ArtifactPanelProvider>
  );
}
