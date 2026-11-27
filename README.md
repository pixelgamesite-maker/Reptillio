# Reptilio — Evolve to Claim

A gamified whitelist on Robinhood Chain. Players sign in with X, get a free Genesis Egg, earn **DNA**, buy specimens in **the Lab**, and evolve their reptile. **Hunter (Lv 3) unlocks FCFS and Reptile Rush. Clearing Reptile Rush with a friend gives both players GTD.**

React + TypeScript + Vite · Supabase (Postgres, Auth, Edge Functions) · wagmi + RainbowKit · Cloudflare Workers + Durable Objects (Rush game server)

```
src/
  pages/        Chapters (/), Lab (/lab), Rush (/rush, /rush/:code), Den (/den), Callback (/callback)
  components/   Tube, Reptile, Drawer, ItemsPanel, ActivityPanel, QuizModal, WhitelistModal, TopBar, RushGame
  hooks/        useAuth (X sign-in, referrals), useGame (state + actions), useSound
  lib/          api.ts (every backend call), demo.ts (offline fake), game.ts, assets.ts, web3.ts,
                rush.ts (game netcode), voice.ts (WebRTC voice chat)
shared/rush/    sim.ts (physics: runs on server AND browser), stage.ts, protocol.ts, bot.ts + rush.test.ts
rush-server/    Cloudflare Worker + Durable Object rooms (authoritative game server)
supabase/
  schema.sql                     all tables, rules, RPCs, RLS
  migrations/002_reptile_rush.sql  one-time config update if you deployed before Rush
  quiz_questions.sql             70 crypto/NFT history questions
  functions/verify-wallet/       wallet signature check (Edge Function)
public/items/                    the six specimen images
```

## Try it without a backend

```bash
npm install
VITE_DEMO=true npm run dev
```

Demo mode fakes the whole backend in the browser. Jump ahead with `?level=4&dna=900` on first load, or clear localStorage to start over. To try Rush locally, also run the game server (below) and open a second browser profile with `?as=friend&level=3`.

## Go live

