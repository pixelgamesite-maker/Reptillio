/**
 * Scripted co-op duo used by the tests to prove every stage is clearable.
 * The bot "knows" where the trolls are (like a duo on their second try).
 */
import { STAGES } from "./stage";
import { PHYS, TILE, type World } from "./sim";

export type Ctl = { l?: boolean; r?: boolean; jump?: boolean; press?: boolean; anchor?: boolean };
export type Phase = { name: string; run: (w: World, t: number) => [Ctl, Ctl] | "done"; maxSec?: number };

export const cx = (w: World, i: number) => (w.players[i].x + PHYS.w / 2) / TILE;
export const feet = (w: World, i: number) => (w.players[i].y + PHYS.h) / TILE;
const rowsOf = (w: World) => STAGES[w.stage].rows;
const solid = (w: World, tx: number, ty: number) => {
  const c = rowsOf(w)[ty]?.[tx];
  return c === "#" || c === "A" || c === "B";
};
const none = (c: Ctl) => !Object.keys(c).length;
const pair = (i: number, c: Ctl): [Ctl, Ctl] => (i === 0 ? [c, {}] : [{}, c]);

/** Walk toward tile x; hop visible walls and gaps automatically. */
function go(w: World, i: number, target: number, tol = 0.15): Ctl {
  const p = w.players[i];
  const x = cx(w, i);
  if (Math.abs(target - x) <= tol) return {};
  const dir = target > x ? 1 : -1;
  const ctl: Ctl = dir > 0 ? { r: true } : { l: true };
  if (p.grounded) {
    const front = dir > 0 ? p.x + PHYS.w : p.x;
    const fx = Math.floor((front + dir * 6) / TILE);
    const fy = Math.floor((p.y + PHYS.h - 4) / TILE);
    const wallAhead = solid(w, fx, fy) || solid(w, fx, fy - 1);
    const gx = Math.floor((front + dir * 4) / TILE);
    const fr = Math.floor((p.y + PHYS.h + 4) / TILE);
    // a pit = nothing to stand on for 3 rows below the next column (a step down is fine)
    const gapAhead = [0, 1, 2].every((k) => !solid(w, gx, fr + k) && !"ab".includes(rowsOf(w)[fr + k]?.[gx] ?? "."));
    if (wallAhead || (gapAhead && Math.abs(target - x) > 1.2)) ctl.press = true;
  }
  if (p.vy < 0) ctl.jump = true;
  return ctl;
}

const both = (w: World, a: number, b: number): [Ctl, Ctl] | "done" => {
  const c0 = go(w, 0, a), c1 = go(w, 1, b);
  if (none(c0) && none(c1) && w.players[0].grounded && w.players[1].grounded) return "done";
  // the leader waits if the rope is getting tight
  const gap = cx(w, 1) - cx(w, 0);
  if (gap > 5.5 && w.players[1].grounded) return [c0, {}];
  if (gap < -5.5 && w.players[0].grounded) return [{}, c1];
  return [c0, c1];
};

const walk = (name: string, a: number, b: number): Phase => ({ name, run: (w) => both(w, a, b) });
const solo = (name: string, i: number, x: number, tol = 0.1): Phase => ({
  name,
  run: (w) => {
    const c = go(w, i, x, tol);
    return none(c) && w.players[i].grounded ? "done" : pair(i, c);
  },
});
/** Run right, take off at jumpX (full-height jump), done once grounded past landX. */
const hop = (name: string, i: number, jumpX: number, landX: number): Phase => ({
  name,
  run: (w) => {
    const p = w.players[i];
    const x = cx(w, i);
    if (p.grounded && x >= landX) return "done";
    const c: Ctl = { r: true };
    if (p.grounded && x >= jumpX && x < landX - 0.5) c.press = true;
    if (p.vy < 0 || c.press) c.jump = true;
    return pair(i, c);
  },
  maxSec: 6,
});

/** Co-op climb of a 4-tile wall whose face is at tile column `wallX`. */
const climb = (wallX: number): Phase[] => [
  walk("both to the wall", wallX - 3, wallX - 0.34),
  { name: "P1 onto P2's head", run: (w) => {
      const p = w.players[0], q = w.players[1];
      if (p.grounded && Math.abs(p.y + PHYS.h - q.y) < 1) return "done";
      if (p.grounded && feet(w, 0) > 14.9) return [{ press: true, jump: true }, {}];
      return [{ jump: p.vy < 0, r: cx(w, 0) < cx(w, 1) - 0.05 }, {}];
    } },
  { name: "P1 jumps onto the wall", run: (w, t) => {
      const p = w.players[0];
      if (t > 0.1 && p.grounded && feet(w, 0) < 11.1) return "done";
      return [{ press: p.grounded && feet(w, 0) > 13.5, jump: true, r: true }, {}];
    }, maxSec: 2 },
  solo("P1 steps to the edge", 0, wallX + 0.45),
  { name: "P1 anchors + reels P2 up", run: (w) => {
      if (w.players[1].grounded && feet(w, 1) < 11.1 && cx(w, 1) > wallX + 0.2) return "done";
      return [{ anchor: true, jump: true }, { r: true }];
    }, maxSec: 6 },
];

