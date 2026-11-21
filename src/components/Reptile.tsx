import { useId } from "react";
import { ASSETS } from "../lib/assets";
import { levelName } from "../lib/game";

/**
 * The player's reptile at a given level. Level 1 is the Genesis Egg art.
 * Levels 2–6 use real art from ASSETS.reptiles if set, otherwise a
 * built-in SVG placeholder that visibly grows with each evolution.
 */
export function Reptile({ level, size = 220, className = "", silhouette = false }: {
  level: number;
  size?: number;
  className?: string;
  silhouette?: boolean;
}) {
  const lvl = Math.max(1, Math.min(6, level));
  const art = ASSETS.reptiles[lvl - 1];

  if (lvl === 1 && !art) {
    return (
      <img
        className={`reptile reptile-egg ${silhouette ? "is-silhouette" : ""} ${className}`}
        src={ASSETS.items.genesis_egg}
        alt="Genesis Egg"
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  if (art) {
    return (
      <img
        className={`reptile ${silhouette ? "is-silhouette" : ""} ${className}`}
        src={art}
        alt={levelName(lvl)}
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  return <ReptileSvg level={lvl} size={size} className={className} silhouette={silhouette} />;
}

const PALETTE: Record<number, { body: string; dark: string; belly: string; spike: string; eye: string; accent: string }> = {
  2: { body: "#9ad66a", dark: "#5fa147", belly: "#f1f5c8", spike: "#6fb34f", eye: "#1d2a18", accent: "#ff9db0" },
  3: { body: "#68bb58", dark: "#3e8a3d", belly: "#e3efb4", spike: "#2f7a3a", eye: "#1a2416", accent: "#e8f2d0" },
  4: { body: "#3f9a4f", dark: "#256a36", belly: "#cfe3a0", spike: "#1d5a2d", eye: "#f2c94c", accent: "#183f22" },
  5: { body: "#2b8065", dark: "#185745", belly: "#bfe0b0", spike: "#d9a93c", eye: "#ffd25e", accent: "#e9b949" },
  6: { body: "#18694b", dark: "#0d4632", belly: "#a9dcae", spike: "#e6b93f", eye: "#7dffb0", accent: "#ffd25e" },
};

/** y of the top edge of the body ellipse at x (cx 118, cy 150, rx 60, ry 36). */
const backY = (x: number) => 150 - 36 * Math.sqrt(Math.max(0, 1 - ((x - 118) / 60) ** 2));

function ReptileSvg({ level, size, className, silhouette }: { level: number; size: number; className: string; silhouette: boolean }) {
  const uid = useId().replace(/:/g, "");
  const c = PALETTE[level];
  const juvenile = level === 2;
  const spikes = [0, 0, 5, 7, 8, 9][level - 1];
  const spikeH = [0, 0, 11, 16, 19, 23][level - 1];
  const eyeR = juvenile ? 12 : 10;
  const headR = juvenile ? 36 : 33;

  return (
    <svg
      className={`reptile reptile-svg lvl-${level} ${silhouette ? "is-silhouette" : ""} ${className}`}
      viewBox="0 0 240 240"
      width={size}
      height={size}
      role="img"
      aria-label={levelName(level)}
    >
      <defs>
        <linearGradient id={`b${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c.body} />
          <stop offset="1" stopColor={c.dark} />
        </linearGradient>
        <radialGradient id={`g${uid}`} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c.eye} stopOpacity="0.55" />
          <stop offset="1" stopColor={c.eye} stopOpacity="0" />
        </radialGradient>
      </defs>

      {level === 6 && <ellipse cx="120" cy="130" rx="112" ry="96" fill={`url(#g${uid})`} className="apex-aura" />}

      {/* far legs */}
      <rect x="78" y="168" width="20" height="34" rx="9" fill={c.dark} />
      <rect x="138" y="168" width="20" height="34" rx="9" fill={c.dark} />

      {/* tail */}
      <path
        d={juvenile
          ? "M72 146 C46 146 30 162 36 180 C40 192 56 192 54 182 C52 172 64 168 80 168 Z"
          : "M70 140 C34 138 12 160 20 186 C26 204 50 204 48 190 C46 176 60 170 82 170 Z"}
        fill={`url(#b${uid})`}
      />

      {/* dorsal spikes */}
      {Array.from({ length: spikes }).map((_, i) => {
        const x = 72 + (i * 92) / Math.max(1, spikes - 1);
        const y = backY(x) + 4;
        const h = spikeH * (0.75 + 0.25 * Math.sin((i / Math.max(1, spikes - 1)) * Math.PI));
        return <path key={i} d={`M${x - 7} ${y} L${x - 1} ${y - h} L${x + 7} ${y} Z`} fill={c.spike} />;
      })}

      {/* body */}
      <ellipse cx="118" cy="150" rx="60" ry="36" fill={`url(#b${uid})`} />
      <ellipse cx="124" cy="164" rx="42" ry="18" fill={c.belly} opacity="0.9" />

      {/* stripes / markings */}
      {level >= 3 && level <= 4 &&
        [92, 112, 132].map((x) => (
          <path key={x} d={`M${x} ${backY(x) + 6} q6 12 0 22`} stroke={c.dark} strokeWidth="5" fill="none" strokeLinecap="round" opacity="0.7" />
        ))}
      {level >= 5 &&
        [86, 106, 126, 146].map((x) => (
          <path key={x} d={`M${x} ${backY(x) + 7} q7 10 0 20`} stroke={c.accent} strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.9" />
        ))}

      {/* near legs */}
      <rect x="88" y="172" width="22" height="34" rx="10" fill={`url(#b${uid})`} />
      <rect x="146" y="172" width="22" height="34" rx="10" fill={`url(#b${uid})`} />
      {level >= 3 &&
        [88, 146].map((x) =>
          [3, 10, 17].map((dx) => <path key={x + dx} d={`M${x + dx} 204 l2 7 l3 -7 Z`} fill="#f3ecd2" />)
        )}

      {/* head */}
      <circle cx="170" cy="112" r={headR} fill={`url(#b${uid})`} />
      <ellipse cx={juvenile ? 196 : 200} cy="124" rx={juvenile ? 20 : 26} ry={juvenile ? 15 : 16} fill={`url(#b${uid})`} />
      <circle cx={juvenile ? 208 : 216} cy="118" r="2.2" fill={c.dark} />

      {/* mouth + teeth */}
      <path d={`M${juvenile ? 182 : 180} 132 Q${juvenile ? 198 : 202} ${juvenile ? 140 : 138} ${juvenile ? 214 : 224} 128`} stroke={c.dark} strokeWidth="3" fill="none" strokeLinecap="round" />
      {level >= 4 &&
        [190, 200, 210].map((x) => <path key={x} d={`M${x} 134 l3 6 l3 -6 Z`} fill="#fbf6e3" />)}

      {/* horns */}
      {level >= 5 && (
        <>
          <path d="M150 88 C140 64 150 50 162 46 C156 60 160 74 166 84 Z" fill={c.accent} />
          <path d="M170 82 C168 58 182 46 194 46 C184 58 184 72 184 82 Z" fill={c.accent} />
        </>
      )}

      {/* crown */}
      {level === 6 && (
        <g className="apex-crown">
          <path d="M146 84 L152 58 L162 74 L172 52 L182 74 L192 58 L196 86 Z" fill="#ffd25e" stroke="#b07d17" strokeWidth="2" strokeLinejoin="round" />
          <circle cx="172" cy="72" r="4" fill="#7dffb0" />
        </g>
      )}

      {/* eye */}
      <circle cx="178" cy="104" r={eyeR} fill="#fffdf3" />
      <ellipse cx="180" cy="105" rx={juvenile ? 5 : 3.2} ry={juvenile ? 7 : 7.5} fill={c.eye} className={level >= 4 ? "eye-glow" : ""} />
      <circle cx="176" cy="100" r="2.6" fill="#fff" />
      {level >= 3 && <path d={`M${170 - eyeR + 4} ${96 - eyeR + 6} L${186 + 2} ${92}`} stroke={c.dark} strokeWidth="4" strokeLinecap="round" />}

      {juvenile && <circle cx="194" cy="114" r="5" fill={c.accent} opacity="0.55" />}
    </svg>
  );
}
