/**
 * Reptile Rush stages. Built from rectangles so they're easy to tweak.
 * Every stage is proven clearable by the bot in rush.test.ts — and the
 * troll traps are proven to kill a player who walks in naively.
 *
 * Tile legend:
 *   # solid · ^ spikes · a/b plates · A/B gates (open while a matching plate
 *   is pressed) · C checkpoint · E exit · f FAKE block (looks solid, isn't)
 *
 * Troll traps (server-side state, see sim.ts):
 *   collapse  — solid tiles that drop away after something triggers them
 *   spikes    — spikes that pop out of the floor when you get close
 *   invisible — solid tiles you can't see until someone touches them
 *   runaway   — the exit jumps somewhere nastier the first time you approach
 * Collapses and pop-up spikes reset when you die (you know where they are
 * now). Revealed blocks and a moved exit stay that way.
 *
 * Physics reference (sim.ts): jump ≈ 114px high (3.5 tiles), ≈ 149px far
 * (4.6 tiles); rope 224px (7 tiles).
 */
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type Trap =
  | { kind: "collapse"; tiles: Rect; zone?: Rect; plate?: "a" | "b"; delay: number }
  | { kind: "spikes"; tiles: Rect; zone: Rect; delay: number }
  | { kind: "invisible"; tiles: Rect }
  | { kind: "runaway"; zone: Rect; to: Rect };

export type Stage = {
  name: string;
  tagline: string;
  w: number;
  h: number;
  rows: string[];
  spawn: { tx: number; ty: number };
  checkpoints: { tx: number; ty: number }[];
  exit: Rect;
  traps: Trap[];
  /** trap index per tile (-1 = none), for fast lookups */
  trapAt: Int16Array;
};

const R = (x0: number, y0: number, x1: number, y1: number): Rect => ({ x0, y0, x1, y1 });

function canvas(W: number, H: number) {
  const g: string[][] = Array.from({ length: H }, () => Array(W).fill("."));
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };
  // frame + ground (top surface row 15)
  fill(0, 0, W - 1, 0, "#");
  fill(0, 0, 0, H - 1, "#");
  fill(W - 1, 0, W - 1, H - 1, "#");
  fill(0, 15, W - 1, H - 1, "#");
  return { g, fill };
}

function finish(name: string, tagline: string, g: string[][], spawn: { tx: number; ty: number }, traps: Trap[]): Stage {
  const W = g[0].length, H = g.length;
  const rows = g.map((r) => r.join(""));
  const checkpoints: { tx: number; ty: number }[] = [];
  let ex: Rect | null = null;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (rows[y][x] === "C") checkpoints.push({ tx: x, ty: y });
      if (rows[y][x] === "E") ex = ex ? R(Math.min(ex.x0, x), Math.min(ex.y0, y), Math.max(ex.x1, x), Math.max(ex.y1, y)) : R(x, y, x, y);
    }
  }
  const trapAt = new Int16Array(W * H).fill(-1);
  traps.forEach((t, i) => {
    if (t.kind === "runaway") return;
    for (let y = t.tiles.y0; y <= t.tiles.y1; y++) for (let x = t.tiles.x0; x <= t.tiles.x1; x++) trapAt[y * W + x] = i;
  });
  return { name, tagline, w: W, h: H, rows, spawn, checkpoints, exit: ex ?? R(W - 3, 13, W - 2, 14), traps, trapAt };
}

