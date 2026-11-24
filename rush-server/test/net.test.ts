/**
 * End-to-end network test against a local server:
 *   npx wrangler dev --var DEV_AUTH:true --port 8787   (in another terminal)
 *   npx tsx test/net.test.ts
 * Two bot clients join a room, ready up, and play the full stage over
 * WebSockets using only button presses. The server must declare the win.
 */
import { COOP } from "../../shared/rush/bot";
import { encodeInput, unpackWorld, type World } from "../../shared/rush/sim";
import type { ServerMsg } from "../../shared/rush/protocol";

const BASE = process.env.RUSH_URL ?? "http://127.0.0.1:8787";
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`); if (!ok) fails++; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function create(token: string) {
  const r = await fetch(`${BASE}/rooms`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  return { status: r.status, body: (await r.json()) as { code?: string; error?: string } };
}

function connect(code: string, token: string) {
  const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/rooms/${code}/ws`);
  const inbox: ServerMsg[] = [];
  const c = {
    ws, inbox, world: null as World | null, seat: -1, closed: false,
    waitFor: async (pred: (m: ServerMsg) => boolean, ms = 5000) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        const m = inbox.find(pred);
        if (m) return m;
        await sleep(10);
      }
      return null;
    },
    send: (m: unknown) => ws.readyState === 1 && ws.send(JSON.stringify(m)),
  };
  ws.addEventListener("open", () => ws.send(JSON.stringify({ t: "hello", token })));
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(String(e.data)) as ServerMsg;
    if (m.t === "s") c.world = unpackWorld(m.w);
    else inbox.push(m);
    if (m.t === "welcome") c.seat = m.seat;
  });
  ws.addEventListener("close", () => { c.closed = true; });
  return c;
}

console.log("Reptile Rush — network");

check((await create("dev:low:2")).status === 403, "Level 2 player can't create a room");
const { body } = await create("dev:alice:3");
check(!!body.code && /^[A-Z0-9]{6}$/.test(body.code), `room created: ${body.code}`);
const code = body.code!;

const A = connect(code, "dev:alice:3");
const B = connect(code, "dev:bob:4");
check(!!(await A.waitFor((m) => m.t === "welcome")) && !!(await B.waitFor((m) => m.t === "welcome")), "both players seated");

const low = connect(code, "dev:carol:2");
check(!!(await low.waitFor((m) => m.t === "err" && /Level 3/.test(m.msg))), "Level 2 friend is turned away");
const third = connect(code, "dev:dave:5");
check(!!(await third.waitFor((m) => m.t === "err" && /full/.test(m.msg))), "third player gets 'room full'");

A.send({ t: "sig", d: { hello: "voice" } });
check(!!(await B.waitFor((m) => m.t === "sig")), "voice signaling relayed between players");

A.send({ t: "ready", v: true });
B.send({ t: "ready", v: true });
check(!!(await A.waitFor((m) => m.t === "room" && m.status === "countdown")), "both ready → countdown");
check(!!(await A.waitFor((m) => m.t === "room" && m.status === "playing", 6000)), "countdown → playing");

// Drive the scripted duo over the network.
const jp = [0, 0];
let seq = 0;
let phase = 0;
let phaseStart = Date.now();
const started = Date.now();
const clients = [A, B].sort((x, y) => x.seat - y.seat);
let won: ServerMsg | null = null;
while (Date.now() - started < 120_000) {
  won = A.inbox.find((m) => m.t === "won") ?? null;
  if (won) break;
  const w = A.world;
  if (w && phase < COOP.length) {
    const r = COOP[phase].run(w, (Date.now() - phaseStart) / 1000);
    if (r === "done") { phase++; phaseStart = Date.now(); continue; }
    r.forEach((c, i) => {
      if (c.press) jp[i]++;
      const [b, j] = encodeInput({ left: !!c.l, right: !!c.r, jump: !!c.jump || !!c.press, anchor: !!c.anchor, jp: jp[i] });
      clients[i].send({ t: "in", s: ++seq, b, jp: j });
    });
  }
  await sleep(16);
}
const deaths = A.world?.deaths ?? -1;
check(!!won && won.t === "won" && won.you_won, `server declared the win (${won && won.t === "won" ? `${(won.ms / 1000).toFixed(1)}s, ${won.deaths} deaths` : `stuck in phase ${phase}: ${COOP[phase]?.name}, deaths ${deaths}`})`);

A.send({ t: "leave" }); B.send({ t: "leave" });
await sleep(200);
console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
