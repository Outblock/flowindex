/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_API_URL: string;
  readonly VITE_RP_ID: string;
  readonly VITE_BUNDLER_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
