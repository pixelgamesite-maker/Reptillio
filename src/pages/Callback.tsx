import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { takeNext } from "../hooks/useAuth";
import { Reptile } from "../components/Reptile";

/** /callback — finishes the X OAuth (PKCE) handshake, then drops the player where they were headed. */
export default function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      if (params.get("error_description")) {
        setError(params.get("error_description") as string);
        return;
      }
      if (params.get("code")) {
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(window.location.search);
        if (exErr && alive) {
          // Often the code was already exchanged by detectSessionInUrl — check for a session before failing.
          const { data } = await supabase.auth.getSession();
          if (!data.session) {
            setError("That sign-in link expired. Head back and tap Sign in again.");
            return;
          }
        }
      }
      const { data } = await supabase.auth.getSession();
      if (!alive) return;
      if (data.session) navigate(takeNext(), { replace: true });
      else setError("No session came back from X. Try signing in once more.");
    })();
    return () => {
      alive = false;
    };
  }, [navigate]);

  return (
    <div className="paper-page">
      <div className="paper-bg" aria-hidden="true" />
      <div className="callback">
        <Reptile level={1} size={180} className="bob" />
        {error ? (
          <>
            <p className="callback-err">{error}</p>
            <button className="kraft-btn" onClick={() => navigate("/", { replace: true })}>Back to Chapters</button>
          </>
        ) : (
          <h2>Incubating your egg…</h2>
        )}
      </div>
    </div>
  );
}
