import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Provider, Session } from "@supabase/supabase-js";
import { supabase, DEMO } from "../lib/supabase";

type AuthValue = {
  session: Session | null;
  signedIn: boolean;
  loading: boolean;
  /** `next` = where to land after X sends the player back. */
  signInWithX: (next?: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

const REF_KEY = "reptilio_ref";
const NEXT_KEY = "reptilio_next";
const DEMO_KEY = "reptilio_demo_signed_in";

/** Run on every page load: keeps ?ref=RPT-00042 alive through the OAuth round trip. */
export function captureReferral() {
  try {
    const ref = new URLSearchParams(window.location.search).get("ref");
    if (ref && /^RPT-\d{1,8}$/i.test(ref.trim())) localStorage.setItem(REF_KEY, ref.trim().toUpperCase());
  } catch {
    /* storage blocked — referral just won't attribute */
  }
}

export function takeReferral(): string | null {
  try {
    const r = localStorage.getItem(REF_KEY);
    localStorage.removeItem(REF_KEY);
    return r;
  } catch {
    return null;
  }
}

export function takeNext(): string {
  try {
    const n = localStorage.getItem(NEXT_KEY);
    localStorage.removeItem(NEXT_KEY);
    return n && n.startsWith("/") ? n : "/lab";
  } catch {
    return "/lab";
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [demoIn, setDemoIn] = useState(() => {
    try {
      return DEMO && localStorage.getItem(DEMO_KEY) !== "false";
    } catch {
      return DEMO;
    }
  });
  const [loading, setLoading] = useState(!DEMO);

  useEffect(() => {
    if (DEMO) return;
    let alive = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return;
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, next) => setSession(next));
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      signedIn: DEMO ? demoIn : !!session,
      loading,
      async signInWithX(next = "/lab") {
        try {
          localStorage.setItem(NEXT_KEY, next);
        } catch {
          /* no-op */
        }
        if (DEMO) {
          try { localStorage.setItem(DEMO_KEY, "true"); } catch { /* no-op */ }
          setDemoIn(true);
          return;
        }
        await supabase.auth.signInWithOAuth({
          // Supabase's X / Twitter (OAuth 2.0) provider. Older projects may
          // have it registered as "twitter" — switch the string if so.
          provider: "x" as Provider,
          options: { redirectTo: `${window.location.origin}/callback` },
        });
      },
      async signOut() {
        if (DEMO) {
          try { localStorage.setItem(DEMO_KEY, "false"); } catch { /* no-op */ }
          setDemoIn(false);
          return;
        }
        await supabase.auth.signOut();
      },
    }),
    [session, loading, demoIn]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
