// ── Types ──

export interface ChatSession {
  id: string;
  title: string;
  source?: string;
  share_id?: string | null;
  shared_at?: string | null;
  updated_at: string;
  created_at?: string;
}

export interface ChatMessage {
  id?: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  tool_calls?: unknown;
  tool_results?: unknown;
  attachments?: unknown;
  created_at?: string;
  sql?: string;
  result?: unknown;
  error?: string;
  loading?: boolean;
}

// ── localStorage helpers (anonymous users) ──

function getLocalSessions(): ChatSession[] {
  try {
    return JSON.parse(localStorage.getItem("chat_sessions") || "[]");
  } catch { return []; }
}

function setLocalSessions(sessions: ChatSession[]) {
  localStorage.setItem("chat_sessions", JSON.stringify(sessions));
}

function getLocalMessages(sessionId: string): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(`chat_msgs_${sessionId}`) || "[]");
  } catch { return []; }
}

function setLocalMessages(sessionId: string, msgs: ChatMessage[]) {
  localStorage.setItem(`chat_msgs_${sessionId}`, JSON.stringify(msgs));
}

// ── API-backed functions (authenticated users) ──

export async function listSessions(userId: string | null): Promise<ChatSession[]> {
  if (!userId) return getLocalSessions();

  const res = await fetch("/api/sessions");
  if (!res.ok) return [];
  const data = await res.json();
  return data.sessions ?? [];
}

export async function loadMessages(sessionId: string, userId: string | null): Promise<ChatMessage[]> {
  if (!userId) return getLocalMessages(sessionId);

  const res = await fetch(`/api/sessions/${sessionId}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.messages ?? []).map((m: Record<string, unknown>) => ({
    role: m.role as ChatMessage["role"],
    content: (m.content as string) ?? "",
    sql: (m.sql as string) ?? undefined,
    result: m.result ?? undefined,
    error: (m.error as string) ?? undefined,
    tool_calls: m.tool_calls ?? undefined,
    tool_results: m.tool_results ?? undefined,
    attachments: m.attachments ?? undefined,
    created_at: (m.created_at as string) ?? undefined,
  }));
}

export async function saveSession(
  sessionId: string,
  title: string,
  messages: ChatMessage[],
  userId: string | null,
  source = "web"
): Promise<void> {
  const now = new Date().toISOString();

  if (!userId) {
    // localStorage
    const sessions = getLocalSessions();
    const idx = sessions.findIndex((s) => s.id === sessionId);
    if (idx >= 0) {
      sessions[idx].title = title;
      sessions[idx].updated_at = now;
    } else {
      sessions.unshift({ id: sessionId, title, updated_at: now });
    }
    // Keep max 20 local sessions
    setLocalSessions(sessions.slice(0, 20));
    setLocalMessages(sessionId, messages);
    return;
  }

  // API mode: POST messages (callers pass only NEW messages, not full history)
  await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, title, source }),
  });
}

/** Dedicated append function for cross-origin callers (widget) */
export async function appendMessages(
  sessionId: string,
  newMessages: ChatMessage[],
  title?: string,
  source?: string,
  authToken?: string
): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: newMessages,
      ...(title && { title }),
      ...(source && { source }),
    }),
  });
}

export async function deleteSession(sessionId: string, userId: string | null): Promise<void> {
  if (!userId) {
    const sessions = getLocalSessions().filter((s) => s.id !== sessionId);
    setLocalSessions(sessions);
    localStorage.removeItem(`chat_msgs_${sessionId}`);
    return;
  }

  await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  await fetch(`/api/sessions/${sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
}

export async function shareSession(
  sessionId: string
): Promise<{ share_url: string; share_id: string } | null> {
  const res = await fetch(`/api/sessions/${sessionId}/share`, {
    method: "POST",
  });
  if (!res.ok) return null;
  return res.json();
}

export async function unshareSession(sessionId: string): Promise<boolean> {
  const res = await fetch(`/api/sessions/${sessionId}/share`, {
    method: "DELETE",
  });
  return res.ok;
}
