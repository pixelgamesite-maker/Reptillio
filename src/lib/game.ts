/** Shared game types + static metadata. Numbers (prices, rewards, limits)
 * come from the database — these are only names, art and copy. */

export type Tier = "fcfs" | "gtd";

export type OpenQuiz = {
  attempt_id: string;
  question: string;
  options: string[];
  expires_at: string;
};

export type GameState = {
  profile: {
    id: string;
    handle: string;
    name: string;
    avatar_url: string;
    reptilio_id: string;
    level: number;
    is_admin: boolean;
  };
  balance: number;
  earned: number;
  inventory: Record<string, number>;
  tasks_done: string[];
  checked_in_today: boolean;
  next_checkin_at: string;
  quiz: { next_at: string | null; open: OpenQuiz | null; answered: number; correct: number };
  wallet: string | null;
  allocation: { tier: Tier; number: number; wallet: string; claimed_at: string } | null;
  referrals: { joined: number; rewarded: number };
  campaign_open: boolean;
  server_now: string;
  config: Record<string, number>;
};

export type Item = {
  key: string;
  name: string;
  description: string;
  price: number;
  sort: number;
  purchasable: boolean;
};

export type Requirement = { target_level: number; item_key: string; quantity: number };

export type Task = { key: string; label: string; points: number; href: string | null; sort: number };

export type QuizResult = {
  correct: boolean;
  correct_choice: number;
  choice: number | null;
  reward: number;
  timed_out: boolean;
  state: GameState;
};

export type LeaderRow = {
  rank: number;
  handle: string;
  avatar_url: string;
  reptilio_id: string;
  level: number;
  earned: number;
  referrals: number;
  reached_at: string;
};

export type CampaignStats = {
  players: number;
  by_level: Record<string, number>;
  fcfs_taken: number;
  gtd_taken: number;
  fcfs_limit: number;
  gtd_limit: number;
  campaign_ends_epoch: number;
};

export const LEVELS = [
  { level: 1, name: "Hatchling", blurb: "A Genesis Egg, humming with potential." },
  { level: 2, name: "Juvenile", blurb: "Freshly hatched and curious." },
  { level: 3, name: "Hunter", blurb: "Claws out. Learning to stalk." },
  { level: 4, name: "Predator", blurb: "Armoured and dangerous. FCFS unlocked." },
  { level: 5, name: "Alpha", blurb: "Mutated. Leads the pack." },
  { level: 6, name: "Apex", blurb: "The final form. GTD unlocked." },
] as const;

export const levelName = (lvl: number) => LEVELS[Math.max(0, Math.min(5, lvl - 1))].name;

export const shortAddr = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

/** "3h 12m", "4m 05s", "12s" */
export function fmtLeft(ms: number) {
  if (ms <= 0) return "now";
  const s = Math.ceil(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
}
