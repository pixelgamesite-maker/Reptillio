/**
 * Reptile Rush — HTTP entry point.
 *   POST /rooms               create a room (needs a signed-in Level 3+ player)
 *   GET  /rooms/:code         does it exist / is it full
 *   GET  /rooms/:code/ws      WebSocket into the room (first message: {t:"hello", token})
 *   POST /ice                 ICE servers for voice chat (STUN + short-lived TURN)
 */
import { playerFromToken, type Env } from "./env";
export { RushRoom } from "./room";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O/1/I/L

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] ?? "*",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    Vary: "Origin",
  };
}

const json = (body: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

async function iceServers(env: Env) {
  const stun = { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] };
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return [stun];
  try {
    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: 3 * 60 * 60 }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const data = (await r.json()) as { iceServers: unknown };
    return Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  } catch (e) {
    console.error("TURN credentials failed", e);
    return [stun];
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { headers: h });
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");

    try {
      if (parts[0] === "rooms" && parts.length === 1 && req.method === "POST") {
        const me = await playerFromToken(env, token);
        if (!me) return json({ error: "Sign in first" }, 401, h);
        if (me.banned) return json({ error: "This account is suspended" }, 403, h);
        if (me.level < me.min_level) return json({ error: `Reach Level ${me.min_level} in the Lab to play` }, 403, h);
        for (let attempt = 0; attempt < 5; attempt++) {
          const code = newCode();
          const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
          const r = await stub.fetch("https://room/init", { method: "POST", body: JSON.stringify({ code, host: me.id }) });
          if (r.ok) return json({ code }, 200, h);
        }
        return json({ error: "Couldn't create a room — try again" }, 500, h);
      }

      if (parts[0] === "rooms" && parts[1]) {
        const code = parts[1].toUpperCase();
        if (!/^[A-Z0-9]{6}$/.test(code)) return json({ error: "Invalid room code" }, 400, h);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        if (parts[2] === "ws") return stub.fetch(new Request("https://room/ws", req));
        const r = await stub.fetch("https://room/info");
        return json(await r.json(), 200, h);
      }

      if (parts[0] === "ice" && req.method === "POST") {
        const me = await playerFromToken(env, token);
        if (!me) return json({ error: "Sign in first" }, 401, h);
        return json({ iceServers: await iceServers(env) }, 200, h);
      }

      if (parts.length === 0) return json({ ok: true, service: "reptilio-rush" }, 200, h);
      return json({ error: "Not found" }, 404, h);
    } catch (e) {
      console.error(e);
      return json({ error: (e as Error).message || "Server error" }, 500, h);
    }
  },
};
