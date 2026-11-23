/**
 * Browser side of Reptile Rush networking.
 *
 * The server is authoritative. To keep controls snappy anyway, we run the
 * same simulation locally: every server snapshot is taken as truth, then
 * the last few ticks of OUR inputs are replayed on top of it (≈ half the
 * round-trip). Rendered positions ease toward the corrected result so
 * corrections never snap.
 */
import { supabase, DEMO } from "./supabase";
import { cloneWorld, decodeInput, encodeInput, step, unpackWorld, NO_INPUT, type Input, type World, DT } from "../../shared/rush/sim";
import type { RoomStatus, SeatView, ServerMsg } from "../../shared/rush/protocol";

export const RUSH_URL = (import.meta.env.VITE_RUSH_URL || "http://127.0.0.1:8787").replace(/\/$/, "");

/** Supabase access token, or a dev token in demo mode (server must run with DEV_AUTH=true). */
export async function rushToken(demoHandle?: string, demoLevel?: number) {
  if (DEMO) return `dev:${demoHandle ?? "reptile_fan"}:${demoLevel ?? 3}`;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? "";
}

async function call<T>(path: string, token: string, method = "POST"): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${RUSH_URL}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error("Can't reach the Rush server — check your connection.");
  }
  const body = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(body.error || `Server error (${r.status})`);
  return body;
}

export const createRoom = (token: string) => call<{ code: string }>("/rooms", token);
export const roomInfo = (code: string) => call<{ exists: boolean; status?: RoomStatus; players?: number }>(`/rooms/${code}`, "", "GET");
export const fetchIce = (token: string) => call<{ iceServers: RTCIceServer[] }>("/ice", token).then((r) => r.iceServers);

export type RushListener = {
  onRoom?: (status: RoomStatus, seats: [SeatView | null, SeatView | null], countdownMs: number, paused: boolean) => void;
  onEvent?: (e: string) => void;
  onWon?: (msg: Extract<ServerMsg, { t: "won" }>) => void;
  onTimeout?: () => void;
  onSignal?: (d: unknown) => void;
  onError?: (msg: string, fatal: boolean) => void;
  onClose?: () => void;
};

export class RushClient {
  seat: 0 | 1 = 0;
  connected = false;
  rttMs = 120;

  /** Latest authoritative world and the locally predicted one we render. */
  server: World | null = null;
  predicted: World | null = null;
  /** Visual easing offsets per player (px), decay toward 0. */
  smooth = [{ x: 0, y: 0 }, { x: 0, y: 0 }];

  private ws: WebSocket | null = null;
  private input: Input = { ...NO_INPUT };
  private partnerInput: Input = { ...NO_INPUT };
  private history: Input[] = []; // our input per local tick, newest last
  private seq = 0;
  private lastSent = "";
  private lastSentAt = 0;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closedByUs = false;

  constructor(private code: string, private token: string, private l: RushListener) {}

  connect() {
    const url = `${RUSH_URL.replace(/^http/, "ws")}/rooms/${this.code}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", token: this.token }));
      this.connected = true;
      this.pingTimer = setInterval(() => this.send({ t: "ping", c: performance.now() }), 2000);
    };
    ws.onmessage = (e) => this.onMessage(JSON.parse(String(e.data)) as ServerMsg);
    ws.onclose = () => {
      this.connected = false;
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.closedByUs) this.l.onClose?.();
    };
  }

  close() {
    this.closedByUs = true;
    this.send({ t: "leave" });
    if (this.pingTimer) clearInterval(this.pingTimer);
    try { this.ws?.close(); } catch { /* no-op */ }
  }

  send(m: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  ready(v: boolean) { this.send({ t: "ready", v }); }
  again() { this.send({ t: "again" }); }
  voice(on: boolean) { this.send({ t: "voice", on }); }
  signal(d: unknown) { this.send({ t: "sig", d }); }

  /** Called by the controls whenever buttons change. */
  setInput(next: Partial<Input>) {
    this.input = { ...this.input, ...next };
  }
  pressJump() {
    this.input = { ...this.input, jump: true, jp: this.input.jp + 1 };
  }

  /** Advance local prediction one fixed tick and send input if it changed. */
  tickLocal() {
    if (!this.predicted || this.predicted.status !== "playing") return;
    const inputs: [Input, Input] = this.seat === 0 ? [this.input, this.partnerInput] : [this.partnerInput, this.input];
    const before = this.predicted.players.map((p) => ({ x: p.x, y: p.y }));
    step(this.predicted, inputs);
    // a respawn shouldn't be eased — jump straight there
    this.predicted.players.forEach((p, i) => {
      if (Math.abs(p.x - before[i].x) > 64 || Math.abs(p.y - before[i].y) > 64) this.smooth[i] = { x: 0, y: 0 };
    });
    this.history.push({ ...this.input });
    if (this.history.length > 30) this.history.shift();

    const [b, jp] = encodeInput(this.input);
    const key = `${b}:${jp}`;
    const now = performance.now();
    if (key !== this.lastSent || now - this.lastSentAt > 250) {
      this.send({ t: "in", s: ++this.seq, b, jp });
      this.lastSent = key;
      this.lastSentAt = now;
    }
    for (const s of this.smooth) { s.x *= 0.82; s.y *= 0.82; }
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case "welcome":
        this.seat = m.seat;
        break;
      case "room":
        this.l.onRoom?.(m.status, m.seats, m.countdown_ms, m.paused);
        if (m.status === "lobby") { this.server = null; this.predicted = null; }
        break;
      case "s": {
        const w = unpackWorld(m.w);
        const other = this.seat === 0 ? 1 : 0;
        this.partnerInput = decodeInput(m.i[other][0], m.i[other][1]);
        this.server = w;
        this.reconcile(w);
        break;
      }
      case "e":
        m.e.forEach((e) => this.l.onEvent?.(e));
        break;
      case "won":
        this.l.onWon?.(m);
        break;
      case "timeout":
        this.l.onTimeout?.();
        break;
      case "sig":
        this.l.onSignal?.(m.d);
        break;
      case "pong":
        this.rttMs = this.rttMs * 0.7 + (performance.now() - m.c) * 0.3;
        break;
      case "err":
        this.l.onError?.(m.msg, !!m.fatal);
        break;
    }
  }

  /** Snapshot arrived: rebase on it, replay our recent inputs, ease the visual difference. */
  private reconcile(w: World) {
    const prev = this.predicted;
    const next = cloneWorld(w);
    if (next.status === "playing") {
      const n = Math.max(0, Math.min(this.history.length, Math.round(this.rttMs / 2 / (DT * 1000)) + 1));
      const replay = this.history.slice(this.history.length - n);
      for (const mine of replay) {
        const inputs: [Input, Input] = this.seat === 0 ? [mine, this.partnerInput] : [this.partnerInput, mine];
        step(next, inputs);
      }
    }
    if (prev) {
      next.players.forEach((p, i) => {
        const dx = prev.players[i].x + this.smooth[i].x - p.x;
        const dy = prev.players[i].y + this.smooth[i].y - p.y;
        // big jumps (respawn, first sync) snap; small ones ease
        this.smooth[i] = Math.hypot(dx, dy) > 96 ? { x: 0, y: 0 } : { x: dx, y: dy };
      });
    }
    this.predicted = next;
  }
}
