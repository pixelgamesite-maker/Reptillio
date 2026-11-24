/**
 * Proves both stages are clearable by a cooperating duo, that the co-op
 * obstacles can't be cleared solo, and that every troll trap really kills
 * a player who walks in without knowing. Run: npm run test:rush
 */
import { STAGES } from "./stage";
import { DT, PHYS, TILE, newWorld, step, type Input, type SimEvent, type World } from "./sim";
import { COOP, cx, feet, type Phase } from "./bot";

function play(phases: Phase[], label: string) {
  let w = newWorld();
  const jp = [0, 0];
  const events: SimEvent[] = [];
  let deaths = 0;
  for (const ph of phases) {
    let t = 0;
    const max = ph.maxSec ?? 30;
    for (;;) {
      const r = ph.run(w, t);
      if (r === "done") break;
      const inputs = r.map((c, i): Input => {
        if (c.press) jp[i]++;
        return { left: !!c.l, right: !!c.r, jump: !!c.jump || !!c.press, anchor: !!c.anchor, jp: jp[i] };
      }) as [Input, Input];
      w = step(w, inputs, events);
      t += DT;
      if (process.env.TRACE2 && t > 29.9) console.log(JSON.stringify(r), JSON.stringify(w.players[1]));
      if (process.env.TRACE && Math.floor(t*60) % 6 === 0) console.log(ph.name.slice(0,12), t.toFixed(2), cx(w,0).toFixed(2), feet(w,0).toFixed(2), cx(w,1).toFixed(2), feet(w,1).toFixed(2), w.players[0].grounded, w.players[1].grounded);
      if (w.deaths > deaths) {
        return { ok: false, w, why: `${label}: died during "${ph.name}" (${events.filter((e) => e.startsWith("death")).pop()})` };
      }
      if (w.status !== "playing") break;
      if (t > max) return { ok: false, w, why: `${label}: stuck in "${ph.name}" — P1 (${cx(w, 0).toFixed(2)}, ${feet(w, 0).toFixed(2)}) P2 (${cx(w, 1).toFixed(2)}, ${feet(w, 1).toFixed(2)}) rope ${w.rope.toFixed(0)}` };
    }
    if (w.status === "won") break;
  }
  return { ok: w.status === "won", w, why: w.status };
}

let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? "  ✓" : "  ✗"} ${msg}`); if (!ok) fails++; };

console.log("Reptile Rush");
const coop = play(COOP, "co-op");
check(coop.ok, `co-op duo clears BOTH stages (${coop.ok ? `${(coop.w.tick / 60).toFixed(1)}s total, 0 deaths` : coop.why})`);

// Solo attempts: a single player can't get past the co-op obstacles.
{
  const w = newWorld();
  // put both at the wall, P1 tries to jump it without help
  w.players[0].x = 46.5 * TILE; w.players[1].x = 44 * TILE;
  let ww = w, jp = 0, top = 99;
  for (let i = 0; i < 600; i++) {
    if (i % 40 === 0) jp++;
    ww = step(ww, [{ left: false, right: true, jump: true, anchor: false, jp }, { left: false, right: false, jump: false, anchor: true, jp: 0 }]);
    top = Math.min(top, feet(ww, 0));
  }
  check(top > 11.05, `temple wall can't be jumped alone (best feet row ${top.toFixed(2)} vs wall top 11)`);
}
{
  const w = newWorld();
  w.players[0].x = 61 * TILE; w.players[0].y = 11 * TILE - PHYS.h - 0.001; w.players[1].x = 58 * TILE; w.players[1].y = w.players[0].y;
  let ww = w, jp = 0, best = 0;
  for (let i = 0; i < 900; i++) {
    if (i % 30 === 0) jp++;
    ww = step(ww, [{ left: false, right: true, jump: true, anchor: false, jp }, { left: false, right: true, jump: false, anchor: false, jp: 0 }]);
    best = Math.max(best, (ww.players[0].x + PHYS.w) / TILE);
  }
  check(best < 65.05, `Gate B stays shut without the Well plate (furthest ${best.toFixed(2)} vs gate at 65)`);
}
{
  const w = newWorld();
  w.players[0].x = 62.2 * TILE; w.players[0].y = 15 * TILE - PHYS.h - 0.001; w.players[1].x = 60 * TILE; w.players[1].y = 11 * TILE - PHYS.h - 0.001;
  let ww = w, jp = 0, top = 99;
  for (let i = 0; i < 600; i++) {
    if (i % 35 === 0) jp++;
    ww = step(ww, [{ left: i % 120 < 60, right: i % 120 >= 60, jump: true, anchor: false, jp }, { left: false, right: false, jump: false, anchor: true, jp: 0 }]);
    top = Math.min(top, feet(ww, 0));
  }
  check(top > 11.05, `can't climb out of the Well without a reel (best feet row ${top.toFixed(2)})`);
}
{
  // Spike death respawns both at the last checkpoint
  const w = newWorld();
  w.checkpoint = 1;
  w.players[0].x = 22 * TILE; w.players[0].y = 16.5 * TILE;
  w.players[1].x = 19 * TILE; w.players[1].y = 15 * TILE - PHYS.h - 0.001;
  const ev: SimEvent[] = [];
  const after = step(w, [{ left: false, right: false, jump: false, anchor: false, jp: 0 }, { left: false, right: false, jump: false, anchor: false, jp: 0 }], ev);
  check(ev.includes("death:0") && Math.abs(cx(after, 0) - 28.06) < 0.6 && after.deaths === 1, "spikes respawn the duo at the checkpoint (and say who died)");
}