// ── Stage 1: The Overgrown Temple ──────────────────────────────────────
const STAGE1: Phase[] = [
  walk("warm-up + spike pit", 27.5, 28.5),
  { name: "P1 holds plate a", run: (w) => { const c = go(w, 0, 32.5, 0.1); return none(c) ? "done" : [c, go(w, 1, 33.4)]; } },
  { name: "P2 through Gate A to far plate", run: (w) => { const c = go(w, 1, 39.5, 0.1); return none(c) ? "done" : [{}, c]; } },
  { name: "P1 through Gate A", run: (w) => { const c = go(w, 0, 41, 0.2); return none(c) ? "done" : [c, {}]; } },
  ...climb(48),
  walk("across the plateau", 58, 59.5),
  { name: "P2 drops into the Well", run: (w) => { const c = go(w, 1, 62.5, 0.1); return !none(c) || !w.players[1].grounded ? [go(w, 0, 60.2), c] : "done"; } },
  { name: "P1 hops the Well, through Gate B", run: (w) => { const c = go(w, 0, 67.5, 0.1); return !none(c) || !w.players[0].grounded ? [c, {}] : "done"; } },
  { name: "P1 anchors on far plate + reels P2 out", run: (w) => {
      if (w.players[1].grounded && feet(w, 1) < 11.1 && cx(w, 1) > 65.5) return "done";
      return [{ anchor: true, jump: true }, { r: true, jump: w.players[1].vy < 0 }];
    }, maxSec: 8 },
  { name: "final run to the exit", run: (w) => (w.stage > 0 ? "done" : both(w, 120.3, 121.0)) },
];

// ── Stage 2: The Devil's Gauntlet ──────────────────────────────────────
const STAGE2: Phase[] = [
  walk("A: up to the collapsing floor", 7.0, 8.2),
  hop("A: P2 jumps the trapdoor", 1, 8.4, 12.6),
  hop("A: P1 jumps the (now open) trapdoor", 0, 8.4, 12.2),
  walk("B: up to the spike runway", 20.5, 21.3),
  hop("B: P2 jumps the pop-up spikes", 1, 22.1, 27.0),
  hop("B: P1 jumps the pop-up spikes", 0, 22.1, 26.6),
  walk("C: onto the bridge", 33.0, 37.3),
  hop("C: P2 jumps the fake blocks", 1, 37.45, 40.6),
  solo("C: P1 to the fake blocks", 0, 37.3),
  hop("C: P1 jumps the fake blocks", 0, 37.45, 40.3),
  walk("D: to the 'impossible' pit", 47.0, 49.5),
  hop("D: P2 lands on the invisible stones", 1, 49.55, 53.2),
  solo("D: P2 to the stones' edge", 1, 54.75),
  solo("D: P1 to the pit edge", 0, 49.3),
  hop("D: P1 lands on the invisible stones", 0, 49.25, 53.0),
  hop("D: P2 jumps off the stones", 1, 54.7, 57.8),
  solo("D: P1 to the stones' edge", 0, 54.6),
  hop("D: P1 jumps off the stones", 0, 54.6, 57.3),
  walk("E: up to the plate", 64.5, 65.5),
  solo("E: P1 steps on the plate", 0, 66.5),
  hop("E: P2 jumps the trapdoor through the gate", 1, 67.4, 71.6),
  solo("E: P2 holds the far plate", 1, 72.5),
  hop("E: P1 jumps the trapdoor through the gate", 0, 67.4, 71.2),
  walk("F: up to the second spikes", 80.75, 80.9),
  hop("F: P2 jumps the pop-up spikes", 1, 82.0, 86.9),
  hop("F: P1 jumps the pop-up spikes", 0, 82.0, 86.5),
  walk("F: the exit runs away — chase it", 95, 96),
  ...climb(101),
  { name: "F: into the runaway exit", run: (w) => (w.status === "won" ? "done" : both(w, 106.3, 107.0)) },
];

export const COOP: Phase[] = [...STAGE1, ...STAGE2];
