import { createClient } from "@supabase/supabase-js";

export const DEMO = import.meta.env.VITE_DEMO === "true";

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const key = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";

if (!DEMO && (!url || !key)) {
  console.warn("Supabase env vars missing. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local (or set VITE_DEMO=true).");
}

export const supabase = createClient(url || "http://localhost:54321", key || "public-anon-key", {
  auth: {
    flowType: "pkce",
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
