/**
 * The only file that talks to the backend. Every game action is a Postgres
 * RPC (see supabase/schema.sql) — the browser never writes tables directly.
 * With VITE_DEMO=true the same interface runs against an in-memory fake so
 * the UI can be previewed with no Supabase project.
 */
import { supabase, DEMO } from "./supabase";
import { demoApi } from "./demo";
import type { CampaignStats, GameState, Item, LeaderRow, QuizResult, Requirement, Task } from "./game";

export type Api = {
  ensureProfile(ref: string | null): Promise<GameState>;
  getState(): Promise<GameState>;
  items(): Promise<Item[]>;
  requirements(): Promise<Requirement[]>;
  tasks(): Promise<Task[]>;
  completeTask(key: string): Promise<GameState>;
  checkin(): Promise<{ paid: number; state: GameState }>;
  startQuiz(): Promise<GameState>;
  answerQuiz(attemptId: string, choice: number | null): Promise<QuizResult>;
  purchase(itemKey: string): Promise<GameState>;
  evolve(): Promise<{ new_level: number; state: GameState }>;
  createWalletChallenge(address: string): Promise<{ challenge_id: string; message: string }>;
  verifyWallet(challengeId: string, signature: string): Promise<void>;
  claimWhitelist(): Promise<GameState>;
  leaderboard(limit?: number): Promise<LeaderRow[]>;
  stats(): Promise<CampaignStats>;
};

/** Postgres `raise exception` text comes back as error.message — already player-friendly. */
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

async function table<T>(name: string, order: string): Promise<T[]> {
  const { data, error } = await supabase.from(name).select("*").order(order);
  if (error) throw new Error(error.message);
  return (data ?? []) as T[];
}

const realApi: Api = {
  ensureProfile: (ref) => rpc("ensure_profile", { ref_code: ref }),
  getState: () => rpc("get_state"),
  items: () => table<Item>("items", "sort"),
  requirements: () => table<Requirement>("evolution_requirements", "target_level"),
  tasks: () => table<Task>("task_catalog", "sort"),
  completeTask: (key) => rpc("complete_task", { task: key }),
  checkin: () => rpc("daily_checkin"),
  startQuiz: () => rpc("start_quiz"),
  answerQuiz: (attempt, choice) => rpc("answer_quiz", { attempt, choice }),
  purchase: (item) => rpc("purchase_item", { item }),
  evolve: () => rpc("evolve"),
  createWalletChallenge: (addr) => rpc("create_wallet_challenge", { addr }),
  async verifyWallet(challenge_id, signature) {
    const { data, error } = await supabase.functions.invoke("verify-wallet", { body: { challenge_id, signature } });
    if (error) {
      // FunctionsHttpError carries the JSON body we returned — surface its message.
      let msg = error.message;
      try {
        const body = await (error as { context?: Response }).context?.json();
        if (body?.error) msg = body.error;
      } catch {
        /* keep generic */
      }
      throw new Error(msg);
    }
    if (!data?.ok) throw new Error(data?.error ?? "Verification failed");
  },
  claimWhitelist: () => rpc("claim_whitelist"),
  leaderboard: (limit = 50) => rpc("get_leaderboard", { lim: limit }),
  stats: () => rpc("get_campaign_stats"),
};

export const api: Api = DEMO ? demoApi : realApi;