// ── Stage 1 — learn the moves ────────────────────────────────────────────
function stage1(): Stage {
  const { g, fill } = canvas(128, 20);
  // 1. Warm-up: steps and a small spike pit
  fill(10, 14, 13, 14, "#");
  fill(14, 13, 17, 14, "#");
  fill(21, 15, 23, 17, ".");
  fill(21, 17, 23, 17, "^");
  g[14][28] = "C";
  // 2. Gate A: plate on each side
  g[14][32] = "a";
  fill(36, 1, 36, 8, "#");
  fill(36, 9, 36, 14, "A");
  g[14][39] = "a";
  g[14][43] = "C";
  // 3. Temple wall (4 tiles) + plateau (top surface row 11)
  fill(48, 11, 80, 14, "#");
  g[10][56] = "C";
  // 4. The Well + Gate B
  fill(62, 11, 63, 14, ".");
  g[14][62] = "b";
  fill(65, 1, 65, 4, "#");
  fill(65, 5, 65, 10, "B");
  g[10][67] = "b";
  g[10][72] = "C";
  // 5. Final run over a spike pit
  fill(81, 15, 106, 17, ".");
  fill(81, 18, 106, 18, "^");
  fill(83, 12, 85, 14, "#");
  fill(89, 13, 91, 14, "#");
  fill(95, 11, 96, 14, "#");
  fill(101, 12, 103, 14, "#");
  fill(107, 13, 126, 18, "#");
  g[12][109] = "C";
  fill(120, 11, 121, 12, "E");
  return finish("The Overgrown Temple", "Learn to anchor, reel and climb together.", g, { tx: 4, ty: 14 }, []);
}

// ── Stage 2 — The Devil's Gauntlet (troll stage) ─────────────────────────
function stage2(): Stage {
  const { g, fill } = canvas(112, 20);
  const pit = (x0: number, x1: number) => {
    fill(x0, 16, x1, 17, ".");
    fill(x0, 18, x1, 18, "^");
  };
  const traps: Trap[] = [];

  // A. "Welcome" — the floor right ahead drops into spikes as you walk on it.
  pit(9, 11);
  traps.push({ kind: "collapse", tiles: R(9, 15, 11, 15), zone: R(9, 11, 11, 14), delay: 4 });
  g[14][15] = "C";

  // B. A calm, flat runway… spikes pop out two tiles after you step in.
  traps.push({ kind: "spikes", tiles: R(24, 14, 25, 14), zone: R(22, 9, 23, 14), delay: 0 });
  g[14][30] = "C";

  // C. A bridge over spikes. Two of its blocks are fakes.
  fill(35, 15, 41, 17, ".");
  fill(35, 18, 41, 18, "^");
  fill(35, 15, 41, 15, "#");
  fill(38, 15, 39, 15, "f");
  g[14][45] = "C";

  // D. A pit too wide to jump… unless you find the invisible stepping stones.
  fill(50, 15, 55, 17, ".");
  fill(50, 18, 55, 18, "^");
  traps.push({ kind: "invisible", tiles: R(52, 15, 54, 15) });
  g[14][60] = "C";

  // E. Partner trap: the plate opens the gate… and drops the floor where your
  //    partner is standing, waiting for the gate, half a second later.
  g[14][66] = "a";
  pit(68, 69);
  traps.push({ kind: "collapse", tiles: R(68, 15, 69, 15), plate: "a", delay: 30 });
  fill(70, 1, 70, 8, "#");
  fill(70, 9, 70, 14, "A");
  g[14][72] = "a";
  g[14][77] = "C";

  // F. More pop-up spikes, then the exit… runs away up a 4-tile wall.
  traps.push({ kind: "spikes", tiles: R(84, 14, 85, 14), zone: R(81, 9, 82, 14), delay: 6 });
  fill(90, 13, 91, 14, "E");
  fill(101, 11, 110, 14, "#");
  traps.push({ kind: "runaway", zone: R(87, 9, 89, 14), to: R(106, 9, 107, 10) });

  return finish("The Devil's Gauntlet", "Nothing here is what it looks like.", g, { tx: 4, ty: 14 }, traps);
}

export const STAGES: Stage[] = [stage1(), stage2()];
export const STAGE: Stage = STAGES[0];
export const STAGE_INFO = {
  name: STAGES.map((s) => s.name).join(" → "),
  stages: STAGES.map((s) => ({ name: s.name, tagline: s.tagline, checkpoints: s.checkpoints.length })),
  checkpoints: STAGE.checkpoints.length,
};
