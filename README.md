# Reptilio — Evolve to Claim

A gamified whitelist on Robinhood Chain. Players sign in with X, get a free Genesis Egg, earn **DNA**, buy specimens in **the Lab**, and evolve their reptile through six levels. **Predator (Lv 4) unlocks FCFS; Apex (Lv 6) unlocks GTD.**

React + TypeScript + Vite · Supabase (Postgres, Auth, Edge Functions) · wagmi + RainbowKit

```
src/
  pages/        Chapters (/), Lab (/lab), Den (/den), Callback (/callback)
  components/   Tube, Reptile, Drawer, ItemsPanel, ActivityPanel, QuizModal, WhitelistModal, TopBar
  hooks/        useAuth (X sign-in, referrals), useGame (state + actions), useSound
  lib/          api.ts (every backend call), demo.ts (offline fake), game.ts, assets.ts, web3.ts
supabase/
  schema.sql                     all tables, rules, RPCs, RLS
  quiz_questions.sql             70 crypto/NFT history questions
  functions/verify-wallet/       wallet signature check (Edge Function)
public/items/                    the six specimen images
```

## Try it without a backend

```bash
npm install
VITE_DEMO=true npm run dev
```

Demo mode fakes the whole backend in the browser. Jump ahead with `?level=4&dna=900` on first load, or clear localStorage to start over.

## Go live

1. **Supabase project** → SQL Editor → run `supabase/schema.sql`, then `supabase/quiz_questions.sql`. Both are safe to re-run.
2. **X login**: Authentication → Providers → enable **X / Twitter (OAuth 2.0)**. Add `https://YOUR-SITE/callback` to Redirect URLs. If your project lists the provider as `twitter`, change `"x"` in `src/hooks/useAuth.tsx`.
3. **Wallet verification**: `supabase functions deploy verify-wallet`. Optionally `supabase secrets set ROBINHOOD_RPC_URL=…` (needed only for smart-contract wallets).
4. **Env**: copy `.env.example` → `.env.local`, then fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_WALLETCONNECT_PROJECT_ID` (free at cloud.reown.com).
5. **Replace placeholders**: `REPTILIO_HANDLE` / `POST_ID` in `task_catalog` (schema.sql) and `LINKS.x` in `src/lib/assets.ts`.
6. **Make yourself admin**: `update profiles set is_admin = true where handle = 'yourhandle';`
7. `npm run build` → serve `dist/` (a Caddyfile for SPA routing is included).

## The economy (tuned for a 3–5 day campaign)

| Evolution | Specimen | Cost | Running total |
|---|---|---|---|
| Lv 1 Hatchling | Genesis Egg | free | 0 |
| → Lv 2 Juvenile | Vitality Extract | 100 | 100 |
| → Lv 3 Hunter | DNA Capsule | 150 | 250 |
| → **Lv 4 Predator · FCFS** | Ancient Scale | 250 | **500** |
| → Lv 5 Alpha | Mutation Core | 300 | 800 |
| → **Lv 6 Apex · GTD** | Evolution Catalyst | 400 | **1,200** |

| Source | DNA |
|---|---|
| Missions (follow / like / repost / quote, one-time) | 200 |
| Daily check-in (per UTC day) | 50 |
| Quiz: 1 question, 60 s, every 5 h | 60 if correct, 10 if wrong |
| Referral (paid when the friend reaches Juvenile, max 10) | 50 each |
| Lifetime cap | 1,500 |

A steady player gets about 185 DNA a day: they reach **Predator on day 2** and **Apex around day 4**, sooner with referrals. Every number is a row in `app_config` or `items`, so you can retune live:

```sql
update app_config set value = 600 where key = 'quiz_cooldown_minutes';  -- 10h quizzes
update items set price = 350 where key = 'evolution_catalyst';
update app_config set value = extract(epoch from timestamptz '2026-11-26 18:00Z') where key = 'campaign_ends_epoch';
```

## How it's protected

- **The browser writes nothing directly.** RLS lets players read only their own rows; every change goes through a `SECURITY DEFINER` RPC. Internal helpers (`award_dna`, `player_state` …) have EXECUTE revoked.
- **DNA is a ledger.** Your balance is the sum of the ledger. A unique `(user, source, ref)` index means each task, check-in day, quiz and referral pays once.
- **Row locks on every action**, so double-taps can't spend the same DNA twice. Purchases and evolutions are all-or-nothing.
- **Quiz answers never reach the browser.** `quiz_questions` has no read policy. Options are shuffled per attempt, the server enforces the 60 s limit (+3 s grace) and the cooldown, and a reload resumes the same question instead of rolling a new one.
- **Whitelist**: the wallet is proven by signature (single-use, 10-minute challenge). FCFS and GTD are separate pools, capped under an advisory lock, one wallet per player. Upgrading FCFS → GTD releases the FCFS slot in the same transaction.
- `supabase/` was tested against real Postgres (PGlite): 47 checks covering the rules above.

**Known gap:** X missions are honor-system, as in Floks. Checking follows and likes needs the paid X API. Quizzes and check-ins are the backbone instead.

## Admin (SQL editor, as an admin user)

```sql
select admin_adjust_dna('<user-uuid>', 100, 'Meme contest winner');
select admin_set_banned('<user-uuid>', true, 'Bot farm');
select admin_revoke_allocation('<user-uuid>', 'Duplicate account');
select admin_set_config('gtd_limit', 600);
select * from admin_export_whitelist();   -- CSV-ready
```

Every admin action is written to `admin_audit_logs`.

## Art

- `public/items/*.jpg` holds the six specimens.
- Reptile forms 2–6 are built-in SVG placeholders. To use real art, drop transparent PNGs in `public/` and list them in `ASSETS.reptiles` in `src/lib/assets.ts`.
- Sounds reuse the two Floks clips, pitch-shifted (`src/hooks/useSound.tsx`).
