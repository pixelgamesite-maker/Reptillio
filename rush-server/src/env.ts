export type Env = {
  ROOMS: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  DEV_AUTH: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
};

/** What the server knows about a player — always fetched server-side, never trusted from the browser. */
export type PlayerInfo = {
  id: string;
  handle: string;
  avatar_url: string;
  reptilio_id: string;
  level: number;
  banned: boolean;
  won: boolean;
  min_level: number;
};

/**
 * Headers for server-to-Supabase calls. Works with both key styles:
 * new secret keys (sb_secret_…) go ONLY in `apikey` — they aren't JWTs and
 * Supabase rejects them in `Authorization`. Legacy service_role keys are
 * JWTs and are sent in both, as before.
 */
function serviceHeaders(key: string): Record<string, string> {
  const h: Record<string, string> = { apikey: key, "Content-Type": "application/json" };
  if (key.startsWith("eyJ")) h.Authorization = `Bearer ${key}`;
  return h;
}

/**
 * Turn a Supabase access token into a PlayerInfo.
 * 1) Supabase Auth validates the token and tells us the user id.
 * 2) rush_player() (service-role only) returns their level, ban status, wins.
 */
export async function playerFromToken(env: Env, token: string): Promise<PlayerInfo | null> {
  if (!token) return null;

  if (env.DEV_AUTH === "true" && token.startsWith("dev:")) {
    const [, handle = "dev", lvl = "3"] = token.split(":");
    return {
      id: `dev-${handle}`, handle, avatar_url: "", reptilio_id: `RPT-DEV-${handle.toUpperCase()}`,
      level: Number(lvl) || 1, banned: false, won: false, min_level: 3,
    };
  }

  const url = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Server not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");

  const u = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, Authorization: `Bearer ${token}` } });
  if (!u.ok) return null;
  const user = (await u.json()) as { id?: string };
  if (!user.id) return null;

  const r = await fetch(`${url}/rest/v1/rpc/rush_player`, {
    method: "POST",
    headers: serviceHeaders(key),
    body: JSON.stringify({ uid: user.id }),
  });
  if (!r.ok) throw new Error(`rush_player failed: ${r.status}`);
  return (await r.json()) as PlayerInfo | null;
}

export async function recordWin(env: Env, body: { room: string; p1: string; p2: string; duration_ms: number; deaths: number }) {
  if (env.DEV_AUTH === "true" && body.p1.startsWith("dev-")) return { new_winners: [body.p1, body.p2], dev: true };
  const url = env.SUPABASE_URL!, key = env.SUPABASE_SERVICE_ROLE_KEY!;
  const r = await fetch(`${url}/rest/v1/rpc/rush_record_win`, {
    method: "POST",
    headers: serviceHeaders(key),
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`rush_record_win failed: ${r.status} ${await r.text()}`);
  return (await r.json()) as { new_winners: string[] };
}
