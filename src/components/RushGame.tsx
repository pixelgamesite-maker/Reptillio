import { useEffect, useRef } from "react";
import { STAGES, type Stage } from "../../shared/rush/stage";
import { DT, PHYS, TILE, currentExit, spikeAt, type World } from "../../shared/rush/sim";
import type { RushClient } from "../lib/rush";

const COLORS = [
  { body: "#5fbf5a", dark: "#2f7a3a", belly: "#e3efb4", tag: "#7dffb0" },
  { body: "#e0b341", dark: "#9a6d12", belly: "#fbeec2", tag: "#ffd978" },
];

/**
 * Canvas renderer + local input for Reptile Rush. Runs a fixed 60 Hz
 * prediction step and draws at the display's refresh rate.
 */
export function RushGame({ client, names, onFrame }: {
  client: RushClient;
  names: [string, string];
  onFrame?: (w: World) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cam = useRef({ x: 0, y: 0, init: false, stage: 0 });

  // Keyboard
  useEffect(() => {
    const keys = new Set<string>();
    const apply = () =>
      client.setInput({
        left: keys.has("ArrowLeft") || keys.has("KeyA"),
        right: keys.has("ArrowRight") || keys.has("KeyD"),
        anchor: keys.has("ArrowDown") || keys.has("KeyS") || keys.has("ShiftLeft") || keys.has("ShiftRight"),
        jump: keys.has("ArrowUp") || keys.has("KeyW") || keys.has("Space"),
      });
    const isJump = (c: string) => c === "ArrowUp" || c === "KeyW" || c === "Space";
    const down = (e: KeyboardEvent) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      keys.add(e.code);
      if (isJump(e.code)) client.pressJump();
      apply();
    };
    const up = (e: KeyboardEvent) => {
      keys.delete(e.code);
      apply();
    };
    const blur = () => {
      keys.clear();
      apply();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, [client]);

  // Loop: fixed-step prediction + draw
  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tiles = new Map<number, Tiles>();

    const frame = (now: number) => {
      acc += Math.min(100, now - last);
      last = now;
      while (acc >= DT * 1000) {
        client.tickLocal();
        acc -= DT * 1000;
      }
      const w = client.predicted;
      if (w) {
        if (!tiles.has(w.stage)) tiles.set(w.stage, prerenderTiles(STAGES[w.stage]));
        draw(ctx, canvas, w, client, names, cam.current, tiles.get(w.stage)!, now);
        onFrame?.(w);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [client, names, onFrame]);

  return (
    <div className="rush-stage">
      <canvas ref={canvasRef} className="rush-canvas" />
      <TouchControls client={client} />
    </div>
  );
}

function TouchControls({ client }: { client: RushClient }) {
  const held = useRef({ left: false, right: false, jump: false, anchor: false });
  const bind = (key: "left" | "right" | "jump" | "anchor") => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      held.current[key] = true;
      if (key === "jump") client.pressJump();
      else client.setInput({ [key]: true });
      e.currentTarget.classList.add("is-held");
    },
    onPointerUp: (e: React.PointerEvent) => {
      held.current[key] = false;
      client.setInput({ [key]: false });
      e.currentTarget.classList.remove("is-held");
    },
    onPointerCancel: (e: React.PointerEvent) => {
      held.current[key] = false;
      client.setInput({ [key]: false });
      e.currentTarget.classList.remove("is-held");
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });
  return (
    <div className="touch-pad" aria-hidden="true">
      <div className="touch-left">
        <button className="tbtn" {...bind("left")}>◀</button>
        <button className="tbtn" {...bind("right")}>▶</button>
      </div>
      <div className="touch-right">
        <button className="tbtn tbtn-anchor" {...bind("anchor")}>ANCHOR</button>
        <button className="tbtn tbtn-jump" {...bind("jump")}>JUMP</button>
      </div>
    </div>
  );
}

// ── drawing ───────────────────────────────────────────────────────────
type Tiles = HTMLCanvasElement;

/** One stone block — shared by the static layer and the trap tiles drawn live. */
function drawBlock(g: CanvasRenderingContext2D, x: number, y: number, px: number, py: number, mossy: boolean) {
  const shade = ((x * 7 + y * 13) % 5) * 3;
  g.fillStyle = `rgb(${46 + shade},${58 + shade},${50 + shade})`;
  g.fillRect(px, py, TILE, TILE);
  g.strokeStyle = "rgba(0,0,0,0.25)";
  g.lineWidth = 1;
  g.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  g.fillStyle = "rgba(255,255,255,0.04)";
  g.fillRect(px + 2, py + 2, TILE - 4, 3);
  if (mossy) {
    g.fillStyle = "#3f8f4a";
    g.fillRect(px, py, TILE, 6);
    g.fillStyle = "#62b65f";
    for (let i = 0; i < 4; i++) g.fillRect(px + i * 8 + ((x + i) % 3), py + 4, 3, 4 + ((x * 3 + i) % 4));
  }
}

function drawSpikes(g: CanvasRenderingContext2D, px: number, py: number, rise = 1) {
  g.fillStyle = "#d9d2bd";
  const top = py + TILE - (TILE - 8) * rise;
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.moveTo(px + i * 8, py + TILE);
    g.lineTo(px + i * 8 + 4, top);
    g.lineTo(px + i * 8 + 8, py + TILE);
    g.fill();
  }
}

