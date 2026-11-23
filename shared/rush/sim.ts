/**
 * Reptile Rush — shared physics. The SAME code runs on the game server
 * (authoritative: it decides deaths and wins) and in the browser (to
 * predict your own movement instantly). Pure functions, no DOM, no timers.
 *
 * Mechanics
 *  - Two reptiles joined by a rope (max ROPE_MAX px). Slack until stretched.
 *  - ANCHOR (hold while on the ground): you become an immovable anchor.
 *  - REEL: while anchored, hold JUMP to pull your partner in.
 *  - You can land on your partner's head (one-way) to reach higher ledges.
 *  - Plates (a, b) hold gates (A, B) open while someone stands on them.
 *  - Spikes / falling out = both respawn at the last checkpoint.
 *  - Both inside the exit = stage cleared.
 */
import { STAGE, type Stage } from "./stage";

export const TILE = 32;
export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;

export const PHYS = {
  w: 22,
  h: 26,
  gravity: 1800,
  maxFall: 950,
  runMax: 210,
  accelGround: 2600,
  accelAir: 1500,
  friction: 2800,
  airDrag: 500,
  jumpV: 640,
  jumpCutV: 260,
  coyote: 0.09,
  jumpBuffer: 0.12,
  ropeMax: 224,
  ropeMin: 20,
  mantle: 12, // being reeled: hop onto a ledge whose top is within this many px of your feet
  reelSpeed: 170,
  unreelSpeed: 260,
  groundedWeight: 0.35,
  timeLimitSec: 600,
};

export type Input = {
  left: boolean;
  right: boolean;
  jump: boolean;
  anchor: boolean;
  /** monotonically increasing count of jump presses — makes quick taps impossible to miss */
  jp: number;
};
export const NO_INPUT: Input = { left: false, right: false, jump: false, anchor: false, jp: 0 };

export type Player = {
  x: number; // top-left
  y: number;
  vx: number;
  vy: number;
  grounded: boolean;
  anchored: boolean;
  jumping: boolean;
  facing: 1 | -1;
  coyote: number;
  buffer: number;
  lastJp: number;
};

export type Status = "playing" | "won" | "timeout";

export type World = {
  tick: number;
  players: [Player, Player];
  rope: number;
  checkpoint: number; // index into stage.checkpoints (0 = spawn)
  deaths: number;
  open: number; // bitmask of open gate letters (bit 0 = A)
  status: Status;
};

export type SimEvent = "death" | "checkpoint" | "win" | "timeout";

// ── stage helpers ──────────────────────────────────────────────────────
const at = (s: Stage, tx: number, ty: number) => {
  if (tx < 0 || tx >= s.w || ty < 0) return "#";
  if (ty >= s.h) return ".";
  return s.rows[ty][tx];
};
const gateBit = (ch: string) => 1 << (ch.charCodeAt(0) - 65); // 'A' → bit 0
const plateBit = (ch: string) => 1 << (ch.charCodeAt(0) - 97); // 'a' → bit 0

function solidAt(s: Stage, w: World, tx: number, ty: number) {
  const c = at(s, tx, ty);
  if (c === "#") return true;
  if (c === "A" || c === "B") return (w.open & gateBit(c)) === 0;
  return false;
}

function boxHitsSolid(s: Stage, w: World, x: number, y: number) {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + PHYS.w - 0.001) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + PHYS.h - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (solidAt(s, w, tx, ty)) return true;
  return false;
}

