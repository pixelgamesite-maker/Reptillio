/**
 * Stage 1 — "The Overgrown Temple". Built from rectangles so it's easy to
 * tweak; every section is proven clearable by the bot in rush.test.ts.
 *
 * Legend: # solid · ^ spikes · a/b plates · A/B gates (open while a matching
 * plate is pressed) · C checkpoint · E exit · 1/2 spawn · . air
 *
 * Numbers that make it co-op (see PHYS in sim.ts):
 *   jump height ≈ 114px (3.5 tiles) · rope 224px (7 tiles)
 *   - Gate A: one holds a plate, the other walks through and holds the far plate.
 *   - Temple wall: 4 tiles (128px) — too high to jump alone. Stand on your
 *     partner's head to get up, then ANCHOR and REEL them up after you.
 *   - The Well: a 4-tile shaft with plate b at the bottom opens Gate B.
 *     Drop in, hold the plate, partner goes through and stands on the far
 *     plate, then anchors and reels you out through the gate.
 *   - Final run: jumps over a spike pit to the exit. Both must be inside.
 */
export type Stage = {
  name: string;
  w: number;
  h: number;
  rows: string[];
  spawn: { tx: number; ty: number };
  checkpoints: { tx: number; ty: number }[];
};

function build(): Stage {
  const W = 128, H = 20;
  const g: string[][] = Array.from({ length: H }, () => Array(W).fill("."));
  const fill = (x0: number, y0: number, x1: number, y1: number, c: string) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) g[y][x] = c;
  };

  // frame + ground (top surface row 15)
  fill(0, 0, W - 1, 0, "#");
  fill(0, 0, 0, H - 1, "#");
  fill(W - 1, 0, W - 1, H - 1, "#");
  fill(0, 15, W - 1, H - 1, "#");

  // ── 1. Warm-up: steps and a small spike pit ──
  fill(10, 14, 13, 14, "#");
  fill(14, 13, 17, 14, "#");
  fill(21, 15, 23, 17, ".");
  fill(21, 17, 23, 17, "^");
  g[14][28] = "C";

  // ── 2. Gate A: plate on each side ──
  g[14][32] = "a";
  fill(36, 1, 36, 8, "#");
  fill(36, 9, 36, 14, "A");
  g[14][39] = "a";
  g[14][43] = "C";

  // ── 3. Temple wall (4 tiles) + plateau (top surface row 11) ──
  fill(48, 11, 80, 14, "#");
  g[10][56] = "C";

  // ── 4. The Well + Gate B ──
  fill(62, 11, 63, 14, ".");
  g[14][62] = "b";
  fill(65, 1, 65, 4, "#");
  fill(65, 5, 65, 10, "B");
  g[10][67] = "b";
  g[10][72] = "C";

  // ── 5. Final run over a spike pit ──
  fill(81, 15, 106, 17, ".");
  fill(81, 18, 106, 18, "^");
  fill(83, 12, 85, 14, "#");
  fill(89, 13, 91, 14, "#");
  fill(95, 11, 96, 14, "#");
  fill(101, 12, 103, 14, "#");
  fill(107, 13, 126, 18, "#");
  g[12][109] = "C";
  fill(120, 11, 121, 12, "E");

  const rows = g.map((r) => r.join(""));
  const checkpoints: { tx: number; ty: number }[] = [];
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) if (rows[y][x] === "C") checkpoints.push({ tx: x, ty: y });
  return { name: "The Overgrown Temple", w: W, h: H, rows, spawn: { tx: 4, ty: 14 }, checkpoints };
}

export const STAGE: Stage = build();
export const STAGE_INFO = { name: STAGE.name, checkpoints: STAGE.checkpoints.length };