/** Draw a stage's static tiles once into an offscreen canvas. Trap tiles are left out — they're drawn live. Fakes ('f') look exactly like real blocks. */
function prerenderTiles(S: Stage): Tiles {
  const c = document.createElement("canvas");
  c.width = S.w * TILE;
  c.height = S.h * TILE;
  const g = c.getContext("2d")!;
  const at = (x: number, y: number) => S.rows[y]?.[x] ?? "#";
  const looksSolid = (x: number, y: number) => {
    const ch = at(x, y);
    return ch === "#" || ch === "f" || ch === "A" || ch === "B";
  };
  for (let y = 0; y < S.h; y++) {
    for (let x = 0; x < S.w; x++) {
      const ch = at(x, y);
      const px = x * TILE, py = y * TILE;
      if (S.trapAt[y * S.w + x] >= 0) continue;
      if (ch === "#" || ch === "f") {
        drawBlock(g, x, y, px, py, !looksSolid(x, y - 1));
      } else if (ch === "^") {
        drawSpikes(g, px, py);
      }
    }
  }
  return c;
}

function draw(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  w: World,
  client: RushClient,
  names: [string, string],
  cam: { x: number; y: number; init: boolean; stage: number },
  tiles: Tiles,
  now: number
) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const STAGE = STAGES[w.stage];
  // Show ~12 tiles tall / at least ~16 tiles wide.
  const scale = Math.min(ch / (12 * TILE), cw / (16 * TILE)) * dpr;
  const viewW = canvas.width / scale, viewH = canvas.height / scale;

  const pos = w.players.map((p, i) => ({ x: p.x + client.smooth[i].x, y: p.y + client.smooth[i].y }));
  const midX = (pos[0].x + pos[1].x) / 2 + PHYS.w / 2;
  const midY = (pos[0].y + pos[1].y) / 2;
  const tx = Math.max(0, Math.min(STAGE.w * TILE - viewW, midX - viewW / 2));
  const ty = Math.max(Math.min(0, STAGE.h * TILE - viewH), Math.min(STAGE.h * TILE - viewH, midY - viewH * 0.55));
  if (!cam.init || cam.stage !== w.stage) { cam.x = tx; cam.y = ty; cam.init = true; cam.stage = w.stage; }
  cam.x += (tx - cam.x) * 0.12;
  cam.y += (ty - cam.y) * 0.12;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // sky + parallax temple
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, "#0b2216");
  sky.addColorStop(1, "#05110a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(scale, scale);
  ctx.fillStyle = "rgba(60,140,90,0.08)";
  for (let i = 0; i < 14; i++) {
    const x = i * 260 - (cam.x * 0.3) % 260;
    ctx.fillRect(x, viewH * 0.25, 40, viewH);
    ctx.fillRect(x - 20, viewH * 0.25, 80, 14);
  }
  ctx.restore();

  // death: shake the camera and flash red for a moment
  const sinceDeath = now - client.lastDeathAt;
  const shake = sinceDeath < 380 ? (1 - sinceDeath / 380) * 9 : 0;
  const sx = shake ? (Math.random() - 0.5) * shake * 2 : 0, sy = shake ? (Math.random() - 0.5) * shake * 2 : 0;

  ctx.setTransform(scale, 0, 0, scale, (-cam.x + sx) * scale, (-cam.y + sy) * scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(tiles, 0, 0);

  // live trap tiles
  STAGE.traps.forEach((trap, i) => {
    if (trap.kind === "runaway") return;
    const fired = w.traps[i] ?? -1;
    const since = fired >= 0 ? w.stageTick - fired - ("delay" in trap ? trap.delay : 0) : -1;
    for (let y = trap.tiles.y0; y <= trap.tiles.y1; y++) {
      for (let x = trap.tiles.x0; x <= trap.tiles.x1; x++) {
        const px = x * TILE, py = y * TILE;
        if (trap.kind === "collapse") {
          if (since < 0) {
            // about to go: a little shiver once it's been triggered
            const jitter = fired >= 0 ? Math.sin(now / 18 + x) * 1.5 : 0;
            drawBlock(ctx, x, y, px + jitter, py, true);
          } else if (since < 30) {
            ctx.globalAlpha = 1 - since / 30;
            drawBlock(ctx, x, y, px, py + since * since * 0.35, true);
            ctx.globalAlpha = 1;
          }
        } else if (trap.kind === "spikes") {
          if (spikeAt(STAGE, w, x, y)) drawSpikes(ctx, px, py, Math.min(1, (since + 1) / 4));
        } else if (trap.kind === "invisible") {
          if (fired >= 0) {
            ctx.fillStyle = "rgba(125,255,176,0.12)";
            ctx.fillRect(px, py, TILE, TILE);
            ctx.strokeStyle = "rgba(125,255,176,0.75)";
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
            ctx.setLineDash([]);
          } else if (Math.sin(now / 260 + x * 1.7) > 0.985) {
            // the faintest sparkle — a hint for sharp eyes
            ctx.fillStyle = "rgba(200,255,220,0.8)";
            ctx.fillRect(px + 10 + (x % 3) * 4, py + 4, 2, 2);
          }
        }
      }
    }
  });

  // dynamic tiles: plates, gates, checkpoints, exit
  const t = now / 1000;
  for (let y = 0; y < STAGE.h; y++) {
    const row = STAGE.rows[y];
    for (let x = 0; x < STAGE.w; x++) {
      const c = row[x];
      const px = x * TILE, py = y * TILE;
      if (c === "a" || c === "b") {
        const on = (w.open & (1 << (c.charCodeAt(0) - 97))) !== 0;
        ctx.fillStyle = on ? "#ffd25e" : "#8a6d2a";
        ctx.fillRect(px + 3, py + TILE - (on ? 4 : 7), TILE - 6, on ? 4 : 7);
        if (on) { ctx.fillStyle = "rgba(255,210,94,0.25)"; ctx.fillRect(px - 4, py + 8, TILE + 8, TILE - 8); }
      } else if (c === "A" || c === "B") {
        const open = (w.open & (1 << (c.charCodeAt(0) - 65))) !== 0;
        ctx.fillStyle = open ? "rgba(255,210,94,0.12)" : "#6b5418";
        ctx.fillRect(px + 6, py, TILE - 12, TILE);
        if (!open) {
          ctx.fillStyle = "#b8901f";
          for (let i = 0; i < 3; i++) ctx.fillRect(px + 8 + i * 6, py, 3, TILE);
        }
      } else if (c === "C") {
        const idx = STAGE.checkpoints.findIndex((k) => k.tx === x && k.ty === y) + 1;
        const lit = idx <= w.checkpoint;
        ctx.fillStyle = "#c9c2a8";
        ctx.fillRect(px + 14, py - 18, 3, TILE + 18);
        ctx.fillStyle = lit ? "#7dffb0" : "#5b6b60";
        ctx.beginPath();
        ctx.moveTo(px + 17, py - 18);
        ctx.lineTo(px + 34 + Math.sin(t * 4) * 2, py - 11);
        ctx.lineTo(px + 17, py - 4);
        ctx.fill();
      }
    }
  }

  // exit (it may have run away)
  {
    const ex = currentExit(STAGE, w);
    const px = ex.x0 * TILE, py = ex.y0 * TILE;
    {
        const pulse = 0.5 + Math.sin(t * 3) * 0.2;
        const gr = ctx.createRadialGradient(px + TILE, py + TILE, 4, px + TILE, py + TILE, 52);
        gr.addColorStop(0, `rgba(125,255,176,${pulse})`);
        gr.addColorStop(1, "rgba(125,255,176,0)");
        ctx.fillStyle = gr;
        ctx.fillRect(px - 24, py - 24, TILE * 2 + 48, TILE * 2 + 48);
        ctx.strokeStyle = "#e6b93f";
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(px + 2, py + TILE * 2);
        ctx.lineTo(px + 2, py + 14);
        ctx.quadraticCurveTo(px + TILE, py - 10, px + TILE * 2 - 2, py + 14);
        ctx.lineTo(px + TILE * 2 - 2, py + TILE * 2);
        ctx.stroke();
    }
  }

  // rope
  const c0 = { x: pos[0].x + PHYS.w / 2, y: pos[0].y + PHYS.h / 2 };
  const c1 = { x: pos[1].x + PHYS.w / 2, y: pos[1].y + PHYS.h / 2 };
  const dist = Math.hypot(c1.x - c0.x, c1.y - c0.y);
  const sag = Math.sqrt(Math.max(0, w.rope * w.rope - dist * dist)) * 0.45;
  const taut = sag < 4;
  ctx.strokeStyle = taut ? "#d9b26a" : "#8b6a3a";
  ctx.lineWidth = taut ? 3 : 2.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(c0.x, c0.y);
  ctx.quadraticCurveTo((c0.x + c1.x) / 2, (c0.y + c1.y) / 2 + sag, c1.x, c1.y);
  ctx.stroke();

  // reptiles
  w.players.forEach((p, i) => drawReptile(ctx, pos[i].x, pos[i].y, p.facing, p.anchored, p.grounded, COLORS[i], t, i === client.seat));
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  w.players.forEach((_, i) => {
    const label = i === client.seat ? "YOU" : `@${names[i]}`;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    const tw = ctx.measureText(label).width + 10;
    ctx.fillRect(pos[i].x + PHYS.w / 2 - tw / 2, pos[i].y - 22, tw, 15);
    ctx.fillStyle = COLORS[i].tag;
    ctx.fillText(label, pos[i].x + PHYS.w / 2, pos[i].y - 11);
  });
}

function drawReptile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  facing: number,
  anchored: boolean,
  grounded: boolean,
  c: (typeof COLORS)[number],
  t: number,
  me: boolean
) {
  const w = PHYS.w, h = PHYS.h;
  ctx.save();
  ctx.translate(x + w / 2, y + h);
  ctx.scale(facing, 1);
  const bob = grounded ? Math.sin(t * 10) * 0.6 : 0;
  if (me) {
    ctx.fillStyle = "rgba(125,255,176,0.18)";
    ctx.beginPath();
    ctx.ellipse(0, 0, 16, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // tail
  ctx.fillStyle = c.dark;
  ctx.beginPath();
  ctx.moveTo(-8, -9);
  ctx.quadraticCurveTo(-20, -8, -19, anchored ? -2 : -15);
  ctx.quadraticCurveTo(-14, -6, -6, -4);
  ctx.fill();
  // legs
  ctx.fillRect(-8, -6, 5, 6);
  ctx.fillRect(3, -6, 5, 6);
  // body
  ctx.fillStyle = c.body;
  roundRect(ctx, -11, -19 + bob, 20, 14, 7);
  ctx.fillStyle = c.belly;
  roundRect(ctx, -6, -11 + bob, 13, 6, 3);
  // head
  ctx.fillStyle = c.body;
  roundRect(ctx, 1, -26 + bob, 15, 12, 6);
  // eye
  ctx.fillStyle = "#fffdf3";
  ctx.beginPath();
  ctx.arc(9, -21 + bob, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#16210f";
  ctx.fillRect(9.4, -23 + bob, 1.8, 4);
  // spikes
  ctx.fillStyle = c.dark;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(-8 + i * 6, -18 + bob);
    ctx.lineTo(-5 + i * 6, -23 + bob);
    ctx.lineTo(-2 + i * 6, -18 + bob);
    ctx.fill();
  }
  // anchor claws
  if (anchored) {
    ctx.fillStyle = "#ffd25e";
    for (const dx of [-9, -4, 4, 9]) {
      ctx.beginPath();
      ctx.moveTo(dx - 2, 0);
      ctx.lineTo(dx, 5);
      ctx.lineTo(dx + 2, 0);
      ctx.fill();
    }
  }
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fill();
}
