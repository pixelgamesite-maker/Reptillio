import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtLeft } from "../lib/game";
import { useGame, useTick } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { CalendarIcon, CheckIcon, DnaIcon, LockIcon, QuizIcon, XGlyph } from "./Icons";

/** Right drawer: daily check-in, the timed quiz, missions and referrals. */
export function ActivityPanel({ onOpenQuiz, onMessage }: {
  onOpenQuiz: () => void;
  onMessage: (msg: string, tone?: "good" | "bad") => void;
}) {
  const { state, tasks, run, now } = useGame();
  const { play } = useSound();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useTick(1000);

  if (!state) return null;
  const cfg = state.config;
  const t = now();

  const checkinLeft = new Date(state.next_checkin_at).getTime() - t;
  const quizNext = state.quiz.next_at ? new Date(state.quiz.next_at).getTime() : 0;
  const quizRunning = !!state.quiz.open && new Date(state.quiz.open.expires_at).getTime() > t;
  const quizReady = quizRunning || !quizNext || quizNext <= t;
  const cooldownMs = (cfg.quiz_cooldown_minutes ?? 300) * 60_000;
  const quizProgress = quizReady ? 1 : 1 - (quizNext - t) / cooldownMs;

  async function checkin() {
    setBusy("checkin");
    const res = await run(() => api.checkin(), (v) => v.state);
    setBusy(null);
    if (res.ok) {
      play("purchase");
      onMessage(`Checked in · +${res.data.paid} DNA`, "good");
    } else {
      play("error");
      onMessage(res.error, "bad");
    }
  }

  async function doTask(key: string, href: string | null, label: string) {
    play("select");
    if (href) window.open(href, "_blank", "noopener,noreferrer");
    setBusy(key);
    const res = await run(() => api.completeTask(key));
    setBusy(null);
    if (res.ok) onMessage(`${label} · done`, "good");
    else onMessage(res.error, "bad");
  }

  const refLink = `${window.location.origin}/?ref=${state.profile.reptilio_id}`;
  async function copyRef() {
    try {
      await navigator.clipboard.writeText(refLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* no-op */
    }
  }

  const doneSet = new Set(state.tasks_done);
  const disabled = !state.campaign_open;

  return (
    <div className="panel-stack">
      <div className="panel-title-row">
        <h2 className="panel-title">Daily Lab</h2>
        <span className="dna-chip"><DnaIcon size={15} /> {state.balance}</span>
      </div>
      {disabled && <p className="panel-note bad">The campaign has ended — earning is closed. You can still evolve and claim.</p>}

      {/* Check-in */}
      <section className={`act-card ${state.checked_in_today ? "is-done" : "is-live"}`}>
        <span className="act-icon"><CalendarIcon /></span>
        <div className="act-text">
          <b>Daily check-in</b>
          <small>
            {state.checked_in_today ? `Next in ${fmtLeft(checkinLeft)}` : "Ready to collect"}
          </small>
        </div>
        <button className="act-btn" onClick={checkin} disabled={disabled || state.checked_in_today || busy === "checkin"}>
          {state.checked_in_today ? <CheckIcon size={18} /> : `+${cfg.checkin_points ?? 50}`}
        </button>
      </section>

      {/* Quiz */}
      <section className={`act-card act-quiz ${quizReady ? "is-live" : ""}`}>
        <span className="act-icon"><QuizIcon /></span>
        <div className="act-text">
          <b>Crypto History Quiz</b>
          <small>
            {quizRunning
              ? "Quiz in progress — jump back in!"
              : quizReady
                ? `1 question · ${cfg.quiz_seconds ?? 60}s · +${cfg.quiz_reward ?? 60} DNA`
                : `Next quiz in ${fmtLeft(quizNext - t)}`}
          </small>
          <div className="act-progress"><span style={{ width: `${Math.max(4, quizProgress * 100)}%` }} /></div>
        </div>
        <button className="act-btn" onClick={() => { play("select"); onOpenQuiz(); }} disabled={disabled || !quizReady}>
          {quizRunning ? "Resume" : quizReady ? "Play" : "⏳"}
        </button>
      </section>
      <p className="panel-note">
        {state.quiz.correct}/{state.quiz.answered} answered correctly · new quiz every {Math.round((cfg.quiz_cooldown_minutes ?? 300) / 60)}h
      </p>

      {/* Missions */}
      <h3 className="panel-sub">Missions</h3>
      <ul className="mission-list">
        {tasks.map((task) => {
          const done = doneSet.has(task.key);
          return (
            <li key={task.key}>
              <button
                className={`mission ${done ? "is-done" : ""}`}
                disabled={done || disabled || busy === task.key}
                onClick={() => doTask(task.key, task.href, task.label)}
              >
                <span className="mission-box">{done ? <CheckIcon size={14} /> : <XGlyph size={12} />}</span>
                <span className="mission-label">{task.label}</span>
                <span className="mission-pts">+{task.points}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Upgrade to GTD → Reptile Rush */}
      <UpgradeCard level={state.profile.level} minLevel={cfg.rush_min_level ?? 3} won={!!state.rush?.won} />

      {/* Referrals */}
      <h3 className="panel-sub">Recruit</h3>
      <div className="ref-card">
        <p>
          +{cfg.referral_points ?? 50} DNA for each friend who reaches <b>Juvenile</b> (max {cfg.referral_max_rewarded ?? 10}).
        </p>
        <div className="ref-row dark">
          <input readOnly value={refLink} onFocus={(e) => e.currentTarget.select()} />
          <button className="mini-btn" onClick={copyRef}>{copied ? "Copied" : "Copy"}</button>
        </div>
        <small>{state.referrals.joined} joined · {state.referrals.rewarded} paid out</small>
      </div>
    </div>
  );
}

function UpgradeCard({ level, minLevel, won }: { level: number; minLevel: number; won: boolean }) {
  if (won) {
    return (
      <Link to="/rush" className="gtd-card is-won">
        <span className="gtd-card-icon"><CheckIcon size={18} /></span>
        <span className="gtd-card-text">
          <b>GTD unlocked</b>
          <small>You cleared Reptile Rush. Submit your wallet from the whitelist button.</small>
        </span>
      </Link>
    );
  }
  if (level < minLevel) {
    return (
      <div className="gtd-card is-locked" aria-disabled="true">
        <span className="gtd-card-icon"><LockIcon size={18} /></span>
        <span className="gtd-card-text">
          <b>Upgrade to GTD</b>
          <small>Reach Level {minLevel} to unlock Reptile Rush.</small>
        </span>
      </div>
    );
  }
  return (
    <Link to="/rush" className="gtd-card">
      <span className="gtd-card-icon">🪢</span>
      <span className="gtd-card-text">
        <b>Upgrade to GTD</b>
        <small>Play Reptile Rush with a friend. Clear the stage → you both get GTD.</small>
      </span>
      <span className="gtd-card-go">Play ›</span>
    </Link>
  );
}
