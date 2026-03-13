import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, createServiceClient } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

const SESSION_LIMIT = 50;
const MESSAGE_LIMIT = 200;

/** POST /api/sessions/:id/messages — append messages */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { messages, title, source = "web" } = body as {
    messages: {
      role: string;
      content: string;
      tool_calls?: unknown;
      tool_results?: unknown;
      attachments?: unknown;
    }[];
    title?: string;
    source?: string;
  };

  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages array is required" }, { status: 400 });
  }

  const db = createServiceClient();

  // Check if session exists
  const { data: existing } = await db
    .from("chat_sessions")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  // Auto-create session if it doesn't exist
  if (!existing) {
    // Enforce 50-session limit
    const { count, error: countErr } = await db
      .from("chat_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id);

    if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
    if ((count ?? 0) >= SESSION_LIMIT) {
      return NextResponse.json(
        { error: "Session limit reached (max 50)" },
        { status: 409 }
      );
    }

    // Auto-title from first user message
    const autoTitle =
      title ??
      messages
        .find((m) => m.role === "user")
        ?.content?.slice(0, 80) ??
      "New chat";

    const { error: createErr } = await db.from("chat_sessions").insert({
      id,
      user_id: user.id,
      title: autoTitle,
      source,
    });

    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 });
  }

  // Enforce 200-message limit
  const { count: msgCount, error: msgCountErr } = await db
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("session_id", id);

  if (msgCountErr) return NextResponse.json({ error: msgCountErr.message }, { status: 500 });
  if ((msgCount ?? 0) + messages.length > MESSAGE_LIMIT) {
    return NextResponse.json(
      { error: `Message limit reached (max ${MESSAGE_LIMIT} per session)` },
      { status: 409 }
    );
  }

  // Insert messages
  const rows = messages.map((m) => ({
    session_id: id,
    role: m.role,
    content: m.content,
    tool_calls: m.tool_calls ?? null,
    tool_results: m.tool_results ?? null,
    attachments: m.attachments ?? null,
  }));

  const { data: inserted, error: insertErr } = await db
    .from("chat_messages")
    .insert(rows)
    .select();

  if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

  // Update session updated_at (and title if provided)
  const sessionUpdate: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (title) sessionUpdate.title = title.slice(0, 80);

  await db
    .from("chat_sessions")
    .update(sessionUpdate)
    .eq("id", id)
    .eq("user_id", user.id);

  return NextResponse.json({ messages: inserted }, { status: 201 });
}
