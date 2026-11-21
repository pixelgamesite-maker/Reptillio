import { useMemo } from "react";
import { Reptile } from "./Reptile";

/**
 * The incubation tube at the centre of the Lab. Liquid height = how charged
 * the next evolution is (DNA toward the next item, or full when ready).
 * `phase` drives the evolution animation: charge → burst → reveal.
 */
export function Tube({ level, fill, phase = "idle", ready = false }: {
  level: number;
  fill: number;
  phase?: "idle" | "charge" | "burst" | "reveal";
  ready?: boolean;
}) {
  const bubbles = useMemo(
    () =>
      Array.from({ length: 16 }).map((_, i) => ({
        left: 8 + ((i * 53) % 84),
        size: 4 + ((i * 7) % 9),
        delay: (i * 0.37) % 4,
        dur: 3 + ((i * 11) % 5) * 0.5,
      })),
    []
  );

  const pct = Math.round(Math.max(0.06, Math.min(1, fill)) * 100);

  return (
    <div className={`tube-rig phase-${phase} ${ready ? "is-ready" : ""}`}>
      <div className="tube-pipe tube-pipe-l" aria-hidden="true" />
      <div className="tube-pipe tube-pipe-r" aria-hidden="true" />

      <div className="tube-cap" aria-hidden="true">
        <span className="tube-cap-light" />
        <span className="tube-cap-light" />
        <span className="tube-cap-light" />
      </div>

      <div className="tube-glass">
        <div className="tube-liquid" style={{ height: `${pct}%` }}>
          <svg className="tube-wave" viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M0 10 Q25 0 50 10 T100 10 T150 10 T200 10 V20 H0 Z" />
          </svg>
        </div>

        <div className="tube-bubbles" aria-hidden="true">
          {bubbles.map((b, i) => (
            <span
              key={i}
              style={{
                left: `${b.left}%`,
                width: b.size,
                height: b.size,
                animationDelay: `${b.delay}s`,
                animationDuration: `${b.dur}s`,
              }}
            />
          ))}
        </div>

        <div className="tube-specimen">
          <Reptile level={level} size={level === 1 ? 170 : 200} />
        </div>

        <div className="tube-shine" aria-hidden="true" />
        <div className="tube-flash" aria-hidden="true" />
      </div>

      <div className="tube-base" aria-hidden="true">
        <div className="tube-base-lights">
          {[1, 2, 3, 4, 5, 6].map((l) => (
            <span key={l} className={`${l <= level ? "on" : ""} ${l === 4 ? "fcfs" : ""} ${l === 6 ? "gtd" : ""}`} />
          ))}
        </div>
      </div>
      <div className="tube-floor-glow" aria-hidden="true" />
    </div>
  );
}
