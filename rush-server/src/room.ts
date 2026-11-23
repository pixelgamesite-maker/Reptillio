import { DT, NO_INPUT, decodeInput, newWorld, packWorld, step, type Input, type SimEvent, type World } from "../../shared/rush/sim";
import { COUNTDOWN_MS, RECONNECT_GRACE_MS, SNAPSHOT_EVERY, type ClientMsg, type RoomStatus, type SeatView, type ServerMsg } from "../../shared/rush/protocol";
import { playerFromToken, recordWin, type Env, type PlayerInfo } from "./env";

type Seat = {
  info: PlayerInfo;
  ws: WebSocket | null;
  ready: boolean;
  voice: boolean;
  input: Input;
  ack: number;
  lastSeen: number;
};

const ROOM_TTL_MS = 3 * 60 * 60 * 1000;

/**
 * One Reptile Rush room. Holds at most two seats. The world is simulated
 * here and only here — browsers send button states, never positions — so a
 * "stage cleared" can't be faked from the client.
 */
export class RushRoom {
  private code = "";
  private createdAt = 0;
  private hostId = "";
  private seats: [Seat | null, Seat | null] = [null, null];
  private status: RoomStatus = "lobby";
  private world: World | null = null;
  private countdownEnd = 0;
  private loop: ReturnType<typeof setInterval> | null = null;
  private lastTickAt = 0;
  private acc = 0;
  private startedAt = 0;
  private pausedSince = 0;

  constructor(private state: DurableObjectState, private env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/init" && req.method === "POST") {
      if (this.code) return new Response("exists", { status: 409 });
      const body = (await req.json()) as { code: string; host: string };
      this.code = body.code;
      this.hostId = body.host;
      this.createdAt = Date.now();
      return Response.json({ ok: true });
    }