// ── Stage 2: every troll must actually catch a naive player ──────────────
console.log("\nThe Devil's Gauntlet — naive players fall for every troll");
const S2 = STAGES[1];
const idle: Input = { left: false, right: false, jump: false, anchor: false, jp: 0 };
const right: Input = { ...idle, right: true };
/** Put P1 at tile (x, floor row) in stage 2 (P2 parked behind), then run `inputs` until death or `secs`. */
function trial(x: number, floorRow: number, secs: number, p0: (w: World, i: number) => Input, setup?: (w: World) => void, p1x = x - 2) {
  let w = newWorld(1);
  w.players[0].x = x * TILE - PHYS.w / 2; w.players[0].y = floorRow * TILE - PHYS.h - 0.001;
  w.players[1].x = p1x * TILE - PHYS.w / 2; w.players[1].y = floorRow * TILE - PHYS.h - 0.001;
  setup?.(w);
  const ev: SimEvent[] = [];
  for (let i = 0; i < secs * 60; i++) {
    w = step(w, [p0(w, i), idle], ev);
    if (w.deaths) break;
  }
  return { w, ev };
}
{
  const { w, ev } = trial(7, 15, 3, () => right);
  check(w.deaths === 1 && ev.includes("trap:collapse"), "A: walking onto the floor drops you into spikes");
}
{
  const { w, ev } = trial(20, 15, 3, () => right);
  check(w.deaths === 1 && ev.includes("trap:spikes"), "B: walking the runway gets you spiked");
}
{
  const { w } = trial(36, 15, 3, () => right, undefined, 34.5);
  check(w.deaths === 1, "C: the fake bridge blocks drop you into spikes");
}
{
  // naive player jumps short into the pit (doesn't know about the stones → they're invisible)
  const { w } = trial(48.5, 15, 2, (_w, i) => ({ ...idle, right: i < 48, jump: i > 14, jp: i > 14 ? 1 : 0 }));
  check(w.traps[S2.traps.findIndex((t) => t.kind === "invisible")] >= 0 && w.deaths === 0, "D: jumping into the 'impossible' pit lands you on the invisible stones (and reveals them)");
}
{
  // P1 on the plate, P2 waiting right at the gate on the trapdoor
  let w = newWorld(1);
  w.players[0].x = 66.5 * TILE - PHYS.w / 2; w.players[0].y = 15 * TILE - PHYS.h - 0.001;
  w.players[1].x = 69.3 * TILE - PHYS.w / 2; w.players[1].y = 15 * TILE - PHYS.h - 0.001;
  const ev: SimEvent[] = [];
  for (let i = 0; i < 120 && !w.deaths; i++) w = step(w, [idle, idle], ev);
  check(w.deaths === 1 && ev.includes("death:1"), "E: holding the plate drops the floor under your waiting partner (P2 dies)");
}
{
  const { w } = trial(79, 15, 3, () => right);
  check(w.deaths === 1, "F: the second pop-up spikes get you too");
}
{
  // walk up to the original exit
  const { w } = trial(86.5, 15, 1.5, () => right, (ww) => { ww.checkpoint = 5; });
  const ri = S2.traps.findIndex((t) => t.kind === "runaway");
  check(w.traps[ri] >= 0 && w.status === "playing", "F: the exit runs away when you approach it");
}
{
  // after a death: collapses re-arm, revealed stones + moved exit stay
  let w = newWorld(1);
  const ii = S2.traps.findIndex((t) => t.kind === "invisible"), ci = 0, ri = S2.traps.findIndex((t) => t.kind === "runaway");
  w.traps[ii] = 5; w.traps[ci] = 5; w.traps[ri] = 5;
  w.players[0].y = 18 * TILE; // falling into the void
  w.players[0].x = 10 * TILE;
  w = step(w, [idle, idle]);
  check(w.deaths === 1 && w.traps[ci] === -1 && w.traps[ii] === 5 && w.traps[ri] === 5, "after a death traps re-arm, but revealed stones and the moved exit stay");
}
{
  // a duo standing in the ORIGINAL exit after it ran away doesn't win
  let w = newWorld(1);
  const ri = S2.traps.findIndex((t) => t.kind === "runaway");
  w.traps[ri] = 0;
  for (const p of w.players) { p.x = 90.6 * TILE; p.y = 15 * TILE - PHYS.h - 0.001; }
  w = step(w, [idle, idle]);
  check(w.status === "playing", "the old exit spot doesn't count once the exit has run away");
}
{
  // solo can't climb the runaway exit's wall
  let w = newWorld(1);
  w.players[0].x = 99.5 * TILE; w.players[0].y = 15 * TILE - PHYS.h - 0.001;
  w.players[1].x = 96 * TILE; w.players[1].y = w.players[0].y;
  let jp = 0, top = 99;
  for (let i = 0; i < 600; i++) {
    if (i % 40 === 0) jp++;
    w = step(w, [{ ...right, jump: true, jp }, { ...idle, anchor: true }]);
    top = Math.min(top, feet(w, 0));
  }
  check(top > 11.05, "F: the final wall still needs both players");
}

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
