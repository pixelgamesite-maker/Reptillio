import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { takeNext } from "../hooks/useAuth";
import { Reptile } from "../components/Reptile";

/**
 * /callback — X sends the player back here with a one-time ?code=.
 * supabase-js (detectSessionInUrl + PKCE) exchanges that code by itself when
 * it starts up, and getSession() waits for that to finish — so we must NOT
 * exchange it again here (doing both races and can burn the code).
 */
export default function Callback() {
  const navigate = useNavigate();
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    let done = false;
    const finish = () => {
      if (done || !alive) return;
      done = true;
      navigate(takeNext(), { replace: true });
    };

    // A session can also land a moment later via the auth event.
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) finish();
    });

    (async () => {
      const query = new URLSearchParams(window.location.search);
      const hash = new URLSearchParams(window.location.hash.slice(1));
      const denied = query.get("error_description") || hash.get("error_description");
      if (denied) {
        setError(`X sign-in didn't complete: ${denied}`);
        return;
      }

      const { data, error: sessErr } = await supabase.auth.getSession();
      if (data.session) return finish();

      // Give the automatic exchange a moment, then explain what went wrong.
      await new Promise((r) => setTimeout(r, 2500));
      if (done || !alive) return;
      const again = await supabase.auth.getSession();
      if (again.data.session) return finish();

      const msg = (sessErr?.message || "").toLowerCase();
      if (!query.get("code")) {
        setError("No sign-in came back from X. Tap Connect with X again.");
      } else if (msg.includes("verifier") || msg.includes("flow state")) {
        setError(
          `Sign-in started on a different web address than it finished on (${window.location.host}). ` +
            "Open reptilio.fun directly and tap Connect with X again."
        );
      } else {
        setError(`Sign-in couldn't finish${sessErr?.message ? `: ${sessErr.message}` : ""}. Tap Connect with X again.`);
      }
    })();

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
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
            <button className="kraft-btn" onClick={() => navigate("/", { replace: true })}>Back to start</button>
          </>
        ) : (
          <h2>Incubating your egg…</h2>
        )}
      </div>
    </div>
  );
}
