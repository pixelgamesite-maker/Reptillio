/**
 * In-memory stand-in for the Supabase RPCs, used only when VITE_DEMO=true.
 * Mirrors the real rules closely enough to click through the whole game.
 * Handy URL params in demo mode: ?level=4  ?dna=900  (applied on first load)
 * Nothing here is used in production.
 */
import type { Api } from "./api";
import type { GameState, Item, Requirement, Task } from "./game";

const KEY = "reptilio_demo_v1";

const CONFIG: Record<string, number> = {
  dna_cap: 1500, checkin_points: 50, quiz_cooldown_minutes: 300, quiz_seconds: 60,
  quiz_reward: 60, quiz_wrong_reward: 10, referral_points: 50, referral_max_rewarded: 10,
  fcfs_level: 3, rush_min_level: 3, fcfs_limit: 1000, gtd_limit: 0, campaign_ends_epoch: 0,
};

const ITEMS: Item[] = [
  { key: "genesis_egg", name: "Genesis Egg", description: "Your free starting egg. Every reptile begins here.", price: 0, sort: 1, purchasable: false },
  { key: "vitality_extract", name: "Vitality Extract", description: "Physical development. Cracks the egg open.", price: 100, sort: 2, purchasable: true },
  { key: "dna_capsule", name: "DNA Capsule", description: "Hunter form. Unlocks FCFS and Reptile Rush.", price: 150, sort: 3, purchasable: true },
  { key: "ancient_scale", name: "Ancient Scale", description: "Armoured hide. Evolves your reptile into a Predator.", price: 250, sort: 4, purchasable: true },
  { key: "mutation_core", name: "Mutation Core", description: "Molten genetic mutation. Unlocks the Alpha form.", price: 300, sort: 5, purchasable: true },
  { key: "evolution_catalyst", name: "Evolution Catalyst", description: "The rarest resource. Triggers the final Apex transformation.", price: 400, sort: 6, purchasable: true },
];

const REQS: Requirement[] = [
  { target_level: 2, item_key: "vitality_extract", quantity: 1 },
  { target_level: 3, item_key: "dna_capsule", quantity: 1 },
  { target_level: 4, item_key: "ancient_scale", quantity: 1 },
  { target_level: 5, item_key: "mutation_core", quantity: 1 },
  { target_level: 6, item_key: "evolution_catalyst", quantity: 1 },
];

const TASKS: Task[] = [
  { key: "follow", label: "Follow @reptiliorbh on X", points: 100, href: "https://x.com/reptiliorbh", sort: 1 },
  { key: "like", label: "Like the campaign post", points: 25, href: "https://x.com/reptiliorbh", sort: 2 },
  { key: "repost", label: "Repost the campaign post", points: 25, href: "https://x.com/reptiliorbh", sort: 3 },
  { key: "quote", label: "Quote the post with your Reptilio ID", points: 50, href: "https://x.com/reptiliorbh", sort: 4 },
];

const QUESTIONS = [
  { q: "In what year was the Bitcoin whitepaper published?", o: ["2006", "2008", "2010", "2012"], a: 1 },
  { q: "Which studio launched CryptoPunks in 2017?", o: ["Yuga Labs", "Dapper Labs", "Larva Labs", "Art Blocks"], a: 2 },
  { q: "How many BTC did Laszlo Hanyecz pay for two pizzas in 2010?", o: ["100 BTC", "1,000 BTC", "10,000 BTC", "50,000 BTC"], a: 2 },
  { q: "Which token standard is used for most Ethereum NFTs?", o: ["ERC-20", "ERC-777", "ERC-721", "ERC-4337"], a: 2 },
  { q: "Robinhood Chain is built with which Layer 2 technology?", o: ["Optimism OP Stack", "zkSync", "Arbitrum", "Polygon CDK"], a: 2 },
];

