/**
 * Proves Stage 1 is clearable by a cooperating duo, and that the co-op
 * obstacles can't be cleared solo. Run: npm run test:rush
 */
import { STAGE } from "./stage";
import { DT, PHYS, TILE, newWorld, step, type Input, type SimEvent } from "./sim";
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
      w = step(w, inputs, STAGE, events);
      t += DT;
      if (process.env.TRACE2 && t > 29.9) console.log(JSON.stringify(r), JSON.stringify(w.players[1]));
      if (process.env.TRACE && Math.floor(t*60) % 6 === 0) console.log(ph.name.slice(0,12), t.toFixed(2), cx(w,0).toFixed(2), feet(w,0).toFixed(2), cx(w,1).toFixed(2), feet(w,1).toFixed(2), w.players[0].grounded, w.players[1].grounded);
      if (w.deaths > deaths) {
        return { ok: false, w, why: `${label}: died during "${ph.name}" at x=${cx(w, 0).toFixed(1)}/${cx(w, 1).toFixed(1)}` };
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

console.log("Reptile Rush — Stage 1");
const coop = play(COOP, "co-op");
check(coop.ok, `co-op duo clears the stage (${coop.ok ? `${(coop.w.tick / 60).toFixed(1)}s, checkpoint ${coop.w.checkpoint}` : coop.why})`);

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
  const after = step(w, [{ left: false, right: false, jump: false, anchor: false, jp: 0 }, { left: false, right: false, jump: false, anchor: false, jp: 0 }], STAGE, ev);
  check(ev.includes("death") && Math.abs(cx(after, 0) - 28.06) < 0.6 && after.deaths === 1, "spikes respawn the duo at the checkpoint");
}

console.log(`\n${fails ? `${fails} FAILED` : "all passed"}`);
process.exit(fails ? 1 : 0);
