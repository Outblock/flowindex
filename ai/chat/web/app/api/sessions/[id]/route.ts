import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, createServiceClient } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

/** GET /api/sessions/:id — get session + messages */
export async function GET(req: NextRequest, { params }: Params) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = createServiceClient();

  const { data: session, error: sessErr } = await db
    .from("chat_sessions")
    .select("*")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const { data: messages, error: msgErr } = await db
    .from("chat_messages")
    .select("*")
    .eq("session_id", id)
    .order("created_at", { ascending: true });

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 });

  return NextResponse.json({ session, messages });
}

/** PATCH /api/sessions/:id — rename session */
export async function PATCH(req: NextRequest, { params }: Params) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const title = String(body.title ?? "").slice(0, 80);

  if (!title) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const db = createServiceClient();
  const { data, error } = await db
    .from("chat_sessions")
    .update({ title, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  return NextResponse.json({ session: data });
}

/** DELETE /api/sessions/:id — delete session (messages cascade) */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = createServiceClient();

  const { error } = await db
    .from("chat_sessions")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
