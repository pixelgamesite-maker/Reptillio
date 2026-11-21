import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { useAuth, takeReferral } from "./useAuth";
import type { GameState, Item, Requirement, Task } from "../lib/game";

type Result<T = void> = { ok: true; data: T } | { ok: false; error: string };

type GameValue = {
  state: GameState | null;
  items: Item[];
  requirements: Requirement[];
  tasks: Task[];
  loading: boolean;
  error: string;
  /** server time minus device time, ms — use `now()` below for timers */
  clockOffset: number;
  now: () => number;
  refresh: () => Promise<void>;
  setState: (s: GameState) => void;
  /** Requirements for the player's next level, with how many they hold. */
  nextReqs: { item: Item; need: number; have: number }[];
  canEvolve: boolean;
  run: <T>(fn: () => Promise<T>, apply?: (v: T) => GameState | undefined) => Promise<Result<T>>;
};

const GameContext = createContext<GameValue | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const { signedIn } = useAuth();
  const [state, setRawState] = useState<GameState | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clockOffset, setClockOffset] = useState(0);

  const setState = useCallback((s: GameState) => {
    setRawState(s);
    if (s?.server_now) setClockOffset(new Date(s.server_now).getTime() - Date.now());
  }, []);

  // Catalog data is public and rarely changes — load once.
  useEffect(() => {
    Promise.all([api.items(), api.requirements(), api.tasks()])
      .then(([i, r, t]) => {
        setItems(i);
        setRequirements(r);
        setTasks(t);
      })
      .catch((e) => console.error("catalog load failed", e));
  }, []);

  // On sign-in: create/refresh the profile (attributing any referral) and load state.
  useEffect(() => {
    if (!signedIn) {
      setRawState(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .ensureProfile(takeReferral())
      .then((s) => alive && setState(s))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [signedIn, setState]);

  const refresh = useCallback(async () => {
    if (!signedIn) return;
    try {
      setState(await api.getState());
    } catch (e) {
      setError((e as Error).message);
    }
  }, [signedIn, setState]);

  const run = useCallback(
    async <T,>(fn: () => Promise<T>, apply?: (v: T) => GameState | undefined): Promise<Result<T>> => {
      try {
        const v = await fn();
        const next = apply ? apply(v) : (v as unknown as GameState);
        if (next && typeof next === "object" && "profile" in next) setState(next);
        return { ok: true, data: v };
      } catch (e) {
        return { ok: false, error: (e as Error).message || "Something went wrong — try again." };
      }
    },
    [setState]
  );

  const nextReqs = useMemo(() => {
    if (!state) return [];
    return requirements
      .filter((r) => r.target_level === state.profile.level + 1)
      .map((r) => ({
        item: items.find((i) => i.key === r.item_key) ?? { key: r.item_key, name: r.item_key, description: "", price: 0, sort: 0, purchasable: true },
        need: r.quantity,
        have: state.inventory[r.item_key] ?? 0,
      }));
  }, [state, requirements, items]);

  const canEvolve = !!state && state.profile.level < 6 && nextReqs.length > 0 && nextReqs.every((r) => r.have >= r.need);

  const value: GameValue = {
    state,
    items,
    requirements,
    tasks,
    loading,
    error,
    clockOffset,
    now: () => Date.now() + clockOffset,
    refresh,
    setState,
    nextReqs,
    canEvolve,
    run,
  };

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}

/** Re-renders every `ms` — for countdowns. */
export function useTick(ms = 1000) {
  const [, set] = useState(0);
  useEffect(() => {
    const id = setInterval(() => set((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
}
