/** Messages between the browser and the Rush room server (JSON over WebSocket). */

export type RoomStatus = "lobby" | "countdown" | "playing" | "won" | "timeout";

export type SeatView = {
  handle: string;
  avatar_url: string;
  reptilio_id: string;
  level: number;
  ready: boolean;
  connected: boolean;
  voice: boolean;
  won_before: boolean;
};

export type ClientMsg =
  | { t: "hello"; token: string }
  | { t: "ready"; v: boolean }
  | { t: "in"; s: number; b: number; jp: number }
  | { t: "sig"; d: unknown }
  | { t: "voice"; on: boolean }
  | { t: "ping"; c: number }
  | { t: "again" }
  | { t: "leave" };

export type ServerMsg =
  | { t: "welcome"; seat: 0 | 1; code: string }
  | { t: "room"; status: RoomStatus; seats: [SeatView | null, SeatView | null]; countdown_ms: number; paused: boolean }
  | { t: "s"; w: unknown[]; a: [number, number]; i: [[number, number], [number, number]] }
  | { t: "e"; e: string[] }
  | { t: "won"; ms: number; deaths: number; you_won: boolean; recorded: boolean; error?: string }
  | { t: "timeout" }
  | { t: "sig"; d: unknown }
  | { t: "pong"; c: number }
  | { t: "err"; msg: string; fatal?: boolean };

export const SNAPSHOT_EVERY = 3; // ticks → 20 snapshots/s
export const COUNTDOWN_MS = 3000;
export const RECONNECT_GRACE_MS = 60_000;
