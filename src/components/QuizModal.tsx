import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { OpenQuiz, QuizResult } from "../lib/game";
import { useGame, useTick } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { DnaIcon } from "./Icons";

type Phase = "ready" | "loading" | "question" | "submitting" | "result" | "error";

/**
 * Centre-screen quiz. "Ready" starts the server clock; the timer here is
 * just a display of it (corrected for device clock skew). The server
 * decides what's on time and what's correct — answers never reach the browser
 * until after you've answered.
 */
export function QuizModal({ onClose }: { onClose: () => void }) {
  const { state, run, now } = useGame();
  const { play } = useSound();
  const running = state?.quiz.open && new Date(state.quiz.open.expires_at).getTime() > now() ? state.quiz.open : null;

  const [phase, setPhase] = useState<Phase>(running ? "question" : "ready");
  const [quiz, setQuiz] = useState<OpenQuiz | null>(running);
  const [picked, setPicked] = useState<number | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [err, setErr] = useState("");
  const submitted = useRef(false);
  const lastTick = useRef<number>(-1);
  useTick(250);

  const seconds = state?.config.quiz_seconds ?? 60;
  const reward = state?.config.quiz_reward ?? 60;
  const msLeft = quiz ? Math.max(0, new Date(quiz.expires_at).getTime() - now()) : seconds * 1000;
  const secLeft = Math.ceil(msLeft / 1000);

  async function start() {
    play("select");
    setPhase("loading");
    const res = await run(() => api.startQuiz());
    if (!res.ok || !res.data.quiz.open) {
      setErr(res.ok ? "Couldn't start the quiz — try again." : res.error);
      setPhase("error");
      play("error");
      return;
    }
    setQuiz(res.data.quiz.open);
    setPhase("question");
  }

  const submit = useCallback(
    async (choice: number | null) => {
      if (!quiz || submitted.current) return;
      submitted.current = true;
      setPicked(choice);
      setPhase("submitting");
      const res = await run(() => api.answerQuiz(quiz.attempt_id, choice), (v) => v.state);
      if (!res.ok) {
        setErr(res.error);
        setPhase("error");
        play("error");
        return;
      }
      setResult(res.data);
      setPhase("result");
      play(res.data.correct ? "correct" : "error");
    },
    [quiz, run, play]
  );

  // Time's up → submit as unanswered.
  useEffect(() => {
    if (phase === "question" && quiz && msLeft <= 0) submit(null);
  }, [phase, quiz, msLeft, submit]);

  // Soft tick for the last 10 seconds.
  useEffect(() => {
    if (phase !== "question" || secLeft > 10 || secLeft === lastTick.current) return;
    lastTick.current = secLeft;
    if (secLeft > 0) play("tick");
  }, [phase, secLeft, play]);

  // Can't dismiss a running question by clicking outside — it keeps running.
  const canClose = phase !== "question" && phase !== "submitting" && phase !== "loading";

  const ring = 2 * Math.PI * 34;
  const frac = quiz ? msLeft / (seconds * 1000) : 1;
  const letters = ["A", "B", "C", "D"];

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && canClose && onClose()}>
      <div className={`quiz-card phase-${phase}`} role="dialog" aria-modal="true" aria-label="Crypto history quiz">
        {canClose && (
          <button className="modal-x" onClick={onClose} aria-label="Close">×</button>
        )}

        {phase === "ready" && (
          <div className="quiz-ready">
            <span className="eyebrow">Crypto History Quiz</span>
            <h2>Ready, specimen?</h2>
            <ul className="quiz-rules">
              <li><b>1</b> question on crypto & NFT history</li>
              <li><b>4</b> options — only one is right</li>
              <li><b>{seconds}s</b> on the clock once you start</li>
              <li><b>+{reward}</b> DNA if you get it right</li>
            </ul>
            <button className="lab-btn big" onClick={start}>I'm ready</button>
            <small className="muted">The timer starts the moment you press ready.</small>
          </div>
        )}

        {phase === "loading" && <div className="quiz-loading"><span className="spinner" />Preparing your question…</div>}

        {(phase === "question" || phase === "submitting" || phase === "result") && quiz && (
          <>
            <div className="quiz-head">
              <div className={`quiz-timer ${secLeft <= 10 && phase === "question" ? "is-low" : ""}`} aria-live="polite">
                <svg viewBox="0 0 80 80" aria-hidden="true">
                  <circle cx="40" cy="40" r="34" className="quiz-timer-track" />
                  <circle
                    cx="40"
                    cy="40"
                    r="34"
                    className="quiz-timer-fill"
                    strokeDasharray={ring}
                    strokeDashoffset={ring * (1 - (phase === "result" ? (result?.timed_out ? 0 : frac) : frac))}
                  />
                </svg>
                <span>{phase === "result" ? "✓" : secLeft}</span>
              </div>
              <p className="quiz-q">{quiz.question}</p>
            </div>

            <div className="quiz-options">
              {quiz.options.map((opt, i) => {
                const isPicked = picked === i;
                const isRight = result && result.correct_choice === i;
                const isWrong = result && isPicked && !result.correct;
                return (
                  <button
                    key={i}
                    className={`quiz-opt ${isPicked ? "is-picked" : ""} ${isRight ? "is-right" : ""} ${isWrong ? "is-wrong" : ""}`}
                    disabled={phase !== "question"}
                    onClick={() => submit(i)}
                  >
                    <span className="quiz-letter">{letters[i]}</span>
                    <span>{opt}</span>
                  </button>
                );
              })}
            </div>

            {phase === "submitting" && <p className="quiz-status"><span className="spinner" /> Checking…</p>}

            {phase === "result" && result && (
              <div className={`quiz-result ${result.correct ? "good" : "bad"}`}>
                <h3>{result.correct ? "Correct!" : result.timed_out ? "Time's up" : "Not quite"}</h3>
                <p>
                  {result.reward > 0 ? (
                    <span className="dna-chip big"><DnaIcon size={16} /> +{result.reward} DNA</span>
                  ) : (
                    "No DNA this round."
                  )}
                </p>
                <small className="muted">Next quiz in {Math.round((state?.config.quiz_cooldown_minutes ?? 300) / 60)} hours.</small>
                <button className="lab-btn" onClick={onClose}>Back to the Lab</button>
              </div>
            )}
          </>
        )}

        {phase === "error" && (
          <div className="quiz-ready">
            <h2>Hold on</h2>
            <p className="panel-note bad">{err}</p>
            <button className="lab-btn" onClick={onClose}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
