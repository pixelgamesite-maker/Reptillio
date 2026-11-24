import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import type { CampaignStats, LeaderRow } from "../lib/game";
import { LEVELS, levelName } from "../lib/game";
import { useGame } from "../hooks/useGame";
import { TopBar } from "../components/TopBar";
import { Reptile } from "../components/Reptile";
import { BackIcon, DnaIcon } from "../components/Icons";

/** The Den: who's furthest along, and how full the whitelist pools are. */
export default function Den() {
  const { state } = useGame();
  const [rows, setRows] = useState<LeaderRow[] | null>(null);
  const [stats, setStats] = useState<CampaignStats | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    Promise.all([api.leaderboard(50), api.stats()])
      .then(([r, s]) => {
        setRows(r);
        setStats(s);
      })
      .catch((e: Error) => setErr(e.message));
  }, []);

  const maxBar = stats ? Math.max(1, ...Object.values(stats.by_level)) : 1;

  return (
    <div className="paper-page den-page">
      <div className="paper-bg" aria-hidden="true" />
      <TopBar
        title="The Den"
        left={
          <Link to="/" className="kraft-btn back-btn" aria-label="Back to chapters">
            <BackIcon size={18} />
            <span>Chapters</span>
          </Link>
        }
      />

      <main className="den">
        {stats && (
          <section className="den-stats">
            <div className="den-stat">
              <b>{stats.players.toLocaleString()}</b>
              <small>reptiles hatched</small>
            </div>
            <Pool label="FCFS" taken={stats.fcfs_taken} limit={stats.fcfs_limit} />
            <Pool label="GTD (Rush winners)" taken={stats.gtd_taken} limit={stats.gtd_limit} gold />
            <div className="den-levels" aria-label="Players by level">
              {LEVELS.map((l) => {
                const n = stats.by_level[l.level] ?? 0;
                return (
                  <div key={l.level} className="den-level">
                    <span className="den-level-track"><span className="den-level-bar" style={{ height: `${Math.max(4, (n / maxBar) * 100)}%` }} /></span>
                    <small>{l.name}</small>
                    <em>{n}</em>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        <section className="den-board">
          <h2>Leaderboard</h2>
          <p className="den-sub">Ranked by evolution level, then by who got there first.</p>
          {err && <p className="panel-note bad">{err}</p>}
          {!rows && !err && <p className="den-sub">Loading…</p>}
          {rows && rows.length === 0 && <p className="den-sub">No reptiles yet — be the first.</p>}
          {rows && rows.length > 0 && (
            <ol className="board">
              {rows.map((r) => {
                const me = state?.profile.reptilio_id === r.reptilio_id;
                return (
                  <li key={r.reptilio_id} className={`board-row ${me ? "is-me" : ""} ${r.rank <= 3 ? `top-${r.rank}` : ""}`}>
                    <span className="board-rank">{r.rank}</span>
                    <span className="board-mini"><Reptile level={r.level} size={44} /></span>
                    <span className="board-who">
                      <b>@{r.handle}</b>
                      <small>{r.reptilio_id}</small>
                    </span>
                    <span className="board-lvl">Lv {r.level} · {levelName(r.level)}</span>
                    <span className="board-dna"><DnaIcon size={13} /> {r.earned}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </div>
  );
}

function Pool({ label, taken, limit, gold }: { label: string; taken: number; limit: number; gold?: boolean }) {
  const pct = limit > 0 ? Math.min(100, (taken / limit) * 100) : 0;
  return (
    <div className={`den-stat den-pool ${gold ? "gold" : ""}`}>
      <b>{taken.toLocaleString()}{limit > 0 && <span>/{limit.toLocaleString()}</span>}</b>
      <small>{label} spots claimed</small>
      {limit > 0 ? <div className="pool-bar"><span style={{ width: `${pct}%` }} /></div> : <div className="pool-nocap">No cap</div>}
    </div>
  );
}