function boxTouches(s: Stage, x: number, y: number, ch: (c: string) => boolean, inset = 0) {
  const x0 = Math.floor((x + inset) / TILE), x1 = Math.floor((x + PHYS.w - inset - 0.001) / TILE);
  const y0 = Math.floor((y + inset) / TILE), y1 = Math.floor((y + PHYS.h - inset - 0.001) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (ch(at(s, tx, ty))) return { tx, ty };
  return null;
}

/** Move along x with tile collision, in ≤8px steps (no tunnelling). Returns true if blocked. */
function moveX(s: Stage, w: World, p: Player, dx: number) {
  if (dx === 0) return false;
  const steps = Math.ceil(Math.abs(dx) / 8);
  const step = dx / steps;
  for (let i = 0; i < steps; i++) {
    const nx = p.x + step;
    if (boxHitsSolid(s, w, nx, p.y)) {
      if (step > 0) p.x = Math.floor((nx + PHYS.w) / TILE) * TILE - PHYS.w - 0.001;
      else p.x = Math.floor(nx / TILE) * TILE + TILE + 0.001;
      return true;
    }
    p.x = nx;
  }
  return false;
}

/** Move along y. Landing on the partner's head counts as ground (one-way). */
function moveY(s: Stage, w: World, p: Player, dy: number, other: Player | null): "floor" | "ceiling" | null {
  if (dy === 0) return null;
  const steps = Math.ceil(Math.abs(dy) / 8);
  const step = dy / steps;
  for (let i = 0; i < steps; i++) {
    const ny = p.y + step;
    if (step > 0 && other) {
      const overlapX = p.x < other.x + PHYS.w - 2 && p.x + PHYS.w > other.x + 2;
      if (overlapX && p.y + PHYS.h <= other.y + 0.5 && ny + PHYS.h > other.y) {
        p.y = other.y - PHYS.h;
        return "floor";
      }
    }
    if (boxHitsSolid(s, w, p.x, ny)) {
      if (step > 0) {
        p.y = Math.floor((ny + PHYS.h) / TILE) * TILE - PHYS.h - 0.001;
        return "floor";
      }
      p.y = Math.floor(ny / TILE) * TILE + TILE + 0.001;
      return "ceiling";
    }
    p.y = ny;
  }
  return null;
}

const center = (p: Player) => ({ x: p.x + PHYS.w / 2, y: p.y + PHYS.h / 2 });

/** While being reeled into a wall, get pulled up over its lip. Reel-only, so it never helps a solo climb. */
function tryMantle(s: Stage, w: World, p: Player, dir: number) {
  if (dir === 0) return;
  const front = dir > 0 ? p.x + PHYS.w + 1 : p.x - 1;
  const tx = Math.floor(front / TILE);
  const bottom = p.y + PHYS.h;
  const ty = Math.floor((bottom - 1) / TILE);
  if (!solidAt(s, w, tx, ty) || solidAt(s, w, tx, ty - 1)) return;
  const top = ty * TILE;
  if (bottom - top > PHYS.mantle) return;
  const ny = top - PHYS.h - 0.001;
  const nx = p.x + dir * 3;
  if (boxHitsSolid(s, w, nx, ny)) return;
  p.x = nx;
  p.y = ny;
  p.vy = 0;
  p.grounded = true;
}

// ── world lifecycle ────────────────────────────────────────────────────
function placeAt(s: Stage, idx: number): [Player, Player] {
  const c = idx === 0 ? s.spawn : s.checkpoints[idx - 1];
  const mk = (cx: number): Player => ({
    x: cx - PHYS.w / 2,
    y: c.ty * TILE + TILE - PHYS.h - 0.001,
    vx: 0, vy: 0, grounded: true, anchored: false, jumping: false, facing: 1, coyote: 0, buffer: 0, lastJp: 0,
  });
  const base = c.tx * TILE + TILE / 2;
  return [mk(base - 14), mk(base + 14)];
}

export function newWorld(s: Stage = STAGE): World {
  return { tick: 0, players: placeAt(s, 0), rope: PHYS.ropeMax, checkpoint: 0, deaths: 0, open: 0, status: "playing" };
}

export function cloneWorld(w: World): World {
  return { ...w, players: [{ ...w.players[0] }, { ...w.players[1] }] };
}

// ── one fixed step ─────────────────────────────────────────────────────
export function step(w: World, inputs: [Input, Input], s: Stage = STAGE, events?: SimEvent[]): World {
  if (w.status !== "playing") return w;
  const ps = w.players;

  // 1. Each player's own motion
  for (let i = 0; i < 2; i++) {
    const p = ps[i];
    const inp = inputs[i];
    const other = ps[1 - i];

    // keep jp in sync after respawns/reconnects (never consume old presses)
    if (inp.jp < p.lastJp) p.lastJp = inp.jp;
    if (inp.jp > p.lastJp) {
      p.buffer = PHYS.jumpBuffer;
      p.lastJp = inp.jp;
    }

    p.anchored = p.grounded && inp.anchor;
    if (p.anchored) {
      p.vx = 0;
      p.buffer = 0; // jump while anchored = reel, not jump
    } else {
      const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      if (dir !== 0) {
        p.vx += dir * (p.grounded ? PHYS.accelGround : PHYS.accelAir) * DT;
        p.vx = Math.max(-PHYS.runMax, Math.min(PHYS.runMax, p.vx));
        p.facing = dir as 1 | -1;
      } else {
        const f = (p.grounded ? PHYS.friction : PHYS.airDrag) * DT;
        p.vx = Math.abs(p.vx) <= f ? 0 : p.vx - Math.sign(p.vx) * f;
      }
    }

    p.coyote = p.grounded ? PHYS.coyote : p.coyote - DT;
    p.buffer -= DT;
    if (p.buffer > 0 && p.coyote > 0 && !p.anchored) {
      p.vy = -PHYS.jumpV;
      p.buffer = 0;
      p.coyote = 0;
      p.grounded = false;
      p.jumping = true;
    }
    if (p.jumping && !inp.jump && p.vy < -PHYS.jumpCutV) p.vy = -PHYS.jumpCutV; // short hop on release
    if (p.vy >= 0) p.jumping = false;

    p.vy = Math.min(PHYS.maxFall, p.vy + PHYS.gravity * DT);

    if (moveX(s, w, p, p.vx * DT)) p.vx = 0;
    const hit = moveY(s, w, p, p.vy * DT, other);
    if (hit === "floor") {
      p.grounded = true;
      p.vy = 0;
      p.jumping = false;
    } else {
      p.grounded = false;
      if (hit === "ceiling") p.vy = 0;
    }
  }

  // 2. Rope length: anchored + holding jump reels in; otherwise it pays back out
  const reeling = (ps[0].anchored && inputs[0].jump) || (ps[1].anchored && inputs[1].jump);
  w.rope = reeling
    ? Math.max(PHYS.ropeMin, w.rope - PHYS.reelSpeed * DT)
    : Math.min(PHYS.ropeMax, w.rope + PHYS.unreelSpeed * DT);

  // 3. Rope constraint (distance ≤ rope), position + velocity
  for (let iter = 0; iter < 2; iter++) {
    const a = ps[0], b = ps[1];
    const ca = center(a), cb = center(b);
    const dx = cb.x - ca.x, dy = cb.y - ca.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= w.rope || dist === 0) break;
    const nx = dx / dist, ny = dy / dist;
    const wa = a.anchored ? 0 : a.grounded ? PHYS.groundedWeight : 1;
    const wb = b.anchored ? 0 : b.grounded ? PHYS.groundedWeight : 1;
    if (wa + wb === 0) break;
    const excess = dist - w.rope;
    const ka = (excess * wa) / (wa + wb), kb = (excess * wb) / (wa + wb);
    if (ka) {
      moveX(s, w, a, nx * ka);
      if (moveY(s, w, a, ny * ka, b) === null && ny * ka < 0) a.grounded = false;
    }
    if (kb) {
      moveX(s, w, b, -nx * kb);
      if (moveY(s, w, b, -ny * kb, a) === null && -ny * kb < 0) b.grounded = false;
    }
    if (reeling) {
      if (wa > 0 && !a.anchored) tryMantle(s, w, a, Math.sign(nx));
      if (wb > 0 && !b.anchored) tryMantle(s, w, b, -Math.sign(nx));
    }
    const vrel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (vrel > 0) {
      const ia = (vrel * wa) / (wa + wb), ib = (vrel * wb) / (wa + wb);
      a.vx += nx * ia; a.vy += ny * ia;
      b.vx -= nx * ib; b.vy -= ny * ib;
    }
  }

  // 4. Plates → gates (a gate never closes on someone standing in it)
  let pressed = 0;
  for (const p of ps) {
    if (!p.grounded) continue;
    const c = at(s, Math.floor((p.x + PHYS.w / 2) / TILE), Math.floor((p.y + PHYS.h - 2) / TILE));
    if (c === "a" || c === "b") pressed |= plateBit(c);
  }
  let open = pressed;
  for (const p of ps) {
    const g = boxTouches(s, p.x, p.y, (c) => c === "A" || c === "B");
    if (g) open |= gateBit(at(s, g.tx, g.ty)) & w.open;
  }
  w.open = open;

  // 5. Hazards, checkpoints, exit
  let died = false;
  for (const p of ps) {
    if (p.y > s.h * TILE + 64) died = true;
    if (boxTouches(s, p.x, p.y, (c) => c === "^", 5)) died = true;
  }
  if (died) {
    w.deaths++;
    w.players = placeAt(s, w.checkpoint);
    // carry jump counters across the respawn so stale presses aren't replayed
    w.players[0].lastJp = ps[0].lastJp;
    w.players[1].lastJp = ps[1].lastJp;
    w.rope = PHYS.ropeMax;
    events?.push("death");
  } else {
    for (const p of ps) {
      const hit = boxTouches(s, p.x, p.y, (c) => c === "C");
      if (hit) {
        const idx = s.checkpoints.findIndex((c) => c.tx === hit.tx && c.ty === hit.ty) + 1;
        if (idx > w.checkpoint) {
          w.checkpoint = idx;
          events?.push("checkpoint");
        }
      }
    }
    const inExit = (p: Player) => !!boxTouches(s, p.x, p.y, (c) => c === "E", 4);
    if (inExit(ps[0]) && inExit(ps[1])) {
      w.status = "won";
      events?.push("win");
    }
  }

  w.tick++;
  if (w.status === "playing" && w.tick >= PHYS.timeLimitSec * TICK_HZ) {
    w.status = "timeout";
    events?.push("timeout");
  }
  return w;
}

