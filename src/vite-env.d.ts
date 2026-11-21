/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_ROBINHOOD_RPC_URL?: string;
  readonly VITE_DEMO?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
