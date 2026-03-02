import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Use an internal URL for server-side GoTrue calls to avoid the middleware
// calling back into itself (infinite loop). Falls back to the public URL.
const SUPABASE_URL_INTERNAL =
  process.env.SUPABASE_URL_INTERNAL || process.env.NEXT_PUBLIC_SUPABASE_URL!;

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    SUPABASE_URL_INTERNAL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, {
              ...options,
              domain: ".flowindex.io",
            })
          );
        },
      },
    }
  );

  // Check existing Supabase session
  const { data: { user } } = await supabase.auth.getUser();

  // If no Supabase session, try to pick up session from flowindex.io shared cookie
  if (!user) {
    const fiAuth = request.cookies.get("fi_auth");
    if (fiAuth?.value) {
      try {
        const parsed = JSON.parse(decodeURIComponent(fiAuth.value));
        if (parsed?.access_token && parsed?.refresh_token) {
          await supabase.auth.setSession({
            access_token: parsed.access_token,
            refresh_token: parsed.refresh_token,
          });
        }
      } catch {
        // Invalid cookie — ignore
      }
    }
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|fonts/|auth/|rest/|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
