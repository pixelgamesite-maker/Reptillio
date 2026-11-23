import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { ASSETS } from "../lib/assets";
import { LEVELS, levelName } from "../lib/game";
import { useGame } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { TopBar } from "../components/TopBar";
import { Tube } from "../components/Tube";
import { Drawer } from "../components/Drawer";
import { ItemsPanel } from "../components/ItemsPanel";
import { ActivityPanel } from "../components/ActivityPanel";
import { QuizModal } from "../components/QuizModal";
import { WhitelistModal } from "../components/WhitelistModal";
import { Reptile } from "../components/Reptile";
import { BackIcon, BagIcon, CheckIcon, DnaIcon, FlaskIcon } from "../components/Icons";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const WIDE = "(min-width: 1180px)";

function useWide() {
  const [wide, setWide] = useState(() => window.matchMedia(WIDE).matches);
  useEffect(() => {
    const mq = window.matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

type Toast = { id: number; msg: string; tone: "good" | "bad" };

export default function Lab() {
  const { state, loading, error, nextReqs, canEvolve, run, setState } = useGame();
  const { play } = useSound();
  const wide = useWide();

  const [leftOpen, setLeftOpen] = useState(wide);
  const [rightOpen, setRightOpen] = useState(wide);
  const [quizOpen, setQuizOpen] = useState(false);
  const [wlOpen, setWlOpen] = useState(false);
  const [phase, setPhase] = useState<"idle" | "charge" | "burst" | "reveal">("idle");
  const [evolvedTo, setEvolvedTo] = useState<number | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [welcome, setWelcome] = useState(false);
  const toastId = useRef(0);

  useEffect(() => {
    setLeftOpen(wide);
    setRightOpen(wide);
  }, [wide]);

  // One-time welcome for a brand-new egg.
  useEffect(() => {
    if (!state) return;
    const k = `reptilio_welcomed_${state.profile.reptilio_id}`;
    try {
      if (!localStorage.getItem(k) && state.profile.level === 1 && state.earned === 0) setWelcome(true);
      localStorage.setItem(k, "1");
    } catch {
      /* no-op */
    }
  }, [state?.profile.reptilio_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const message = useCallback((msg: string, tone: "good" | "bad" = "good") => {
    const id = ++toastId.current;
    setToast({ id, msg, tone });
    setTimeout(() => setToast((t) => (t?.id === id ? null : t)), 3600);
  }, []);

  const openLeft = (o: boolean) => {
    setLeftOpen(o);
    if (o && !wide) setRightOpen(false);
  };
  const openRight = (o: boolean) => {
    setRightOpen(o);
    if (o && !wide) setLeftOpen(false);
  };

  async function evolve() {
    if (!canEvolve || phase !== "idle") return;
    if (!wide) {
      setLeftOpen(false);
      setRightOpen(false);
    }
    const t0 = Date.now();
    setPhase("charge");
    play("select");
    const res = await run(() => api.evolve(), () => undefined); // hold the new state until the burst
    if (!res.ok) {
      setPhase("idle");
      play("error");
      message(res.error, "bad");
      return;
    }
    await sleep(Math.max(0, 1500 - (Date.now() - t0)));
    setPhase("burst");
    play("levelup");
    await sleep(420);
    setState(res.data.state);
    setPhase("reveal");
    await sleep(1300);
    setPhase("idle");
    setEvolvedTo(res.data.new_level);
  }

  if (loading || !state) {
    return (
      <div className="lab-page">
        <div className="lab-bg" aria-hidden="true" />
        <div className="lab-loading">
          <Reptile level={1} size={140} className="bob" />
          <p>{error || "Warming up the Lab…"}</p>
          {error && <Link className="lab-btn ghost" to="/">Back to Chapters</Link>}
        </div>
      </div>
    );
  }

  const level = state.profile.level;
  const info = LEVELS[level - 1];
  const fcfsLvl = state.config.fcfs_level ?? 3;
  const rushWon = !!state.rush?.won;

  const missingCost = nextReqs.reduce((s, r) => s + Math.max(0, r.need - r.have) * r.item.price, 0);
  const fill = level >= 6 || canEvolve ? 1 : missingCost === 0 ? 1 : Math.min(1, state.balance / missingCost);
  const wlEligible = level >= fcfsLvl || rushWon;
  const wlAction = wlEligible && (!state.allocation || (state.allocation.tier === "fcfs" && rushWon));
  const nextBuyable = nextReqs.find((r) => r.have < r.need);

  return (
    <div className={`lab-page ${leftOpen ? "left-open" : ""} ${rightOpen ? "right-open" : ""}`}>
      <div className="lab-bg" aria-hidden="true">
        <div className="lab-rays" />
        <div className="lab-grid" />
      </div>

      <TopBar
        variant="lab"
        left={
          <Link to="/" className="kraft-btn back-btn" aria-label="Back to chapters">
            <BackIcon size={18} />
            <span>Chapters</span>
          </Link>
        }
        title={<><FlaskIcon size={22} /> The Lab</>}
      />

      {!wide && (leftOpen || rightOpen) && (
        <button className="drawer-scrim" aria-label="Close panel" onClick={() => { setLeftOpen(false); setRightOpen(false); }} />
      )}

      <Drawer
        side="left"
        open={leftOpen}
        onOpenChange={openLeft}
        label="Specimens"
        icon={<BagIcon size={18} />}
        badge={canEvolve ? "!" : undefined}
      >
        <ItemsPanel onMessage={message} />
      </Drawer>

      <Drawer
        side="right"
        open={rightOpen}
        onOpenChange={openRight}
        label="Daily"
        icon={<DnaIcon size={18} />}
        badge={!state.checked_in_today && state.campaign_open ? "+" : undefined}
      >
        <ActivityPanel onOpenQuiz={() => setQuizOpen(true)} onMessage={message} />
      </Drawer>

      <main className="lab-center">
        <div className="level-plaque">
          <span className="level-num">LV {level}</span>
          <div>
            <b>{info.name}</b>
            <small>{info.blurb}</small>
          </div>
        </div>

        <Tube level={level} fill={fill} phase={phase} ready={canEvolve} />

        <div className="lab-console">
          {level < 6 ? (
            <>
              <div className="console-reqs">
                <span className="console-label">Next: {levelName(level + 1)}</span>
                <div className="console-chips">
                  {nextReqs.map((r) => (
                    <button
                      key={r.item.key}
                      className={`req-chip ${r.have >= r.need ? "has" : ""}`}
                      onClick={() => openLeft(true)}
                      title={r.item.name}
                    >
                      <img src={ASSETS.items[r.item.key]} alt="" />
                      <span>{r.item.name}{r.need > 1 ? ` ×${r.need}` : ""}</span>
                      {r.have >= r.need ? <CheckIcon size={14} /> : <small><DnaIcon size={12} />{r.item.price}</small>}
                    </button>
                  ))}
                </div>
              </div>
              <button
                className={`evolve-btn ${canEvolve ? "is-ready" : ""}`}
                disabled={!canEvolve || phase !== "idle"}
                onClick={evolve}
              >
                {phase !== "idle" ? "Evolving…" : canEvolve ? "Evolve" : nextBuyable && state.balance >= nextBuyable.item.price ? "Buy specimen first" : "Earn more DNA"}
              </button>
            </>
          ) : (
            <p className="console-apex">Apex reached. Your lineage is complete.</p>
          )}
        </div>

        <div className="milestones" aria-label="Evolution track">
          {LEVELS.map((l) => (
            <div key={l.level} className={`ms ${l.level <= level ? "on" : ""} ${l.level === level ? "cur" : ""}`}>
              <span className="ms-dot" />
              <small>{l.name}</small>
              {l.level === fcfsLvl && <em>FCFS · RUSH</em>}
            </div>
          ))}
        </div>

        <button className={`wl-pill ${wlAction ? "is-live" : ""} ${state.allocation ? "is-claimed" : ""}`} onClick={() => setWlOpen(true)}>
          {state.allocation
            ? `${state.allocation.tier.toUpperCase()} #${state.allocation.number}${wlAction ? " · Upgrade to GTD" : " · secured"}`
            : wlEligible
              ? `Claim your ${rushWon ? "GTD" : "FCFS"} spot`
              : `Whitelist unlocks at Lv ${fcfsLvl} · ${levelName(fcfsLvl)}`}
        </button>
      </main>

      {toast && (
        <div key={toast.id} className={`toast ${toast.tone}`} role="status">
          {toast.msg}
        </div>
      )}

      {quizOpen && <QuizModal onClose={() => setQuizOpen(false)} />}
      {wlOpen && <WhitelistModal onClose={() => setWlOpen(false)} />}

      {evolvedTo && (
        <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && setEvolvedTo(null)}>
          <div className="evolved-card" role="dialog" aria-modal="true">
            <span className="eyebrow">Evolution complete</span>
            <Reptile level={evolvedTo} size={180} className="pop-in" />
            <h2>{levelName(evolvedTo)}</h2>
            <p>{LEVELS[evolvedTo - 1].blurb}</p>
            {evolvedTo === fcfsLvl && <div className="milestone-banner">FCFS unlocked</div>}
            {evolvedTo === fcfsLvl && <div className="milestone-banner gold">Reptile Rush unlocked — win GTD with a friend</div>}
            {evolvedTo === fcfsLvl ? (
              <button className="lab-btn big" onClick={() => { setEvolvedTo(null); setWlOpen(true); }}>
                Claim FCFS
              </button>
            ) : (
              <button className="lab-btn big" onClick={() => setEvolvedTo(null)}>Keep evolving</button>
            )}
          </div>
        </div>
      )}

      {welcome && (
        <div className="modal-scrim">
          <div className="evolved-card welcome" role="dialog" aria-modal="true">
            <span className="eyebrow">Specimen {state.profile.reptilio_id} received</span>
            <Reptile level={1} size={160} className="bob" />
            <h2>Your Genesis Egg has arrived</h2>
            <ol className="welcome-steps">
              <li><b>Earn DNA</b> — check in, take the quiz and finish missions in <em>Daily</em>.</li>
              <li><b>Buy specimens</b> — each one in <em>Specimens</em> feeds the next evolution.</li>
              <li><b>Evolve</b> — reach <em>Hunter</em> for FCFS, then win <em>Reptile Rush</em> with a friend for GTD.</li>
            </ol>
            <button className="lab-btn big" onClick={() => { setWelcome(false); openRight(true); }}>Start earning</button>
          </div>
        </div>
      )}
    </div>
  );
}
