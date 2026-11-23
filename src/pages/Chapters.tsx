import { useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../hooks/useAuth";
import { useGame } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { TopBar } from "../components/TopBar";
import { Reptile } from "../components/Reptile";
import { CrownIcon, FlaskIcon, LockIcon, RopeIcon } from "../components/Icons";
import { levelName } from "../lib/game";

type Chapter = {
  key: string;
  to?: string;
  name: string;
  icon?: ReactNode;
  art: ReactNode;
  tone: "lime" | "cream" | "soon" | "jungle";
  tag?: string;
  locked?: boolean;
  needsAuth?: boolean;
};

/** Landing: four hanging chapter cards. Lab + Den open, two coming soon. */
export default function Chapters() {
  const { signedIn, signInWithX } = useAuth();
  const { state } = useGame();
  const { play } = useSound();
  const navigate = useNavigate();
  const level = state?.profile.level ?? 1;
  const rushLevel = state?.config.rush_min_level ?? 3;
  const rushOpen = signedIn && level >= rushLevel;

  const chapters: Chapter[] = [
    {
      key: "lab",
      to: "/lab",
      name: "The Lab",
      icon: <FlaskIcon size={30} />,
      art: <Reptile level={level} size={level === 1 ? 170 : 210} />,
      tone: "lime",
      needsAuth: true,
    },
    {
      key: "den",
      to: "/den",
      name: "The Den",
      icon: <CrownIcon size={30} />,
      art: <Reptile level={6} size={220} />,
      tone: "cream",
    },
    {
      key: "rush",
      to: rushOpen ? "/rush" : undefined,
      name: "Reptile Rush",
      icon: <RopeIcon size={30} />,
      art: (
        <span className="rush-card-art">
          <Reptile level={3} size={150} silhouette={!rushOpen} />
          <Reptile level={4} size={150} silhouette={!rushOpen} />
        </span>
      ),
      tone: rushOpen ? "jungle" : "soon",
      tag: rushOpen ? undefined : `Reach Lv ${rushLevel}`,
      locked: !rushOpen,
      needsAuth: true,
    },
    { key: "soon-2", name: "Chapter IV", art: <Reptile level={5} size={220} silhouette />, tone: "soon", tag: "Soon" },
  ];

  function open(c: Chapter) {
    if (!c.to) {
      play("error");
      return;
    }
    play("select");
    if (c.needsAuth && !signedIn) {
      signInWithX(c.to);
      return;
    }
    navigate(c.to);
  }

  return (
    <div className="paper-page">
      <div className="paper-bg" aria-hidden="true" />
      <TopBar title="Chapters" />

      <main className="chapters">
        <div className="chapter-row">
          {chapters.map((c, i) => (
            <button
              key={c.key}
              className={`chapter tone-${c.tone} ${c.to ? "is-open" : "is-soon"} ${c.locked ? "is-locked" : ""}`}
              style={{ animationDelay: `${i * 90}ms` }}
              onClick={() => open(c)}
              aria-label={c.to ? c.name : c.locked ? `${c.name} — reach Level ${rushLevel} to unlock` : `${c.name} — coming soon`}
              aria-disabled={!c.to}
            >
              <span className="chapter-tape" aria-hidden="true" />
              <span className="chapter-card">
                <span className="chapter-stitch" aria-hidden="true" />
                {c.icon && <span className="chapter-icon">{c.icon}</span>}
                {(c.to || c.locked) && <span className="chapter-name">{c.name}</span>}
                {c.key === "lab" && signedIn && state && (
                  <span className="chapter-meta">Lv {level} · {levelName(level)}</span>
                )}
                <span className="chapter-art">{c.art}</span>
                {c.tag && <span className={`chapter-tag ${c.locked ? "is-lock" : ""}`}>{c.locked && <LockIcon size={16} />} {c.tag}</span>}
              </span>
            </button>
          ))}
        </div>

        <p className="chapters-foot">
          {signedIn
            ? "Earn DNA. Reach Hunter for FCFS. Clear Reptile Rush with a friend for GTD."
            : "Sign in with X to claim your free Genesis Egg."}
        </p>
      </main>
    </div>
  );
}