type Db = {
  level: number; ledger: { amount: number; kind: string; source: string; ref: string }[];
  inventory: Record<string, number>; tasks: string[];
  quiz: { id: string; q: number; started: number; expires: number; answered: boolean } | null;
  quizCount: number; correct: number; wallet: string | null;
  allocation: GameState["allocation"];
  rushWon?: boolean;
};

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  const p = new URLSearchParams(location.search);
  const db: Db = {
    level: Math.min(6, Math.max(1, Number(p.get("level")) || 1)),
    ledger: [], inventory: { genesis_egg: 1 }, tasks: [], quiz: null, quizCount: 0, correct: 0,
    wallet: null, allocation: null,
  };
  const dna = Number(p.get("dna"));
  if (dna > 0) db.ledger.push({ amount: dna, kind: "earn", source: "demo", ref: "seed" });
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ }
  return db;
}
let db = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch { /* ignore */ } };

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const balance = () => db.ledger.reduce((s, l) => s + l.amount, 0);
const earned = () => db.ledger.filter((l) => l.kind === "earn").reduce((s, l) => s + l.amount, 0);
const today = () => new Date().toISOString().slice(0, 10);

function award(amount: number, source: string, ref: string) {
  const actual = Math.min(amount, CONFIG.dna_cap - earned());
  if (actual > 0) db.ledger.push({ amount: actual, kind: "earn", source, ref });
  return Math.max(0, actual);
}

function state(): GameState {
  const q = db.quiz;
  const open = q && !q.answered && q.expires > Date.now()
    ? { attempt_id: q.id, question: QUESTIONS[q.q].q, options: QUESTIONS[q.q].o, expires_at: new Date(q.expires).toISOString() }
    : null;
  const tomorrow = new Date(); tomorrow.setUTCHours(24, 0, 0, 0);
  return {
    profile: { id: "demo", handle: demoHandle(), name: "Demo Player", avatar_url: "", reptilio_id: "RPT-00042", level: db.level, is_admin: false },
    balance: balance(), earned: earned(),
    inventory: Object.fromEntries(Object.entries(db.inventory).filter(([, v]) => v > 0)),
    tasks_done: [...db.tasks],
    checked_in_today: db.ledger.some((l) => l.source === "checkin" && l.ref === today()),
    next_checkin_at: tomorrow.toISOString(),
    quiz: { next_at: q ? new Date(q.started + CONFIG.quiz_cooldown_minutes * 60000).toISOString() : null, open, answered: db.quizCount, correct: db.correct },
    wallet: db.wallet, allocation: db.allocation,
    referrals: { joined: 3, rewarded: 1 },
    rush: db.rushWon ? { won: true, won_at: new Date().toISOString(), partner: "your_partner", duration_ms: 184000 } : null,
    campaign_open: true, server_now: new Date().toISOString(), config: CONFIG,
  };
}

function fail(msg: string): never { throw new Error(msg); }

