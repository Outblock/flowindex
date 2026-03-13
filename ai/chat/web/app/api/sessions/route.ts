import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, createServiceClient } from "@/lib/api-auth";

const SESSION_LIMIT = 50;

/** GET /api/sessions — list user's sessions */
export async function GET(req: NextRequest) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = createServiceClient();
  const { data, error } = await db
    .from("chat_sessions")
    .select("id, title, source, share_id, shared_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false })
    .limit(SESSION_LIMIT);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sessions: data });
}

/** POST /api/sessions — create session */
export async function POST(req: NextRequest) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { id, title, source = "web" } = body as {
    id?: string;
    title: string;
    source?: string;
  };

  const db = createServiceClient();

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

  const row: Record<string, unknown> = {
    user_id: user.id,
    title,
    source,
  };
  if (id) row.id = id;

  const { data, error } = await db
    .from("chat_sessions")
    .upsert(row, { onConflict: "id" })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ session: data }, { status: 201 });
}
