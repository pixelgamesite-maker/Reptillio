import { useState } from "react";
import { useGame } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { ASSETS } from "../lib/assets";
import { api } from "../lib/api";
import { levelName } from "../lib/game";
import { CheckIcon, DnaIcon, LockIcon } from "./Icons";

type Status = "starter" | "used" | "ready" | "next" | "locked";

/** Left drawer: the six specimens. Buy the one your next evolution needs. */
export function ItemsPanel({ onMessage }: { onMessage: (msg: string, tone?: "good" | "bad") => void }) {
  const { state, items, requirements, run } = useGame();
  const { play } = useSound();
  const [busy, setBusy] = useState<string | null>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);

  if (!state) return null;
  const level = state.profile.level;
  const cap = state.config.dna_cap ?? 1500;

  const rows = items.map((item) => {
    const req = requirements.find((r) => r.item_key === item.key);
    const target = req?.target_level ?? 1;
    const have = state.inventory[item.key] ?? 0;
    let status: Status;
    if (!item.purchasable) status = "starter";
    else if (level >= target) status = "used";
    else if (target === level + 1 && have >= (req?.quantity ?? 1)) status = "ready";
    else if (target === level + 1) status = "next";
    else status = "locked";
    return { item, target, have, status };
  });

  async function buy(key: string, name: string, price: number) {
    if (state && state.balance < price) {
      play("error");
      onMessage(`You need ${price - state.balance} more DNA for ${name}.`, "bad");
      return;
    }
    setBusy(key);
    const res = await run(() => api.purchase(key));
    setBusy(null);
    if (res.ok) {
      play("purchase");
      onMessage(`${name} added to the tube. Evolve when ready!`, "good");
    } else {
      play("error");
      onMessage(res.error, "bad");
    }
  }

  return (
    <div className="panel-stack">
      <div className="panel-title-row">
        <h2 className="panel-title">Specimens</h2>
        <span className="dna-chip"><DnaIcon size={15} /> {state.balance}</span>
      </div>

      <div className="cap-meter" title="Lifetime DNA earned vs campaign cap">
        <div className="cap-meter-fill" style={{ width: `${Math.min(100, (state.earned / cap) * 100)}%` }} />
        <span>{state.earned} / {cap} DNA earned</span>
      </div>

      <ul className="item-list">
        {rows.map(({ item, target, status }) => (
          <li key={item.key} className={`item-card st-${status} ${openKey === item.key ? "is-open" : ""}`}>
            <button className="item-main" onClick={() => setOpenKey((k) => (k === item.key ? null : item.key))}>
              <span className="item-thumb">
                <img src={ASSETS.items[item.key]} alt="" draggable={false} />
                {status === "used" && <span className="item-thumb-badge"><CheckIcon size={14} /></span>}
                {status === "locked" && <span className="item-thumb-badge lock"><LockIcon size={13} /></span>}
              </span>
              <span className="item-text">
                <b>{item.name}</b>
                <small>
                  {status === "starter" && (level > 1 ? "Hatched" : "Your free starter")}
                  {status === "used" && `Used · ${levelName(target)}`}
                  {status === "ready" && "In the tube — evolve!"}
                  {status === "next" && `Evolves to ${levelName(target)}`}
                  {status === "locked" && `Unlocks at Lv ${target - 1}`}
                </small>
              </span>
              <span className="item-price">
                {item.purchasable ? (<><DnaIcon size={13} />{item.price}</>) : "Free"}
              </span>
            </button>

            {openKey === item.key && <p className="item-desc">{item.description}</p>}

            {status === "next" && (
              <button
                className={`buy-btn ${state.balance < item.price ? "is-short" : ""}`}
                disabled={busy === item.key}
                onClick={() => buy(item.key, item.name, item.price)}
              >
                {busy === item.key
                  ? "Synthesising…"
                  : state.balance >= item.price
                    ? `Buy for ${item.price} DNA`
                    : `Need ${item.price - state.balance} more DNA`}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