// ── network encoding (compact arrays, shared by server + client) ───────
export function encodeInput(i: Input): [number, number] {
  return [(i.left ? 1 : 0) | (i.right ? 2 : 0) | (i.jump ? 4 : 0) | (i.anchor ? 8 : 0), i.jp];
}
export function decodeInput(bits: number, jp: number): Input {
  return { left: !!(bits & 1), right: !!(bits & 2), jump: !!(bits & 4), anchor: !!(bits & 8), jp: jp | 0 };
}

type PackedPlayer = [number, number, number, number, number, number, number, number, number];
const r2 = (n: number) => Math.round(n * 100) / 100;

export function packWorld(w: World): unknown[] {
  const pp = (p: Player): PackedPlayer => [
    r2(p.x), r2(p.y), r2(p.vx), r2(p.vy),
    (p.grounded ? 1 : 0) | (p.anchored ? 2 : 0) | (p.jumping ? 4 : 0) | (p.facing < 0 ? 8 : 0),
    r2(p.coyote), r2(p.buffer), p.lastJp, 0,
  ];
  return [w.tick, pp(w.players[0]), pp(w.players[1]), r2(w.rope), w.checkpoint, w.deaths, w.open, w.status];
}

export function unpackWorld(a: unknown[]): World {
  const up = (q: PackedPlayer): Player => ({
    x: q[0], y: q[1], vx: q[2], vy: q[3],
    grounded: !!(q[4] & 1), anchored: !!(q[4] & 2), jumping: !!(q[4] & 4), facing: q[4] & 8 ? -1 : 1,
    coyote: q[5], buffer: q[6], lastJp: q[7],
  });
  return {
    tick: a[0] as number,
    players: [up(a[1] as PackedPlayer), up(a[2] as PackedPlayer)],
    rope: a[3] as number,
    checkpoint: a[4] as number,
    deaths: a[5] as number,
    open: a[6] as number,
    status: a[7] as Status,
  };
}
