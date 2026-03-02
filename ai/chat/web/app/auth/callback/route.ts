import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message, error);
  } else {
    // No code — could be an error redirect from GoTrue
    const errorDesc = searchParams.get("error_description") || searchParams.get("error");
    console.error("[auth/callback] No code param. error:", errorDesc);
  }

  return NextResponse.redirect(`${origin}/?auth_error=true`);
}
