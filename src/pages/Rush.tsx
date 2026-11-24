import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { useGame, useTick } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { TopBar } from "../components/TopBar";
import { Reptile } from "../components/Reptile";
import { RushGame } from "../components/RushGame";
import { WhitelistModal } from "../components/WhitelistModal";
import { BackIcon, CheckIcon, LockIcon, XGlyph } from "../components/Icons";
import { RushClient, createRoom, fetchIce, rushToken } from "../lib/rush";
import { Voice } from "../lib/voice";
import { DEMO } from "../lib/supabase";
import { markDemoRushWin } from "../lib/demo";
import { levelName } from "../lib/game";
import type { RoomStatus, SeatView } from "../../shared/rush/protocol";
import { type World } from "../../shared/rush/sim";
import { STAGE_INFO } from "../../shared/rush/stage";

/** /rush and /rush/:code */
export default function Rush() {
  const { code } = useParams();
  const { signedIn, signInWithX } = useAuth();
  const { state, loading } = useGame();
  const minLevel = state?.config.rush_min_level ?? 3;

  const left = (
    <Link to="/" className="kraft-btn back-btn" aria-label="Back to chapters">
      <BackIcon size={18} />
      <span>Chapters</span>
    </Link>
  );

  let body: React.ReactNode;
  if (!signedIn) {
    body = (
      <Card>
        <Reptile level={3} size={150} className="bob" />
        <h2>Reptile Rush</h2>
        <p>A two-player co-op stage. Tied together by a rope, you and a friend clear it together — and both win <b>GTD</b>.</p>
        <button className="lab-btn big" onClick={() => signInWithX(code ? `/rush/${code}` : "/rush")}>
          <XGlyph size={16} /> Sign in to play
        </button>
      </Card>
    );
  } else if (loading || !state) {
    body = <Card><Reptile level={1} size={120} className="bob" /><p>Loading…</p></Card>;
  } else if (state.profile.level < minLevel) {
    body = (
      <Card>
        <div className="rush-lock"><LockIcon size={28} /></div>
        <h2>Reach Level {minLevel} to unlock</h2>
        <p>
          Reptile Rush opens at <b>{levelName(minLevel)}</b>. You're Level {state.profile.level} — finish your missions and
          evolve in the Lab first. {code && "Your friend's invite will still work once you're there."}
        </p>
        <div className="rush-progress">
          {Array.from({ length: minLevel }).map((_, i) => (
            <span key={i} className={i < state.profile.level ? "on" : ""} />
          ))}
        </div>
        <Link className="lab-btn big" to="/lab">Go to the Lab</Link>
      </Card>
    );
  } else if (!code) {
    body = <RushHome />;
  } else {
    body = <RushRoom code={code.toUpperCase()} />;
  }

  return (
    <div className="lab-page rush-page">
      <div className="lab-bg" aria-hidden="true"><div className="lab-rays" /><div className="lab-grid" /></div>
      <TopBar variant="lab" left={left} title={<>Reptile Rush</>} />
      <main className="rush-main">{body}</main>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rush-card">{children}</div>;
}

function RushHome() {
  const { state } = useGame();
  const navigate = useNavigate();
  const { play } = useSound();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [join, setJoin] = useState("");
  const [wl, setWl] = useState(false);

  async function create() {
    setBusy(true);
    setErr("");
    try {
      const token = await rushToken(state?.profile.handle, state?.profile.level);
      const { code } = await createRoom(token);
      play("select");
      navigate(`/rush/${code}`);
    } catch (e) {
      setErr((e as Error).message);
      play("error");
    }
    setBusy(false);
  }

  const won = state?.rush?.won;

  return (
    <Card>
      <span className="eyebrow">2 stages · {STAGE_INFO.name}</span>
      <h2>Clear it together. Win GTD together.</h2>
      {won ? (
        <div className="rush-won-banner">
          <CheckIcon size={16} /> You've cleared Rush{state?.rush?.partner ? ` with @${state.rush.partner}` : ""} — GTD unlocked.
          {state?.allocation?.tier !== "gtd" && <button className="mini-btn" onClick={() => setWl(true)}>Claim GTD</button>}
        </div>
      ) : null}
      <ul className="rush-how">
        <li><b>You're roped together.</b> Neither of you can get more than 7 tiles away.</li>
        <li><b>Anchor</b> (hold on the ground) to become a fixed point. <b>Anchor + Jump</b> reels your partner in.</li>
        <li>Stand on your partner's head to reach high ledges. Plates hold gates open.</li>
        <li><b>Stage 2 is a troll stage.</b> Floors drop, spikes pop up, blocks lie. You will die. A lot. 😈</li>
        <li>Clear both stages → <b>both</b> win GTD. {won && "You can still play to help a friend."}</li>
      </ul>
      <div className="rush-actions">
        <button className="lab-btn big" onClick={create} disabled={busy}>{busy ? "Creating…" : "Create a room"}</button>
        <form
          className="rush-join"
          onSubmit={(e) => {
            e.preventDefault();
            const c = join.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (c.length === 6) navigate(`/rush/${c}`);
            else setErr("Room codes are 6 letters/numbers.");
          }}
        >
          <input value={join} onChange={(e) => setJoin(e.target.value)} placeholder="Room code" maxLength={8} aria-label="Room code" />
          <button className="lab-btn ghost" type="submit">Join</button>
        </form>
      </div>
      {err && <p className="panel-note bad">{err}</p>}
      <small className="muted">Voice chat is built in. Use headphones to avoid echo.</small>
      {wl && <WhitelistModal onClose={() => setWl(false)} />}
    </Card>
  );
}

type Result = { kind: "won"; ms: number; deaths: number; youWon: boolean; recorded: boolean; error?: string } | { kind: "timeout" };

function RushRoom({ code }: { code: string }) {
  const { state, refresh } = useGame();
  const { play } = useSound();
  const navigate = useNavigate();
  const [status, setStatus] = useState<RoomStatus>("lobby");
  const [seats, setSeats] = useState<[SeatView | null, SeatView | null]>([null, null]);
  const [countdownEnd, setCountdownEnd] = useState(0);
  const [paused, setPaused] = useState(false);
  const [fatal, setFatal] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const [client, setClient] = useState<RushClient | null>(null);
  const [voiceTick, setVoiceTick] = useState(0);
  const [wl, setWl] = useState(false);
  const [copied, setCopied] = useState(false);
  const hud = useRef<HTMLDivElement>(null);
  const voiceRef = useRef<Voice | null>(null);
  const latestSeats = useRef<[SeatView | null, SeatView | null]>([null, null]);
  const [stageBanner, setStageBanner] = useState(false);
  useTick(200);

  // Connect once per room.
  useEffect(() => {
    let c: RushClient | null = null;
    let cancelled = false;
    (async () => {
      const token = await rushToken(state?.profile.handle, state?.profile.level);
      if (cancelled) return;
      c = new RushClient(code, token, {
        onRoom: (s, st, cd, p) => {
          setStatus(s);
          setSeats(st);
          latestSeats.current = st;
          setPaused(p);
          if (s === "countdown") setCountdownEnd(performance.now() + cd);
          if (s === "lobby" || s === "countdown") setResult(null);
          const partner = st[c!.seat === 0 ? 1 : 0];
          if (!partner?.connected) voiceRef.current?.reset();
        },
        onEvent: (e) => {
          if (e.startsWith("death")) {
            play("error");
            const who = Number(e.split(":")[1]);
            const name = latestSeats.current[who]?.handle;
            flash(who === c!.seat ? pick(YOU_DIED) : `💀 @${name ?? "your partner"} ${pick(THEY_DIED)}`);
          }
          if (e === "checkpoint") { play("purchase"); flash("Checkpoint! ⚑"); }
          if (e === "stage") {
            play("levelup");
            setStageBanner(true);
            setTimeout(() => setStageBanner(false), 3200);
          }
          if (e === "trap:runaway") flash("The exit… ran away?! 🏃");
          if (e === "trap:invisible") flash("Wait — there's a block there? 👀");
        },
        onWon: (m) => {
          play("claim");
          setResult({ kind: "won", ms: m.ms, deaths: m.deaths, youWon: m.you_won, recorded: m.recorded, error: m.error });
          if (DEMO && m.you_won) markDemoRushWin();
          void refresh();
        },
        onTimeout: () => setResult({ kind: "timeout" }),
        onSignal: (d) => void voiceRef.current?.onSignal(d as never),
        onError: (msg, isFatal) => (isFatal ? setFatal(msg) : flash(msg)),
        onClose: () => setFatal((f) => f || "Disconnected from the room. Refresh to reconnect."),
      });
      c.connect();
      setClient(c);
      if (DEMO) (window as unknown as { __rush: RushClient }).__rush = c; // demo/testing hook only
      voiceRef.current = new Voice(
        false,
        () => fetchIce(token).catch(() => [{ urls: "stun:stun.cloudflare.com:3478" }]),
        (d) => c!.signal(d),
        () => setVoiceTick((n) => n + 1)
      );
    })();
    return () => {
      cancelled = true;
      c?.close();
      voiceRef.current?.close();
      voiceRef.current = null;
    };
  }, [code]); // eslint-disable-line react-hooks/exhaustive-deps

  // The second seat is the "polite" peer in voice negotiation.
  useEffect(() => {
    if (client && voiceRef.current) voiceRef.current.polite = client.seat === 1;
  }, [client, seats]);

  const flash = useCallback((m: string) => {
    setNote(m);
    setTimeout(() => setNote((n) => (n === m ? "" : n)), 2200);
  }, []);

  const me = client ? seats[client.seat] : null;
  const partner = client ? seats[client.seat === 0 ? 1 : 0] : null;
  const names = useMemo<[string, string]>(() => [seats[0]?.handle ?? "P1", seats[1]?.handle ?? "P2"], [seats]);
  const invite = `${window.location.origin}/rush/${code}`;
  const voice = voiceRef.current;
  void voiceTick;

  async function toggleVoice() {
    if (!voice || !client) return;
    try {
      if (!voice.micOn) {
        await voice.join();
        client.voice(true);
      } else {
        voice.leave();
        client.voice(false);
      }
    } catch {
      flash("Microphone blocked — allow mic access in your browser settings.");
    }
  }

  const onFrame = useCallback((w: World) => {
    if (!hud.current) return;
    const s = Math.floor(w.stageTick / 60);
    const left = Math.max(0, 600 - s);
    const st = STAGE_INFO.stages[w.stage];
    hud.current.textContent = `Stage ${w.stage + 1}/${STAGE_INFO.stages.length} · ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} · ☠ ${w.deaths} · ⚑ ${w.checkpoint}/${st?.checkpoints ?? 0}`;
  }, []);

  if (fatal) {
    return (
      <Card>
        <h2>Can't join this room</h2>
        <p className="panel-note bad">{fatal}</p>
        <div className="rush-actions">
          <button className="lab-btn" onClick={() => window.location.reload()}>Try again</button>
          <Link className="lab-btn ghost" to="/rush">New room</Link>
        </div>
      </Card>
    );
  }

  const inGame = status === "countdown" || status === "playing" || ((status === "won" || status === "timeout") && client?.predicted);
  const cdLeft = Math.max(0, Math.ceil((countdownEnd - performance.now()) / 1000));

  return (
    <>
      {!inGame && (
        <Card>
          <span className="eyebrow">Room {code}</span>
          <h2>{partner ? "Both here — ready up!" : "Invite your partner"}</h2>
          <div className="rush-seats">
            {[0, 1].map((i) => (
              <SeatCard key={i} seat={seats[i]} you={client?.seat === i} speaking={!!voice && (client?.seat === i ? voice.level("local") : voice.level("remote")) > 0.04} />
            ))}
          </div>

          {!partner && (
            <div className="rush-invite">
              <div className="ref-row dark">
                <input readOnly value={invite} onFocus={(e) => e.currentTarget.select()} />
                <button
                  className="mini-btn"
                  onClick={async () => {
                    try { await navigator.clipboard.writeText(invite); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* no-op */ }
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <a
                className="lab-btn ghost"
                target="_blank"
                rel="noopener noreferrer"
                href={`https://x.com/intent/tweet?text=${encodeURIComponent(`Need a partner for Reptile Rush 🦎🪢 Join my room → ${invite}`)}`}
              >
                <XGlyph size={14} /> Invite on X
              </a>
              <small className="muted">Your partner must be Level 3 too.</small>
            </div>
          )}

          <div className="rush-actions">
            <button className={`lab-btn ghost ${voice?.micOn ? "is-on" : ""}`} onClick={toggleVoice}>
              {voice?.micOn ? "🎙 Leave voice" : "🎙 Join voice"}
            </button>
            {voice?.micOn && (
              <button className="lab-btn ghost" onClick={() => voice.setMuted(!voice.muted)}>{voice.muted ? "Unmute" : "Mute"}</button>
            )}
            {voice?.needsTap && <button className="lab-btn ghost" onClick={() => voice.resumeAudio()}>🔊 Tap to hear partner</button>}
            <button
              className={`lab-btn big ${me?.ready ? "ghost" : ""}`}
              disabled={!partner}
              onClick={() => { play("select"); client?.ready(!me?.ready); }}
            >
              {!partner ? "Waiting for partner…" : me?.ready ? (partner.ready ? "Starting…" : "Waiting for partner…") : "I'm ready"}
            </button>
          </div>
          {note && <p className="panel-note">{note}</p>}
          <button className="link-btn" onClick={() => navigate("/rush")}>Leave room</button>
        </Card>
      )}

      {inGame && client && (
        <div className="rush-play">
          <RushGame client={client} names={names} onFrame={onFrame} />
          <div className="rush-hud">
            <button className="hud-exit" aria-label="Leave match" onClick={() => { if (window.confirm("Leave this match? Your partner will be sent back to the lobby.")) navigate("/rush"); }}>×</button>
            <span ref={hud} className="rush-hud-text" />
            <button className={`hud-btn ${voice?.micOn ? (voice.muted ? "" : "is-on") : ""}`} onClick={() => (voice?.micOn ? voice.setMuted(!voice.muted) : toggleVoice())}>
              {voice?.micOn ? (voice.muted ? "🔇" : "🎙") : "🎙+"}
            </button>
            {partner?.voice && <span className={`hud-voice ${voice && voice.level("remote") > 0.04 ? "speaking" : ""}`}>@{partner.handle}</span>}
          </div>
          <div className="rush-keys">A/D move · W/Space jump · S/Shift anchor · anchor + jump = reel</div>
          {status === "countdown" && <div className="rush-countdown" key={cdLeft}>{cdLeft || "GO!"}</div>}
          {paused && <div className="rush-banner">Partner disconnected — waiting up to 60s…</div>}
          {stageBanner && (
            <div className="rush-stage-banner">
              <small>Stage 2</small>
              <b>{STAGE_INFO.stages[1].name}</b>
              <span>{STAGE_INFO.stages[1].tagline} 😈</span>
            </div>
          )}
          {note && <div className="rush-toast">{note}</div>}
          {voice?.needsTap && <button className="rush-banner tap" onClick={() => voice.resumeAudio()}>🔊 Tap to hear your partner</button>}

          {result && (
            <div className="modal-scrim">
              <div className="evolved-card">
                {result.kind === "won" ? (
                  <>
                    <span className="eyebrow">Stage cleared</span>
                    <div className="rush-duo"><Reptile level={4} size={110} /><Reptile level={4} size={110} /></div>
                    <h2>{result.youWon ? "GTD unlocked! 👑" : "Cleared!"}</h2>
                    <p>
                      {Math.floor(result.ms / 60000)}:{String(Math.floor((result.ms % 60000) / 1000)).padStart(2, "0")} · {result.deaths} falls
                      {partner ? ` · with @${partner.handle}` : ""}
                    </p>
                    {result.error && <p className="panel-note bad">{result.error}</p>}
                    {result.youWon && (
                      <button className="lab-btn big" onClick={() => setWl(true)}>
                        {state?.allocation?.tier === "gtd" ? "View GTD spot" : "Submit wallet for GTD"}
                      </button>
                    )}
                    <button className="lab-btn ghost" onClick={() => client.again()}>Play again</button>
                  </>
                ) : (
                  <>
                    <span className="eyebrow">Time's up</span>
                    <h2>So close</h2>
                    <p>10 minutes ran out on this stage. Talk it through — you'll restart from the stage you reached.</p>
                    <button className="lab-btn big" onClick={() => client.again()}>Try again</button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
      {wl && <WhitelistModal onClose={() => setWl(false)} />}
    </>
  );
}

function SeatCard({ seat, you, speaking }: { seat: SeatView | null; you: boolean; speaking: boolean }) {
  if (!seat) {
    return (
      <div className="seat empty">
        <div className="seat-avatar">?</div>
        <b>Waiting…</b>
        <small>Share the invite link</small>
      </div>
    );
  }
  return (
    <div className={`seat ${seat.ready ? "is-ready" : ""} ${!seat.connected ? "is-away" : ""}`}>
      <div className={`seat-avatar ${speaking ? "speaking" : ""}`}>
        {seat.avatar_url ? <img src={seat.avatar_url} alt="" /> : <Reptile level={seat.level} size={56} />}
      </div>
      <b>@{seat.handle}{you ? " (you)" : ""}</b>
      <small>Lv {seat.level} · {levelName(seat.level)}{seat.won_before ? " · GTD ✓" : ""}</small>
      <span className="seat-tags">
        {seat.voice && <em>🎙 voice</em>}
        <em className={seat.ready ? "ok" : ""}>{seat.ready ? "Ready" : seat.connected ? "Not ready" : "Reconnecting…"}</em>
      </span>
    </div>
  );
}

const YOU_DIED = ["💀 You fell for it", "💀 Skill issue", "💀 You died. Again.", "💀 That one was on you", "💀 Ouch."];
const THEY_DIED = ["fell for it", "killed you both", "had a skill issue", "is the reason you died", "walked right into that"];
function pick(a: string[]) {
  return a[Math.floor(Math.random() * a.length)];
}
