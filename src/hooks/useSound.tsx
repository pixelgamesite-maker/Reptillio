import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ASSETS } from "../lib/assets";

/**
 * Two clips, pitch- and volume-shifted into every sound the game needs
 * (same trick as Floks). Drop replacements into /public/sounds/.
 */
const FILES = { select: ASSETS.sounds.select, levelup: ASSETS.sounds.levelup } as const;
type FileKey = keyof typeof FILES;

const VOICES = {
  select: { file: "select", rate: 1.0, volume: 0.4 },
  purchase: { file: "select", rate: 1.25, volume: 0.5 },
  error: { file: "select", rate: 0.72, volume: 0.32 },
  tick: { file: "select", rate: 1.6, volume: 0.18 },
  correct: { file: "levelup", rate: 1.15, volume: 0.5 },
  levelup: { file: "levelup", rate: 1.0, volume: 0.55 },
  claim: { file: "levelup", rate: 0.85, volume: 0.6 },
} satisfies Record<string, { file: FileKey; rate: number; volume: number }>;

export type SoundKey = keyof typeof VOICES;

const MUTE_KEY = "reptilio_muted";

type SoundValue = { play: (key: SoundKey) => void; muted: boolean; toggleMute: () => void };
const SoundContext = createContext<SoundValue | null>(null);

export function SoundProvider({ children }: { children: ReactNode }) {
  const cache = useRef<Partial<Record<FileKey, HTMLAudioElement>>>({});
  const [muted, setMuted] = useState(() => {
    try {
      return localStorage.getItem(MUTE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    (Object.keys(FILES) as FileKey[]).forEach((k) => {
      if (cache.current[k]) return;
      const a = new Audio(FILES[k]);
      a.preload = "auto";
      cache.current[k] = a;
    });
  }, []);

  const play = useCallback(
    (key: SoundKey) => {
      if (muted) return;
      const v = VOICES[key];
      const base = cache.current[v.file];
      if (!base) return;
      const node = base.cloneNode(true) as HTMLAudioElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
      node.volume = v.volume;
      node.playbackRate = v.rate;
      node.preservesPitch = false;
      node.webkitPreservesPitch = false;
      node.play().catch(() => {});
    },
    [muted]
  );

  const toggleMute = useCallback(() => {
    setMuted((m) => {
      try {
        localStorage.setItem(MUTE_KEY, String(!m));
      } catch {
        /* no-op */
      }
      return !m;
    });
  }, []);

  return <SoundContext.Provider value={{ play, muted, toggleMute }}>{children}</SoundContext.Provider>;
}

export function useSound() {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used inside <SoundProvider>");
  return ctx;
}