export const demoApi: Api = {
  async ensureProfile() { await wait(); return state(); },
  async getState() { await wait(100); return state(); },
  async items() { return ITEMS; },
  async requirements() { return REQS; },
  async tasks() { return TASKS; },
  async completeTask(key) {
    await wait();
    const t = TASKS.find((x) => x.key === key) ?? fail("Unknown task");
    if (!db.tasks.includes(key)) { db.tasks.push(key); award(t.points, "task", key); }
    save(); return state();
  },
  async checkin() {
    await wait();
    if (state().checked_in_today) fail("Already checked in today — come back after 00:00 UTC");
    const paid = award(CONFIG.checkin_points, "checkin", today());
    save(); return { paid, state: state() };
  },
  async startQuiz() {
    await wait(400);
    const q = db.quiz;
    if (q && !q.answered && q.expires > Date.now()) return state();
    if (q && q.started + CONFIG.quiz_cooldown_minutes * 60000 > Date.now()) fail("Next quiz unlocks later — check the timer");
    const now = Date.now();
    db.quiz = { id: String(now), q: db.quizCount % QUESTIONS.length, started: now, expires: now + CONFIG.quiz_seconds * 1000, answered: false };
    save(); return state();
  },
  async answerQuiz(id, choice) {
    await wait(400);
    const q = db.quiz;
    if (!q || q.id !== id) fail("Quiz not found");
    if (q.answered) fail("Already answered");
    const late = Date.now() > q.expires + 3000;
    const picked = late ? null : choice;
    const right = QUESTIONS[q.q].a;
    const correct = picked === right;
    const reward = correct ? award(CONFIG.quiz_reward, "quiz", id) : picked !== null ? award(CONFIG.quiz_wrong_reward, "quiz", id) : 0;
    q.answered = true; db.quizCount++; if (correct) db.correct++;
    save();
    return { correct, correct_choice: right, choice: picked, reward, timed_out: picked === null, state: state() };
  },
  async purchase(key) {
    await wait();
    const it = ITEMS.find((i) => i.key === key && i.purchasable) ?? fail("That item is not for sale");
    const req = REQS.find((r) => r.target_level === db.level + 1 && r.item_key === key) ?? fail(`${it.name} is not needed for your next evolution`);
    if ((db.inventory[key] ?? 0) >= req.quantity) fail(`You already have the ${it.name} you need — evolve!`);
    if (balance() < it.price) fail(`Not enough DNA: have ${balance()}, need ${it.price}`);
    db.ledger.push({ amount: -it.price, kind: "spend", source: "purchase", ref: key + Date.now() });
    db.inventory[key] = (db.inventory[key] ?? 0) + 1;
    save(); return state();
  },
  async evolve() {
    await wait(300);
    if (db.level >= 6) fail("You are already Apex");
    const reqs = REQS.filter((r) => r.target_level === db.level + 1);
    for (const r of reqs) if ((db.inventory[r.item_key] ?? 0) < r.quantity) fail(`Missing ${ITEMS.find((i) => i.key === r.item_key)?.name}`);
    for (const r of reqs) db.inventory[r.item_key] -= r.quantity;
    db.level += 1;
    save(); return { new_level: db.level, state: state() };
  },
  async createWalletChallenge(address) {
    await wait();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) fail("That is not a valid EVM address");
    db.wallet = null;
    return { challenge_id: address.toLowerCase(), message: `Reptilio wallet verification\n\nWallet: ${address.toLowerCase()}\n(demo mode — nothing is checked)` };
  },
  async verifyWallet(challengeId) { await wait(500); db.wallet = challengeId; save(); },
  async claimWhitelist() {
    await wait();
    if (!db.wallet) fail("Verify a wallet first");
    const tier = db.rushWon ? "gtd" : db.level >= 3 ? "fcfs" : fail("Reach Level 3 (Hunter) to unlock the whitelist");
    if (!db.allocation || (db.allocation.tier === "fcfs" && tier === "gtd")) {
      db.allocation = { tier, number: tier === "gtd" ? 37 : 412, wallet: db.wallet, claimed_at: new Date().toISOString() };
    }
    save(); return state();
  },
  async leaderboard() {
    await wait();
    const names = ["scalequeen", "gekko_eth", "dinomaxi", "coldblood", "iguanodon", "komodo_k", "basilisk", "chameleo", "tuatara_", "monitorlz", "anole.eth", "skinkdao"];
    return names.map((h, i) => ({
      rank: i + 1, handle: h, avatar_url: "", reptilio_id: `RPT-${String(100 + i * 7).padStart(5, "0")}`,
      level: Math.max(1, 6 - Math.floor(i / 2.2)), earned: 1500 - i * 95, referrals: Math.max(0, 9 - i), reached_at: new Date().toISOString(),
    }));
  },
  async stats() {
    await wait();
    return { players: 3184, by_level: { 1: 1210, 2: 804, 3: 517, 4: 388, 5: 171, 6: 94 }, fcfs_taken: 341, gtd_taken: 126, fcfs_limit: 1000, gtd_limit: 0, campaign_ends_epoch: 0, rush_winners: 126, rush_matches: 210 };
  },
};

/** Demo-only: pretend the Rush server recorded a win for this player. */
export function markDemoRushWin() {
  db.rushWon = true;
  save();
}

/** Demo-only handle — open a second tab with ?as=friend to play both seats locally. */
function demoHandle() {
  try {
    const q = new URLSearchParams(location.search).get("as");
    if (q) sessionStorage.setItem("reptilio_demo_as", q.replace(/[^a-z0-9_]/gi, "").slice(0, 15));
    return sessionStorage.getItem("reptilio_demo_as") || "reptile_fan";
  } catch {
    return "reptile_fan";
  }
}

/** Demo-only: wipe progress. */
export function resetDemo() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  db = load();
}