    if (url.pathname === "/info") {
      if (!this.code) return Response.json({ exists: false });
      return Response.json({ exists: true, status: this.status, players: this.seats.filter(Boolean).length });
    }

    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.accept();
      this.handleSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("Not found", { status: 404 });
  }

  // ── connections ───────────────────────────────────────────────────
  private handleSocket(ws: WebSocket) {
    let seatIdx: 0 | 1 | -1 = -1;
    const helloTimer = setTimeout(() => {
      if (seatIdx === -1) this.close(ws, "Sign-in timed out");
    }, 10_000);

    ws.addEventListener("message", async (ev) => {
      let msg: ClientMsg;
      try {
        msg = JSON.parse(typeof ev.data === "string" ? ev.data : "");
      } catch {
        return;
      }

      if (seatIdx === -1) {
        if (msg.t !== "hello") return;
        clearTimeout(helloTimer);
        seatIdx = await this.join(ws, msg.token);
        return;
      }
      const seat = this.seats[seatIdx];
      if (!seat || seat.ws !== ws) return;
      seat.lastSeen = Date.now();

      switch (msg.t) {
        case "in": {
          const b = Number(msg.b) & 15;
          const jp = Math.max(seat.input.jp, Math.min(seat.input.jp + 8, Number(msg.jp) | 0));
          seat.input = decodeInput(b, jp);
          seat.ack = Math.max(seat.ack, Number(msg.s) | 0);
          break;
        }
        case "ready":
          if (this.status === "lobby") {
            seat.ready = !!msg.v;
            this.maybeStartCountdown();
            this.broadcastRoom();
          }
          break;
        case "again":
          if (this.status === "won" || this.status === "timeout") {
            this.status = "lobby";
            this.world = null;
            for (const s of this.seats) if (s) s.ready = false;
            this.broadcastRoom();
          }
          break;
        case "voice":
          seat.voice = !!msg.on;
          this.broadcastRoom();
          break;
        case "sig": {
          const other = this.seats[seatIdx === 0 ? 1 : 0];
          if (other?.ws) this.send(other.ws, { t: "sig", d: msg.d });
          break;
        }
        case "ping":
          this.send(ws, { t: "pong", c: msg.c });
          break;
        case "leave":
          this.leave(seatIdx);
          try { ws.close(1000, "left"); } catch { /* already closed */ }
          break;
      }
    });

    const gone = () => {
      clearTimeout(helloTimer);
      if (seatIdx === -1) return;
      const seat = this.seats[seatIdx];
      if (!seat || seat.ws !== ws) return;
      seat.ws = null;
      seat.voice = false;
      if (this.status === "lobby" || this.status === "won" || this.status === "timeout") {
        this.seats[seatIdx] = null; // free the seat outside of a match
      } else {
        this.pausedSince = this.pausedSince || Date.now();
      }
      this.broadcastRoom();
      this.maybeStopLoop();
    };
    ws.addEventListener("close", gone);
    ws.addEventListener("error", gone);
  }

  private async join(ws: WebSocket, token: string): Promise<0 | 1 | -1> {
    if (!this.code) return this.close(ws, "This room doesn't exist", -1);
    if (Date.now() - this.createdAt > ROOM_TTL_MS) return this.close(ws, "This room has expired — create a new one", -1);

    let info: PlayerInfo | null = null;
    try {
      info = await playerFromToken(this.env, token);
    } catch (e) {
      return this.close(ws, (e as Error).message, -1);
    }
    if (!info) return this.close(ws, "Session expired — sign in again", -1);
    if (info.banned) return this.close(ws, "This account is suspended", -1);
    if (info.level < info.min_level) return this.close(ws, `Reach Level ${info.min_level} in the Lab to play Reptile Rush`, -1);

    // Reconnect to your own seat, or take a free one.
    let idx = this.seats.findIndex((s) => s?.info.id === info!.id) as 0 | 1 | -1;
    if (idx !== -1) {
      const old = this.seats[idx]!;
      if (old.ws && old.ws !== ws) this.close(old.ws, "Opened in another tab", -1);
      old.ws = ws;
      old.info = info;
      old.lastSeen = Date.now();
    } else {
      // The host always gets seat 0 if it's free; anyone else fills the gaps.
      idx = (info.id === this.hostId && !this.seats[0]) ? 0 : (this.seats.findIndex((s) => !s) as 0 | 1 | -1);
      if (idx === -1) return this.close(ws, "This room is full", -1);
      if (this.status !== "lobby") return this.close(ws, "A match is already running in this room", -1);
      this.seats[idx] = { info, ws, ready: false, voice: false, input: { ...NO_INPUT }, ack: 0, lastSeen: Date.now() };
    }

    if (this.seats[0]?.ws && this.seats[1]?.ws) this.pausedSince = 0;
    this.send(ws, { t: "welcome", seat: idx as 0 | 1, code: this.code });
    this.broadcastRoom();
    if (this.world) this.sendSnapshot();
    this.ensureLoop();
    return idx;
  }

  private leave(idx: 0 | 1) {
    const seat = this.seats[idx];
    if (!seat) return;
    this.seats[idx] = null;
    if (this.status === "countdown" || this.status === "playing") {
      this.status = "lobby";
      this.world = null;
      for (const s of this.seats) if (s) s.ready = false;
      const other = this.seats[idx === 0 ? 1 : 0];
      if (other?.ws) this.send(other.ws, { t: "err", msg: `@${seat.info.handle} left the match` });
    }
    this.broadcastRoom();
    this.maybeStopLoop();
  }

  // ── match flow ────────────────────────────────────────────────────
  private maybeStartCountdown() {
    const [a, b] = this.seats;
    if (this.status === "lobby" && a?.ready && b?.ready && a.ws && b.ws) {
      this.status = "countdown";
      this.countdownEnd = Date.now() + COUNTDOWN_MS;
      this.ensureLoop();
    }
  }

  private ensureLoop() {
    if (this.loop) return;
    this.lastTickAt = Date.now();
    this.acc = 0;
    this.loop = setInterval(() => this.tick(), 1000 / 60);
  }

  private maybeStopLoop() {
    const anyone = this.seats.some((s) => s?.ws);
    if (!anyone && this.loop) {
      clearInterval(this.loop);
      this.loop = null;
    }
  }

  private tick() {
    const now = Date.now();
    const elapsed = Math.min(250, now - this.lastTickAt);
    this.lastTickAt = now;

    if (this.status === "countdown") {
      if (!this.seats[0]?.ws || !this.seats[1]?.ws) {
        this.status = "lobby";
        this.broadcastRoom();
        return;
      }
      if (now >= this.countdownEnd) {
        this.status = "playing";
        this.world = newWorld();
        for (const s of this.seats) if (s) { s.input = { ...NO_INPUT, jp: s.input.jp }; }
        // jump counters persist per socket; start the world in sync with them
        if (this.world && this.seats[0] && this.seats[1]) {
          this.world.players[0].lastJp = this.seats[0].input.jp;
          this.world.players[1].lastJp = this.seats[1].input.jp;
        }
        this.startedAt = now;
        this.acc = 0;
        this.broadcastRoom();
        this.sendSnapshot();
      }
      return;
    }

    if (this.status !== "playing" || !this.world) return;

    // Pause while someone is reconnecting; abandon after the grace period.
    if (!this.seats[0]?.ws || !this.seats[1]?.ws) {
      if (this.pausedSince && now - this.pausedSince > RECONNECT_GRACE_MS) {
        this.status = "lobby";
        this.world = null;
        for (let i = 0 as 0 | 1; i < 2; i++) if (!this.seats[i]?.ws) this.seats[i] = null;
        for (const s of this.seats) if (s) s.ready = false;
        this.broadcastRoom();
        this.maybeStopLoop();
      }
      return;
    }

    this.acc += elapsed;
    const events: SimEvent[] = [];
    let ticks = 0;
    while (this.acc >= DT * 1000 && ticks < 8) {
      step(this.world, [this.seats[0].input, this.seats[1].input], undefined, events);
      this.acc -= DT * 1000;
      ticks++;
      if (this.world.tick % SNAPSHOT_EVERY === 0) this.sendSnapshot();
      if (this.world.status !== "playing") break;
    }

    const notable = events.filter((e) => e === "death" || e === "checkpoint");
    if (notable.length) this.broadcast({ t: "e", e: notable });

    if (this.world.status === "won") void this.finishWon();
    else if (this.world.status === "timeout") {
      this.status = "timeout";
      this.sendSnapshot();
      this.broadcast({ t: "timeout" });
      this.broadcastRoom();
    }
  }

  private async finishWon() {
    if (this.status !== "playing" || !this.world) return;
    this.status = "won";
    this.sendSnapshot();
    const ms = Math.round((this.world.tick / 60) * 1000);
    const deaths = this.world.deaths;
    const [a, b] = this.seats;
    let newWinners: string[] = [];
    let recorded = false;
    let error: string | undefined;
    try {
      const r = await recordWin(this.env, { room: this.code, p1: a!.info.id, p2: b!.info.id, duration_ms: ms, deaths });
      newWinners = r.new_winners ?? [];
      recorded = true;
    } catch (e) {
      error = "Couldn't save the result — screenshot this and contact the team.";
      console.error("recordWin failed", e);
    }
    for (const s of this.seats) {
      if (s?.ws) this.send(s.ws, { t: "won", ms, deaths, you_won: recorded && (newWinners.includes(s.info.id) || s.info.won), recorded, error });
      if (s) s.ready = false;
    }
    this.broadcastRoom();
  }

  // ── messaging ─────────────────────────────────────────────────────
  private seatView(s: Seat | null): SeatView | null {
    if (!s) return null;
    return {
      handle: s.info.handle, avatar_url: s.info.avatar_url, reptilio_id: s.info.reptilio_id, level: s.info.level,
      ready: s.ready, connected: !!s.ws, voice: s.voice, won_before: s.info.won,
    };
  }

  private broadcastRoom() {
    const msg: ServerMsg = {
      t: "room",
      status: this.status,
      seats: [this.seatView(this.seats[0]), this.seatView(this.seats[1])],
      countdown_ms: this.status === "countdown" ? Math.max(0, this.countdownEnd - Date.now()) : 0,
      paused: this.status === "playing" && !(this.seats[0]?.ws && this.seats[1]?.ws),
    };
    this.broadcast(msg);
  }

  private sendSnapshot() {
    if (!this.world) return;
    const [a, b] = this.seats;
    const msg: ServerMsg = {
      t: "s",
      w: packWorld(this.world),
      a: [a?.ack ?? 0, b?.ack ?? 0],
      i: [
        [((a?.input.left ? 1 : 0) | (a?.input.right ? 2 : 0) | (a?.input.jump ? 4 : 0) | (a?.input.anchor ? 8 : 0)), a?.input.jp ?? 0],
        [((b?.input.left ? 1 : 0) | (b?.input.right ? 2 : 0) | (b?.input.jump ? 4 : 0) | (b?.input.anchor ? 8 : 0)), b?.input.jp ?? 0],
      ],
    };
    this.broadcast(msg);
  }

  private broadcast(msg: ServerMsg) {
    const data = JSON.stringify(msg);
    for (const s of this.seats) if (s?.ws) try { s.ws.send(data); } catch { /* dropped */ }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try { ws.send(JSON.stringify(msg)); } catch { /* dropped */ }
  }

  private close<T>(ws: WebSocket, reason: string, ret?: T): T {
    this.send(ws, { t: "err", msg: reason, fatal: true });
    try { ws.close(4000, reason.slice(0, 120)); } catch { /* already closed */ }
    return ret as T;
  }
}
