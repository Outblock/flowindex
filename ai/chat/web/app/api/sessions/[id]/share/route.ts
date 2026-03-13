import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest, createServiceClient } from "@/lib/api-auth";

type Params = { params: Promise<{ id: string }> };

const MAX_SHARES = 10;
const SHARE_BASE_URL = "https://ai.flowindex.io/s";

function generateShareId(): string {
  return crypto.randomBytes(6).toString("base64url").slice(0, 8);
}

/** POST /api/sessions/:id/share — generate share link */
export async function POST(req: NextRequest, { params }: Params) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = createServiceClient();

  // Check session exists and belongs to user
  const { data: session, error: sessErr } = await db
    .from("chat_sessions")
    .select("id, share_id")
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (sessErr || !session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // If already shared, return existing link (idempotent)
  if (session.share_id) {
    return NextResponse.json({
      share_url: `${SHARE_BASE_URL}/${session.share_id}`,
      share_id: session.share_id,
    });
  }

  // Enforce max 10 active shares per user
  const { count, error: countErr } = await db
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .not("share_id", "is", null);

  if (countErr) return NextResponse.json({ error: countErr.message }, { status: 500 });
  if ((count ?? 0) >= MAX_SHARES) {
    return NextResponse.json(
      { error: "Share limit reached (max 10 active shares)" },
      { status: 409 }
    );
  }

  // Generate share_id with retry on UNIQUE constraint violation
  for (let attempt = 0; attempt < 3; attempt++) {
    const shareId = generateShareId();
    const { data, error } = await db
      .from("chat_sessions")
      .update({ share_id: shareId, shared_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", user.id)
      .select("share_id")
      .single();

    if (!error && data) {
      return NextResponse.json({
        share_url: `${SHARE_BASE_URL}/${data.share_id}`,
        share_id: data.share_id,
      });
    }

    // Retry only on unique constraint violation (23505)
    if (error?.code !== "23505") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  return NextResponse.json(
    { error: "Failed to generate unique share ID" },
    { status: 500 }
  );
}

/** DELETE /api/sessions/:id/share — revoke share */
export async function DELETE(req: NextRequest, { params }: Params) {
  const user = await authenticateRequest(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = createServiceClient();

  const { error } = await db
    .from("chat_sessions")
    .update({ share_id: null, shared_at: null })
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
