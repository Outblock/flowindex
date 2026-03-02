import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        domain: ".flowindex.io",
        path: "/",
        sameSite: "lax" as const,
        secure: true,
      },
      auth: {
        flowType: "implicit",
      },
    }
  );
}
