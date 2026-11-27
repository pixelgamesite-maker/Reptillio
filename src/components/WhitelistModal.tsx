import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccount, useSignMessage } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { api } from "../lib/api";
import { DEMO } from "../lib/supabase";
import { shortAddr } from "../lib/game";
import { useGame } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { CheckIcon, XGlyph } from "./Icons";

/**
 * Connect → sign (free, no transaction) → claim. The signature is checked
 * server-side by the verify-wallet Edge Function; the pool caps and the
 * FCFS→GTD upgrade are enforced by claim_whitelist() in Postgres.
 */
export function WhitelistModal({ onClose }: { onClose: () => void }) {
  const { state, run, refresh } = useGame();
  const { play } = useSound();
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState<"" | "sign" | "claim">("");
  const [err, setErr] = useState("");

  if (!state) return null;
  const lvl = state.profile.level;
  const cfg = state.config;
  const fcfsLvl = cfg.fcfs_level ?? 3;
  const rushWon = !!state.rush?.won;
  const eligible: "gtd" | "fcfs" | null = rushWon ? "gtd" : lvl >= fcfsLvl ? "fcfs" : null;
  const alloc = state.allocation;
  const canUpgrade = alloc?.tier === "fcfs" && eligible === "gtd";
  const done = alloc && !canUpgrade;
  const verified = !!state.wallet;
  const walletMismatch = verified && isConnected && address && address.toLowerCase() !== state.wallet!.toLowerCase();

  async function verify() {
    if (!address) return;
    setErr("");
    setBusy("sign");
    try {
      const ch = await api.createWalletChallenge(address);
      const signature = DEMO ? "0x" : await signMessageAsync({ message: ch.message });
      await api.verifyWallet(ch.challenge_id, signature);
      await refresh();
      play("purchase");
    } catch (e) {
      const m = (e as Error).message || "";
      setErr(/reject|denied|cancel/i.test(m) ? "Signature cancelled." : m);
      play("error");
    }
    setBusy("");
  }

  async function claim() {
    setErr("");
    setBusy("claim");
    const res = await run(() => api.claimWhitelist());
    setBusy("");
    if (res.ok) play("claim");
    else {
      setErr(res.error);
      play("error");
    }
  }

  const shareText = alloc
    ? alloc.tier === "gtd"
      ? `We cleared Reptile Rush 🦎🪢🦎 and both secured GTD on @reptiliorbh 👑\n\nGrab a partner → ${window.location.origin}/?ref=${state.profile.reptilio_id}`
      : `My reptile evolved to Hunter 🦎 and secured an FCFS spot on @reptiliorbh 🧬\n\nEvolve yours → ${window.location.origin}/?ref=${state.profile.reptilio_id}`
    : "";

  return (
    <div className="modal-scrim" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wl-card" role="dialog" aria-modal="true" aria-label="Whitelist claim">
        <button className="modal-x" onClick={onClose} aria-label="Close" disabled={!!busy}>×</button>
        <span className="eyebrow">Whitelist</span>

        {!eligible && (
          <>
            <h2>Not yet, little one</h2>
            <p>Reach <b>Level {fcfsLvl} · Hunter</b> for FCFS. Then clear <b>Reptile Rush</b> with a friend for a guaranteed spot.</p>
            <button className="lab-btn" onClick={onClose}>Keep evolving</button>
          </>
        )}

        {eligible && done && alloc && (
          <>
            <h2>{alloc.tier === "gtd" ? "GTD secured 👑" : "FCFS secured 🦎"}</h2>
            <div className={`wl-ticket tier-${alloc.tier}`}>
              <span>{alloc.tier.toUpperCase()}</span>
              <b>#{alloc.number}</b>
              <small>{shortAddr(alloc.wallet)}</small>
            </div>
            {alloc.tier === "fcfs" && !rushWon && (
              <p className="muted">
                Want GTD? Clear <Link to="/rush" onClick={onClose}>Reptile Rush</Link> with a friend and upgrade this spot.
              </p>
            )}
            <a
              className="lab-btn ghost"
              href={`https://x.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              <XGlyph size={14} /> Share on X
            </a>
          </>
        )}

        {eligible && !done && (
          <>
            <h2>{canUpgrade ? "Upgrade to GTD" : eligible === "gtd" ? "Claim your GTD spot" : "Claim your FCFS spot"}</h2>
            <p className="muted">
              {eligible === "gtd"
                ? "You cleared Reptile Rush. Your guaranteed allocation is reserved once your wallet is verified."
                : "First come, first served — spots go in the order claims land."}
            </p>

            <ol className="wl-steps">
              <li className={isConnected || verified ? "done" : "now"}>
                <span>{isConnected || verified ? <CheckIcon size={14} /> : 1}</span>
                <div>
                  <b>Connect an EVM wallet</b>
                  {!isConnected && !verified && (
                    <button className="mini-btn" onClick={openConnectModal}>Connect</button>
                  )}
                  {isConnected && <small>{shortAddr(address)}</small>}
                </div>
              </li>
              <li className={verified ? "done" : isConnected ? "now" : ""}>
                <span>{verified ? <CheckIcon size={14} /> : 2}</span>
                <div>
                  <b>Sign to prove it's yours</b>
                  <small>Free — no transaction, no gas.</small>
                  {verified && <small>Verified {shortAddr(state.wallet)}</small>}
                  {!verified && isConnected && (
                    <button className="mini-btn" onClick={verify} disabled={busy === "sign"}>
                      {busy === "sign" ? "Check your wallet…" : "Sign message"}
                    </button>
                  )}
                </div>
              </li>
              <li className={verified ? "now" : ""}>
                <span>3</span>
                <div>
                  <b>Claim</b>
                  {verified && (
                    <button className="lab-btn" onClick={claim} disabled={busy === "claim"}>
                      {busy === "claim" ? "Claiming…" : canUpgrade ? "Upgrade to GTD" : `Claim ${eligible.toUpperCase()}`}
                    </button>
                  )}
                </div>
              </li>
            </ol>
            {walletMismatch && (
              <p className="panel-note">Your spot will use the verified wallet {shortAddr(state.wallet)}, not the one connected now.</p>
            )}
          </>
        )}

        {err && <p className="panel-note bad">{err}</p>}
      </div>
    </div>
  );
}
