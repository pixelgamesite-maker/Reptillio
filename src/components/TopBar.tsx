import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAuth } from "../hooks/useAuth";
import { useGame } from "../hooks/useGame";
import { useSound } from "../hooks/useSound";
import { levelName, shortAddr } from "../lib/game";
import { SoundIcon, XGlyph } from "./Icons";

export function LogoTile() {
  return (
    <Link to="/" className="logo-tile" aria-label="Reptilio home">
      <span>REP</span>
      <span>TIL</span>
      <span>IO</span>
    </Link>
  );
}

export function TopBar({ title, left, variant = "paper" }: { title?: ReactNode; left?: ReactNode; variant?: "paper" | "lab" }) {
  return (
    <header className={`topbar topbar-${variant}`}>
      <div className="topbar-side">{left ?? <LogoTile />}</div>
      {title && <h1 className="topbar-title">{title}</h1>}
      <div className="topbar-side topbar-right">
        <XButton />
        <WalletPill />
      </div>
    </header>
  );
}

function XButton() {
  const { signedIn, signInWithX, signOut } = useAuth();
  const { state } = useGame();
  const { muted, toggleMute, play } = useSound();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!signedIn) {
    return (
      <button className="kraft-btn x-btn" onClick={() => { play("select"); signInWithX(); }} aria-label="Sign in with X">
        <XGlyph size={18} />
        <span className="x-btn-text">Sign in</span>
      </button>
    );
  }

  const p = state?.profile;
  const link = p ? `${window.location.origin}/?ref=${p.reptilio_id}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* input stays selectable */
    }
  }

  return (
    <div className="profile-wrap">
      <button className="kraft-btn x-btn is-in" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Your profile">
        {p?.avatar_url ? <img src={p.avatar_url} alt="" /> : <XGlyph size={18} />}
      </button>
      {open && (
        <>
          <button className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
          <div className="profile-card" role="dialog" aria-label="Profile">
            <div className="profile-head">
              {p?.avatar_url ? <img src={p.avatar_url} alt="" /> : <span className="profile-avatar-fallback"><XGlyph /></span>}
              <div>
                <b>@{p?.handle ?? "…"}</b>
                <small>{p?.reptilio_id} · Lv {p?.level} {p ? levelName(p.level) : ""}</small>
              </div>
            </div>
            {state && (
              <div className="profile-stats">
                <div><b>{state.balance}</b><small>DNA</small></div>
                <div><b>{state.earned}</b><small>earned</small></div>
                <div><b>{state.referrals.joined}</b><small>referred</small></div>
              </div>
            )}
            <label className="field-label">Your referral link</label>
            <div className="ref-row">
              <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <button className="mini-btn" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <div className="profile-actions">
              <button className="mini-btn ghost" onClick={toggleMute}>
                <SoundIcon size={16} muted={muted} /> {muted ? "Sound off" : "Sound on"}
              </button>
              <button className="mini-btn ghost" onClick={() => { setOpen(false); signOut(); }}>Sign out</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function WalletPill() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, openAccountModal, openChainModal, mounted }) => {
        const ready = mounted;
        const connected = ready && account && chain;
        return (
          <button
            className="kraft-btn wallet-pill"
            style={{ opacity: ready ? 1 : 0 }}
            onClick={!connected ? openConnectModal : chain?.unsupported ? openChainModal : openAccountModal}
          >
            <span className="wallet-pill-inner">
              {!connected ? "Connect wallet" : chain?.unsupported ? "Wrong network" : shortAddr(account.address)}
            </span>
          </button>
        );
      }}
    </ConnectButton.Custom>
  );
}
