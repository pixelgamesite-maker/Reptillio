import { createClient } from "@supabase/supabase-js";

export const DEMO = import.meta.env.VITE_DEMO === "true";

// Values pasted into a hosting dashboard often carry a hidden line break, space or
// quote marks. A browser refuses to send a header containing those ("Failed to
// execute 'fetch'… invalid value"), which silently breaks sign-in — so clean them.
const clean = (v: string | undefined) => (v ?? "").replace(/[^\x21-\x7E]/g, "").replace(/^["']+|["']+$/g, "");
const url = clean(import.meta.env.VITE_SUPABASE_URL).replace(/\/+$/, "");
const key = clean(import.meta.env.VITE_SUPABASE_ANON_KEY);

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
