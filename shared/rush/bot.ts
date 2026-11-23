/** Scripted co-op duo used by the tests to prove the stage is clearable. */
import { STAGE } from "./stage";
import { PHYS, TILE, type World } from "./sim";

export type Ctl = { l?: boolean; r?: boolean; jump?: boolean; press?: boolean; anchor?: boolean };
export type Phase = { name: string; run: (w: World, t: number) => [Ctl, Ctl] | "done"; maxSec?: number };

export const cx = (w: World, i: number) => (w.players[i].x + PHYS.w / 2) / TILE;
export const feet = (w: World, i: number) => (w.players[i].y + PHYS.h) / TILE;
const solid = (tx: number, ty: number) => {
  const c = STAGE.rows[ty]?.[tx];
  return c === "#" || c === "A" || c === "B";
};

/** Walk toward tile x; hop walls and gaps automatically. */
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
    const wallAhead = solid(fx, fy) || solid(fx, fy - 1);
    const gx = Math.floor((front + dir * 4) / TILE);
    const fr = Math.floor((p.y + PHYS.h + 4) / TILE);
    // a pit = nothing to stand on for 3 rows below the next column (a step down is fine)
    const gapAhead = [0, 1, 2].every((k) => !solid(gx, fr + k) && !"ab".includes(STAGE.rows[fr + k]?.[gx] ?? "."));
    if (wallAhead || (gapAhead && Math.abs(target - x) > 1.2)) ctl.press = true;
  }
  if (p.vy < 0) ctl.jump = true;
  return ctl;
}

const both = (w: World, a: number, b: number): [Ctl, Ctl] | "done" => {
  const c0 = go(w, 0, a), c1 = go(w, 1, b);
  if (!Object.keys(c0).length && !Object.keys(c1).length && w.players[0].grounded && w.players[1].grounded) return "done";
  // the leader waits if the rope is getting tight
  const gap = cx(w, 1) - cx(w, 0);
  if (gap > 5.5 && w.players[1].grounded) return [c0, {}];
  if (gap < -5.5 && w.players[0].grounded) return [{}, c1];
  return [c0, c1];
};

export const COOP: Phase[] = [
  { name: "warm-up + spike pit", run: (w) => both(w, 27.5, 28.5) },
  { name: "P1 holds plate a", run: (w) => { const c = go(w, 0, 32.5, 0.1); return Object.keys(c).length ? [c, go(w, 1, 33.4)] : "done"; } },
  { name: "P2 through Gate A to far plate", run: (w) => { const c = go(w, 1, 39.5, 0.1); return Object.keys(c).length ? [{}, c] : "done"; } },
  { name: "P1 through Gate A", run: (w) => { const c = go(w, 0, 41, 0.2); return Object.keys(c).length ? [c, {}] : "done"; } },
  { name: "both to the wall", run: (w) => both(w, 45.0, 47.6) },
  { name: "P1 onto P2's head", run: (w, t) => {
      const p = w.players[0], q = w.players[1];
      if (p.grounded && Math.abs(p.y + PHYS.h - q.y) < 1) return "done";
      if (p.grounded && feet(w, 0) > 14.9) return [{ press: true, jump: true }, {}]; // on the floor: (re)jump
      return [{ jump: p.vy < 0, r: cx(w, 0) < cx(w, 1) - 0.05 }, {}];
    } },
  { name: "P1 jumps onto the wall", run: (w, t) => {
      const p = w.players[0];
      if (t > 0.1 && p.grounded && feet(w, 0) < 11.1) return "done";
      return [{ press: p.grounded && feet(w, 0) > 13.5, jump: true, r: true }, {}];
    }, maxSec: 2 },
  { name: "P1 steps to the edge", run: (w) => { const c = go(w, 0, 48.45, 0.1); return Object.keys(c).length ? [c, {}] : "done"; } },
  { name: "P1 anchors + reels P2 up", run: (w) => {
      if (w.players[1].grounded && feet(w, 1) < 11.1) return "done";
      return [{ anchor: true, jump: true }, { r: true }];
    }, maxSec: 6 },
  { name: "across the plateau", run: (w) => both(w, 58, 59.5) },
  { name: "P2 drops into the Well", run: (w) => { const c = go(w, 1, 62.5, 0.1); return Object.keys(c).length || !w.players[1].grounded ? [go(w, 0, 60.2), c] : "done"; } },
  { name: "P1 hops the Well, through Gate B", run: (w) => { const c = go(w, 0, 67.5, 0.1); return Object.keys(c).length || !w.players[0].grounded ? [c, {}] : "done"; } },
  { name: "P1 anchors on far plate + reels P2 out", run: (w) => {
      if (w.players[1].grounded && feet(w, 1) < 11.1 && cx(w, 1) > 65.5) return "done";
      return [{ anchor: true, jump: true }, { r: true, jump: w.players[1].vy < 0 }];
    }, maxSec: 8 },
  { name: "final run to the exit", run: (w) => both(w, 120.3, 121.0) },
];