1. **Supabase project** → SQL Editor → run `supabase/schema.sql`, then `supabase/quiz_questions.sql`. Both are safe to re-run.
2. **X login**: Authentication → Providers → enable **X / Twitter (OAuth 2.0)**. Add `https://YOUR-SITE/callback` to Redirect URLs. If your project lists the provider as `twitter`, change `"x"` in `src/hooks/useAuth.tsx`.
3. **Wallet verification**: `supabase functions deploy verify-wallet`. Optionally `supabase secrets set ROBINHOOD_RPC_URL=…` (needed only for smart-contract wallets).
4. **Env**: copy `.env.example` → `.env.local`, then fill in `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_WALLETCONNECT_PROJECT_ID` (free at cloud.reown.com).
5. **Campaign post**: once it's live, point the like/repost/quote tasks at it: `update task_catalog set href = 'https://x.com/reptiliorbh/status/<post id>' where key in ('like','repost','quote');`
6. **Make yourself admin**: `update profiles set is_admin = true where handle = 'yourhandle';`
7. **Reptile Rush server** — see [Reptile Rush](#reptile-rush) below, then set `VITE_RUSH_URL`.
8. `npm run build` → serve `dist/` (a Caddyfile for SPA routing is included).

Already deployed before Rush existed? Re-run `schema.sql`, then run `supabase/migrations/002_reptile_rush.sql` once.

## The economy (tuned for a 3–5 day campaign)

| Evolution | Specimen | Cost | Running total |
|---|---|---|---|
| Lv 1 Hatchling | Genesis Egg | free | 0 |
| → Lv 2 Juvenile | Vitality Extract | 100 | 100 |
| → **Lv 3 Hunter · FCFS + Reptile Rush** | DNA Capsule | 150 | **250** |
| → Lv 4 Predator | Ancient Scale | 250 | 500 |
| → Lv 5 Alpha | Mutation Core | 300 | 800 |
| → Lv 6 Apex | Evolution Catalyst | 400 | 1,200 |

**GTD comes only from winning Reptile Rush** (both players must be Level 3). Levels 4–6 are optional bragging rights for the leaderboard. There's no GTD cap (`gtd_limit = 0`).

| Source | DNA |
|---|---|
| Missions (follow / like / repost / quote, one-time) | 200 |
| Daily check-in (per UTC day) | 50 |
| Quiz: 1 question, 60 s, every 5 h | 60 if correct, 10 if wrong |
| Referral (paid when the friend reaches Juvenile, max 10) | 50 each |
| Lifetime cap | 1,500 |

The four missions plus one check-in are exactly 250 DNA, so an engaged player reaches **Hunter (FCFS) on day 1**. To make FCFS a little harder, raise the DNA Capsule price (e.g. 200 means one quiz or a second day is also needed). Every number is a row in `app_config` or `items`, so you can retune live:

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
- **Rush wins can't be faked.** Browsers send only button presses. The game server runs the physics and records a win with the service role; players can't call `rush_record_win()`, and it re-checks both players' level, ban status and the campaign window.
- Tested against real Postgres (PGlite): `npm run test:db` — 57 checks.

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

## Reptile Rush

A two-player co-op platformer. The players are roped together (up to 7 tiles apart). Both have to reach the exit; when they do, **both** get GTD and submit their wallets with the normal claim flow.

**Controls:** A/D or ←/→ move · W/↑/Space jump · S/↓/Shift **anchor** (become a fixed point) · **anchor + jump = reel** your partner in. On phones, on-screen buttons appear (landscape is best). Players can stand on each other's heads.

A run is **two stages back to back**. Clear both and you both win.

**Stage 1 — The Overgrown Temple** (learn the moves):

1. **Warm-up:** steps and a spike pit.
2. **Gate A:** one player holds a plate while the other walks through and holds the far plate.
3. **Temple wall:** 4 tiles, too high to jump alone. Stand on your partner, climb up, then anchor and reel them up.
4. **The Well:** drop in to hold plate B, which opens Gate B. Your partner goes through, stands on the far plate, then anchors and reels you out.
5. **Final run** over a spike pit to the exit.

**Stage 2 — The Devil's Gauntlet** (a troll stage, in the style of Level Devil):

- **A.** The floor right in front of you drops into spikes.
- **B.** A calm, flat runway, until spikes pop out of it.
- **C.** A bridge over spikes with two fake blocks.
- **D.** A pit too wide to jump, but there are invisible stepping stones (watch for the faint sparkle).
- **E.** Partner trap: the plate opens the gate, then drops the floor under whoever is waiting by it.
- **F.** More pop-up spikes, then the exit runs away up a 4-tile wall, so you need the climb-and-reel move one more time.

When a player dies, both screens shake and show who fell for it ("💀 @bob killed you both"). Both players go back to the last checkpoint. Collapsed floors and pop-up spikes reset when you die. Revealed stones and the moved exit stay as they are.

There's a 10-minute limit **per stage**. If time runs out, the same duo restarts from the stage they reached.

`npm run test:rush` runs a bot duo that clears both stages without dying. It also proves that the co-op obstacles can't be cleared solo, and that **every troll really catches a player who walks in without knowing it's there**. Edit the stages and traps in `stage.ts`, then re-run the test.

### How it runs

- **Game server:** `rush-server/` is a Cloudflare Worker with one Durable Object per room. It authenticates players with their Supabase token and checks their level server-side. It runs the 60 Hz simulation, sends 20 snapshots a second, and records wins.
- **Browser:** runs the same simulation to predict your own movement instantly, then corrects itself smoothly to the server's version.
- **Voice:** browser-to-browser WebRTC (audio only). Signaling goes through the room's WebSocket. Cloudflare's TURN relay is the fallback for strict mobile networks.

### Deploy

```bash
cd rush-server && npm install
npx wrangler login
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# Optional, but recommended for voice on mobile networks — create a TURN key in
# Cloudflare dashboard → Realtime → TURN, then:
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
# Put your site's URL in ALLOWED_ORIGINS in wrangler.toml, then:
npx wrangler deploy
```

Set `VITE_RUSH_URL` in the site's env to the `https://reptilio-rush.<you>.workers.dev` URL that wrangler prints.

**Cost:**

- The Workers Free plan works for testing: 100,000 requests and 13,000 GB-s of Durable Object time a day, which is roughly a few hundred matches.
- For launch, use **Workers Paid ($5/month)** for headroom.
- TURN relay: the first 1,000 GB a month are free. Voice is tiny, and most calls connect directly without the relay.

### Local testing

```bash
cd rush-server && npx wrangler dev --var DEV_AUTH:true --port 8787   # accepts dev tokens, no Supabase
npx tsx test/net.test.ts                                              # two bot clients clear the stage over WebSockets
```

`DEV_AUTH` must stay `"false"` in production.

### Anti-abuse notes

- Each account can win once. The same pair winning twice creates no new GTD.
- A player who already won can still play to help a friend, and only the friend gains GTD.
- One person running two Level 3 accounts can still play both sides. With no cap, the real gate is reaching Level 3 on both accounts. To tighten it, raise `rush_min_level`, add an X account-age check in `rush_player()`, or set `gtd_limit`.
