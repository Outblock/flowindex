import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/api-auth";

type Params = { params: Promise<{ shareId: string }> };

/** GET /api/share/:shareId — public read-only view (no auth) */
export async function GET(_req: NextRequest, { params }: Params) {
  const { shareId } = await params;
  const db = createServiceClient();

  const { data: session, error: sessErr } = await db
    .from("chat_sessions")
    .select("id, title, source, shared_at")
    .eq("share_id", shareId)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data: messages, error: msgErr } = await db
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results, attachments, created_at")
    .eq("session_id", session.id)
    .order("created_at", { ascending: true });

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  // Return only safe fields — no user_id, no session id
  return NextResponse.json({
    session: {
      title: session.title,
      source: session.source,
      shared_at: session.shared_at,
    },
    messages,
  });
}
