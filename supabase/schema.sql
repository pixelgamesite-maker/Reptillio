-- ═══════════════════════════════════════════════════════════════════════
-- REPTILIO — full schema
-- Paste into Supabase → SQL Editor → Run. Safe to re-run: tables use
-- IF NOT EXISTS, seeds use ON CONFLICT, functions use CREATE OR REPLACE.
-- Then run supabase/quiz_questions.sql to load the quiz bank.
--
-- Principle: the rules live here, not in the browser. Clients can READ
-- their own rows and call the RPCs below — they cannot write any table
-- directly. Every balance, purchase, evolution, quiz answer and whitelist
-- claim goes through a SECURITY DEFINER function that validates it.
-- ═══════════════════════════════════════════════════════════════════════

-- No extensions needed (gen_random_uuid is built into Postgres 13+).

-- ── Tunables ──────────────────────────────────────────────────────────
-- Change numbers without a deploy:
--   update app_config set value = 600 where key = 'quiz_cooldown_minutes';
create table if not exists app_config (
  key   text primary key,
  value bigint not null
);

insert into app_config (key, value) values
  ('dna_cap',                1500),  -- max lifetime DNA earned (spending doesn't reset it)
  ('checkin_points',           50),  -- once per UTC day
  ('quiz_cooldown_minutes',   300),  -- 5 hours between quizzes (set 600 for 10h)
  ('quiz_seconds',             60),  -- time to answer
  ('quiz_reward',              60),  -- correct answer
  ('quiz_wrong_reward',        10),  -- answered but wrong (0 to disable)
  ('referral_points',          50),  -- paid when the referred player reaches Level 2
  ('referral_max_rewarded',    10),  -- referrals that pay out, per player
  ('fcfs_level',                3),  -- Hunter: FCFS + unlocks Reptile Rush
  ('rush_min_level',            3),  -- both players need this level to play Rush
  ('fcfs_limit',             1000),  -- 0 = no cap
  ('gtd_limit',                 0),  -- 0 = no cap. GTD comes only from winning Reptile Rush.
  ('campaign_ends_epoch',       0)   -- unix seconds; 0 = no end. Earning stops after it.
on conflict (key) do nothing;

-- ── Core tables ───────────────────────────────────────────────────────
create sequence if not exists reptilio_id_seq start 1;

create table if not exists profiles (
  id           uuid primary key references auth.users on delete cascade,
  x_user_id    text unique,
  handle       text,
  name         text,
  avatar_url   text,
  reptilio_id  text unique not null,
  level        int  not null default 1 check (level between 1 and 6),
  referred_by  uuid references profiles(id) on delete set null,
  is_admin     boolean not null default false,
  is_banned    boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists profiles_referred_by_idx on profiles (referred_by);

-- The DNA ledger. Balance = sum(amount). Every row is a fact; nothing is
-- ever updated in place. (source, ref) makes rewards idempotent: the same
-- task, check-in day, quiz attempt or referral can only ever pay once.
create table if not exists dna_ledger (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references profiles on delete cascade,
  amount      int  not null check (amount <> 0),
  kind        text not null check (kind in ('earn', 'spend', 'admin', 'reversal')),
  source      text not null,   -- task | checkin | quiz | referral | purchase | admin
  ref         text,
  description text,
  created_at  timestamptz not null default now()
);
create index if not exists dna_ledger_user_idx on dna_ledger (user_id);
create unique index if not exists dna_ledger_once
  on dna_ledger (user_id, source, ref)
  where ref is not null and kind in ('earn', 'spend');

create table if not exists items (
  key          text primary key,
  name         text not null,
  description  text not null default '',
  price        int  not null check (price >= 0),
  sort         int  not null default 0,
  purchasable  boolean not null default true,
  active       boolean not null default true
);

-- What each evolution consumes. One item per level by default; add rows
-- to make a level need several items or quantities.
create table if not exists evolution_requirements (
  target_level int  not null check (target_level between 2 and 6),
  item_key     text not null references items(key),
  quantity     int  not null default 1 check (quantity > 0),
  primary key (target_level, item_key)
);

create table if not exists inventory (
  user_id    uuid not null references profiles on delete cascade,
  item_key   text not null references items(key),
  quantity   int  not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

create table if not exists purchases (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references profiles on delete cascade,
  item_key   text not null references items(key),
  price      int  not null,   -- price at time of purchase; later price edits don't rewrite history
  created_at timestamptz not null default now()
);

create table if not exists evolution_history (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references profiles on delete cascade,
  previous_level int  not null,
  new_level      int  not null,
  consumed       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists evolution_history_user_idx on evolution_history (user_id);

create table if not exists task_catalog (
  key       text primary key,
  label     text not null,
  points    int  not null check (points >= 0),
  href      text,
  sort      int  not null default 0,
  opens_at  timestamptz,
  closes_at timestamptz,
  active    boolean not null default true
);

create table if not exists user_tasks (
  user_id      uuid not null references profiles on delete cascade,
  task_key     text not null references task_catalog(key),
  completed_at timestamptz not null default now(),
  primary key (user_id, task_key)
);

-- Quiz bank. RLS on with NO policies: the browser can never read answers.
create table if not exists quiz_questions (
  id       serial primary key,
  question text not null unique,
  options  text[] not null check (array_length(options, 1) = 4),
  answer   smallint not null check (answer between 0 and 3),
  active   boolean not null default true
);

create table if not exists quiz_attempts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles on delete cascade,
  question_id  int  not null references quiz_questions(id),
  option_order smallint[] not null,  -- shuffled per attempt; position i shows options[option_order[i]]
  started_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  answered_at  timestamptz,
  choice       smallint,             -- index into the shuffled list, null = ran out of time
  correct      boolean,
  reward       int not null default 0
);
create index if not exists quiz_attempts_user_idx on quiz_attempts (user_id, started_at desc);

create table if not exists wallets (
  user_id     uuid primary key references profiles on delete cascade,
  address     text not null unique,
  verified_at timestamptz not null default now()
);

create table if not exists wallet_challenges (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,
  address    text not null,
  message    text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists whitelist_allocations (
  id         bigint generated always as identity primary key,
  user_id    uuid not null unique references profiles on delete cascade,
  wallet     text not null unique,
  tier       text not null check (tier in ('fcfs', 'gtd')),
  number     int  not null,
  claimed_at timestamptz not null default now(),
  upgraded_at timestamptz,
  unique (tier, number)
);

-- Reptile Rush: one row per cleared match, one row per player who has won.
-- Written ONLY by rush_record_win(), which only the game server (service role) can call.
create table if not exists rush_matches (
  id          bigint generated always as identity primary key,
  room_code   text not null,
  p1          uuid not null references profiles(id) on delete cascade,
  p2          uuid not null references profiles(id) on delete cascade,
  duration_ms int  not null,
  deaths      int  not null default 0,
  finished_at timestamptz not null default now()
);

create table if not exists rush_wins (
  user_id    uuid primary key references profiles(id) on delete cascade,
  match_id   bigint not null references rush_matches(id) on delete cascade,
  partner_id uuid references profiles(id) on delete set null,
  won_at     timestamptz not null default now()
);

create table if not exists admin_audit_logs (
  id             bigint generated always as identity primary key,
  admin_id       uuid not null references profiles(id),
  target_user_id uuid references profiles(id),
  action         text not null,
  details        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

-- ── Seeds ─────────────────────────────────────────────────────────────
-- Full ladder costs 1,200 DNA. Hunter (FCFS + Reptile Rush) = 250. Levels 4–6 are bragging rights;
-- GTD comes only from clearing Reptile Rush with a partner.
insert into items (key, name, description, price, sort, purchasable) values
  ('genesis_egg',        'Genesis Egg',        'Your free starting egg. Every reptile begins here.',              0, 1, false),
  ('vitality_extract',   'Vitality Extract',   'Physical development. Cracks the egg open.',                    100, 2, true),
  ('dna_capsule',        'DNA Capsule',        'Hunter form. Unlocks FCFS and Reptile Rush.',                   150, 3, true),
  ('ancient_scale',      'Ancient Scale',      'Armoured hide. Evolves your reptile into a Predator.',          250, 4, true),
  ('mutation_core',      'Mutation Core',      'Molten genetic mutation. Unlocks the Alpha form.',              300, 5, true),
  ('evolution_catalyst', 'Evolution Catalyst', 'The rarest resource. Triggers the final Apex transformation.',  400, 6, true)
on conflict (key) do update
  set name = excluded.name, description = excluded.description, sort = excluded.sort,
      purchasable = excluded.purchasable;
-- (price deliberately not overwritten on re-run — tune it live with an UPDATE)

insert into evolution_requirements (target_level, item_key, quantity) values
  (2, 'vitality_extract',   1),
  (3, 'dna_capsule',        1),
  (4, 'ancient_scale',      1),
  (5, 'mutation_core',      1),
  (6, 'evolution_catalyst', 1)
on conflict (target_level, item_key) do nothing;

-- Like/repost/quote point at the profile until the campaign post exists; then
-- update task_catalog.href to https://x.com/reptiliorbh/status/<post id>.
insert into task_catalog (key, label, points, href, sort) values
  ('follow', 'Follow @reptiliorbh on X',          100, 'https://x.com/reptiliorbh', 1),
  ('like',   'Like the campaign post',          25, 'https://x.com/reptiliorbh', 2),
  ('repost', 'Repost the campaign post',        25, 'https://x.com/reptiliorbh', 3),
  ('quote',  'Quote the post with your Reptilio ID', 50, 'https://x.com/reptiliorbh', 4)
on conflict (key) do nothing;

-- ── Helpers (internal — not callable by clients) ──────────────────────
create or replace function cfg(k text)
returns bigint language sql stable security definer set search_path = public as $$
  select value from app_config where key = k;
$$;

create or replace function dna_balance(target uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from dna_ledger where user_id = target;
$$;

create or replace function dna_earned(target uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(sum(amount), 0)::int from dna_ledger where user_id = target and kind = 'earn';
$$;

-- Locks the player's row for the rest of the transaction so two requests
-- fired at once (double-tap, script) run one after the other and can't
-- both spend the same balance. Also rejects banned players.
create or replace function lock_player(me uuid)
returns profiles language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  if me is null then raise exception 'Sign in required'; end if;
  select * into p from profiles where id = me for update;
  if p.id is null then raise exception 'Profile not found — reload the page'; end if;
  if p.is_banned then raise exception 'This account is suspended'; end if;
  return p;
end;
$$;

create or replace function campaign_open()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(cfg('campaign_ends_epoch'), 0) = 0
      or extract(epoch from now()) < cfg('campaign_ends_epoch');
$$;

-- Pays DNA, clamped to the lifetime cap. Returns what was actually paid.
create or replace function award_dna(target uuid, amount int, src text, reference text, note text)
returns int language plpgsql security definer set search_path = public as $$
declare headroom int; actual int;
begin
  if amount <= 0 then return 0; end if;
  headroom := cfg('dna_cap')::int - dna_earned(target);
  actual := least(amount, headroom);
  if actual <= 0 then return 0; end if;
  insert into dna_ledger (user_id, amount, kind, source, ref, description)
  values (target, actual, 'earn', src, reference, note);
  return actual;
end;
$$;

create or replace function is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false);
$$;

-- Everything the app needs in one round trip.
create or replace function player_state(me uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  p           profiles;
  last_quiz   quiz_attempts;
  open_q      jsonb := null;
  today       text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
  q           quiz_questions;
begin
  select * into p from profiles where id = me;
  if p.id is null then return null; end if;

  select * into last_quiz from quiz_attempts where user_id = me order by started_at desc limit 1;
  if last_quiz.id is not null and last_quiz.answered_at is null and last_quiz.expires_at > now() then
    select * into q from quiz_questions where id = last_quiz.question_id;
    open_q := jsonb_build_object(
      'attempt_id', last_quiz.id,
      'question',   q.question,
      'options',    (select jsonb_agg(q.options[o + 1] order by ord)
                       from unnest(last_quiz.option_order) with ordinality as t(o, ord)),
      'expires_at', last_quiz.expires_at
    );
  end if;

  return jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'handle', p.handle, 'name', p.name, 'avatar_url', p.avatar_url,
      'reptilio_id', p.reptilio_id, 'level', p.level, 'is_admin', p.is_admin
    ),
    'balance', dna_balance(me),
    'earned',  dna_earned(me),
    'inventory', coalesce((select jsonb_object_agg(item_key, quantity) from inventory where user_id = me and quantity > 0), '{}'::jsonb),
    'tasks_done', coalesce((select jsonb_agg(task_key) from user_tasks where user_id = me), '[]'::jsonb),
    'checked_in_today', exists (select 1 from dna_ledger where user_id = me and source = 'checkin' and ref = today),
    'next_checkin_at', (date_trunc('day', now() at time zone 'utc') + interval '1 day') at time zone 'utc',
    'quiz', jsonb_build_object(
      'next_at', case when last_quiz.id is null then null
                      else last_quiz.started_at + make_interval(mins => cfg('quiz_cooldown_minutes')::int) end,
      'open', open_q,
      'answered', (select count(*) from quiz_attempts where user_id = me and answered_at is not null),
      'correct',  (select count(*) from quiz_attempts where user_id = me and correct)
    ),
    'wallet', (select address from wallets where user_id = me),
    'allocation', (select jsonb_build_object('tier', tier, 'number', number, 'wallet', wallet, 'claimed_at', claimed_at)
                     from whitelist_allocations where user_id = me),
    'rush', (select jsonb_build_object('won', true, 'won_at', rw.won_at, 'partner', pp.handle,
                                        'duration_ms', rm.duration_ms)
               from rush_wins rw join rush_matches rm on rm.id = rw.match_id
               left join profiles pp on pp.id = rw.partner_id
               where rw.user_id = me),
    'referrals', jsonb_build_object(
      'joined',   (select count(*) from profiles where referred_by = me),
      'rewarded', (select count(*) from dna_ledger where user_id = me and source = 'referral')
    ),
    'campaign_open', campaign_open(),
    'server_now', now(),  -- lets the browser correct for a wrong device clock (quiz timer)
    'config', (select jsonb_object_agg(key, value) from app_config)
  );
end;
$$;

-- ── Player RPCs ───────────────────────────────────────────────────────

-- Called right after sign-in. Creates the profile (with the free Genesis
-- Egg at Level 1) on first visit; refreshes X name/avatar on later visits.
-- Identity comes from auth.identities — the provider's record, which the
-- user can't edit — never from anything the browser sends.
create or replace function ensure_profile(ref_code text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  idata  jsonb;
  xid    text;
  h      text;
  nm     text;
  av     text;
  ref_id uuid;
begin
  if me is null then raise exception 'Sign in required'; end if;

  select identity_data, provider_id into idata, xid
  from auth.identities
  where user_id = me and provider in ('x', 'twitter')
  order by created_at limit 1;

  if idata is null then
    select raw_user_meta_data into idata from auth.users where id = me;
  end if;

  h  := coalesce(idata->>'user_name', idata->>'preferred_username', idata->>'screen_name', 'reptile');
  nm := coalesce(idata->>'full_name', idata->>'name', h);
  av := replace(coalesce(idata->>'avatar_url', idata->>'picture', ''), '_normal', '_400x400');
  xid := coalesce(xid, idata->>'provider_id', idata->>'sub');

  if exists (select 1 from profiles where id = me) then
    update profiles set handle = h, name = nm, avatar_url = av, updated_at = now() where id = me;
  else
    if ref_code is not null and length(trim(ref_code)) > 0 then
      select id into ref_id from profiles where reptilio_id = upper(trim(ref_code));
    end if;

    insert into profiles (id, x_user_id, handle, name, avatar_url, reptilio_id, level, referred_by)
    values (me, xid, h, nm, av,
            'RPT-' || lpad(nextval('reptilio_id_seq')::text, 5, '0'),
            1, nullif(ref_id, me));

    insert into inventory (user_id, item_key, quantity) values (me, 'genesis_egg', 1)
    on conflict do nothing;
  end if;

  return player_state(me);
end;
$$;

create or replace function get_state()
returns jsonb language sql stable security definer set search_path = public as $$
  select player_state(auth.uid());
$$;

-- Social tasks. ⚠️ Honor system: completion is not verified against the X
-- API (paid + rate-limited). Points come from the catalog, never the client.
create or replace function complete_task(task text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); t task_catalog;
begin
  perform lock_player(me);
  if not campaign_open() then raise exception 'The campaign has ended'; end if;

  select * into t from task_catalog where key = task and active;
  if t.key is null then raise exception 'Unknown task'; end if;
  if t.opens_at is not null and now() < t.opens_at then raise exception 'This task is not open yet'; end if;
  if t.closes_at is not null and now() > t.closes_at then raise exception 'This task has closed'; end if;

  insert into user_tasks (user_id, task_key) values (me, task)
  on conflict do nothing;
  if found then
    perform award_dna(me, t.points, 'task', task, t.label);
  end if;

  return player_state(me);
end;
$$;

create or replace function daily_checkin()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD'); paid int;
begin
  perform lock_player(me);
  if not campaign_open() then raise exception 'The campaign has ended'; end if;
  if exists (select 1 from dna_ledger where user_id = me and source = 'checkin' and ref = today) then
    raise exception 'Already checked in today — come back after 00:00 UTC';
  end if;
  paid := award_dna(me, cfg('checkin_points')::int, 'checkin', today, 'Daily check-in');
  if paid = 0 then raise exception 'You have reached the DNA cap'; end if;
  return jsonb_build_object('paid', paid, 'state', player_state(me));
end;
$$;

-- Starts a quiz: one random unseen question, options shuffled, clock on.
-- If one is already running, returns that one (reloading can't reroll it).
create or replace function start_quiz()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  last_a quiz_attempts;
  q      quiz_questions;
  ord    smallint[];
  new_id uuid;
begin
  perform lock_player(me);
  if not campaign_open() then raise exception 'The campaign has ended'; end if;

  select * into last_a from quiz_attempts where user_id = me order by started_at desc limit 1;

  if last_a.id is not null and last_a.answered_at is null and last_a.expires_at > now() then
    return player_state(me);  -- resume the running one
  end if;

  -- Close out any abandoned attempt as a miss.
  update quiz_attempts set answered_at = expires_at, correct = false
  where user_id = me and answered_at is null and expires_at <= now();

  if last_a.id is not null
     and last_a.started_at + make_interval(mins => cfg('quiz_cooldown_minutes')::int) > now() then
    raise exception 'Next quiz unlocks at %', to_char(
      (last_a.started_at + make_interval(mins => cfg('quiz_cooldown_minutes')::int)) at time zone 'utc', 'HH24:MI "UTC"');
  end if;

  select * into q from quiz_questions
  where active and id not in (select question_id from quiz_attempts where user_id = me)
  order by random() limit 1;
  if q.id is null then
    select * into q from quiz_questions where active order by random() limit 1;
  end if;
  if q.id is null then raise exception 'No quiz questions loaded yet'; end if;

  select array_agg(i::smallint order by random()) into ord from generate_series(0, 3) as i;

  insert into quiz_attempts (user_id, question_id, option_order, expires_at)
  values (me, q.id, ord, now() + make_interval(secs => cfg('quiz_seconds')::int))
  returning id into new_id;

  return player_state(me);
end;
$$;

-- choice = index in the shuffled list the player saw; null = time ran out.
create or replace function answer_quiz(attempt uuid, choice smallint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me       uuid := auth.uid();
  a        quiz_attempts;
  q        quiz_questions;
  picked   smallint := choice;
  is_right boolean;
  pay      int := 0;
  right_ix int;
begin
  perform lock_player(me);
  select * into a from quiz_attempts where id = attempt and user_id = me for update;
  if a.id is null then raise exception 'Quiz not found'; end if;
  if a.answered_at is not null then raise exception 'Already answered'; end if;

  -- 3s grace for network latency; anything later counts as time's up.
  if now() > a.expires_at + interval '3 seconds' then picked := null; end if;
  if picked is not null and (picked < 0 or picked > 3) then raise exception 'Invalid choice'; end if;

  select * into q from quiz_questions where id = a.question_id;
  is_right := picked is not null and a.option_order[picked + 1] = q.answer;
  right_ix := array_position(a.option_order, q.answer) - 1;

  if is_right then
    pay := award_dna(me, cfg('quiz_reward')::int, 'quiz', a.id::text, 'Quiz — correct');
  elsif picked is not null then
    pay := award_dna(me, cfg('quiz_wrong_reward')::int, 'quiz', a.id::text, 'Quiz — attempted');
  end if;

  update quiz_attempts
  set answered_at = now(), choice = picked, correct = is_right, reward = pay
  where id = a.id;

  return jsonb_build_object(
    'correct', is_right, 'correct_choice', right_ix, 'choice', picked,
    'reward', pay, 'timed_out', picked is null,
    'state', player_state(me)
  );
end;
$$;

-- Buy one unit of an item. Only items the NEXT evolution needs can be
-- bought, and only up to the quantity it needs — no wasted DNA.
create or replace function purchase_item(item text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    uuid := auth.uid();
  p     profiles;
  it    items;
  need  int;
  have  int;
  bal   int;
  pid   bigint;
begin
  p := lock_player(me);
  select * into it from items where key = item and active;
  if it.key is null or not it.purchasable then raise exception 'That item is not for sale'; end if;
  if p.level >= 6 then raise exception 'You are already Apex'; end if;

  select quantity into need from evolution_requirements where target_level = p.level + 1 and item_key = item;
  if need is null then raise exception '% is not needed for your next evolution', it.name; end if;
  select coalesce((select quantity from inventory where user_id = me and item_key = item), 0) into have;
  if have >= need then raise exception 'You already have the % you need — evolve!', it.name; end if;

  bal := dna_balance(me);
  if bal < it.price then raise exception 'Not enough DNA: have %, need %', bal, it.price; end if;

  insert into purchases (user_id, item_key, price) values (me, item, it.price) returning id into pid;
  insert into dna_ledger (user_id, amount, kind, source, ref, description)
  values (me, -it.price, 'spend', 'purchase', pid::text, it.name);
  insert into inventory (user_id, item_key, quantity) values (me, item, 1)
  on conflict (user_id, item_key) do update set quantity = inventory.quantity + 1, updated_at = now();

  return player_state(me);
end;
$$;

-- Consume the next level's requirements and level up — all or nothing.
create or replace function evolve()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me        uuid := auth.uid();
  p         profiles;
  r         record;
  used      jsonb := '{}'::jsonb;
  new_level int;
  n_reqs    int;
  rewarded  int;
begin
  p := lock_player(me);
  if p.level >= 6 then raise exception 'You are already Apex'; end if;
  new_level := p.level + 1;

  select count(*) into n_reqs from evolution_requirements where target_level = new_level;
  if n_reqs = 0 then raise exception 'Level % has no requirements configured', new_level; end if;

  for r in
    select er.item_key, er.quantity, coalesce(i.quantity, 0) as have, it.name
    from evolution_requirements er
    join items it on it.key = er.item_key
    left join inventory i on i.user_id = me and i.item_key = er.item_key
    where er.target_level = new_level
  loop
    if r.have < r.quantity then
      raise exception 'Missing % (need %, have %)', r.name, r.quantity, r.have;
    end if;
    update inventory set quantity = quantity - r.quantity, updated_at = now()
    where user_id = me and item_key = r.item_key;
    used := used || jsonb_build_object(r.item_key, r.quantity);
  end loop;

  update profiles set level = new_level, updated_at = now() where id = me;
  insert into evolution_history (user_id, previous_level, new_level, consumed)
  values (me, p.level, new_level, used);

  -- A referral only pays once the referred player has actually played:
  -- earned DNA and completed their first evolution.
  if new_level = 2 and p.referred_by is not null then
    select count(*) into rewarded from dna_ledger where user_id = p.referred_by and source = 'referral';
    if rewarded < cfg('referral_max_rewarded') then
      perform award_dna(p.referred_by, cfg('referral_points')::int, 'referral', me::text, 'Referral reached Juvenile');
    end if;
  end if;

  return jsonb_build_object('new_level', new_level, 'state', player_state(me));
end;
$$;

-- Step 1 of wallet verification: a single-use, 10-minute message to sign.
-- Step 2 is the verify-wallet Edge Function (signature check needs secp256k1,
-- which Postgres doesn't do), which then calls link_verified_wallet().
create or replace function create_wallet_challenge(addr text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); p profiles; msg text; cid uuid; norm text := lower(trim(addr)); exp timestamptz := now() + interval '10 minutes';
begin
  p := lock_player(me);
  if norm !~ '^0x[0-9a-f]{40}$' then raise exception 'That is not a valid EVM address'; end if;
  if exists (select 1 from wallets where address = norm and user_id <> me) then
    raise exception 'That wallet is already linked to another player';
  end if;

  msg := 'Reptilio wallet verification' || E'\n\n'
      || 'I own this wallet and want it linked to my Reptilio account.' || E'\n\n'
      || 'X: @' || p.handle || E'\n'
      || 'Reptilio ID: ' || p.reptilio_id || E'\n'
      || 'Wallet: ' || norm || E'\n'
      || 'Nonce: ' || replace(gen_random_uuid()::text, '-', '') || E'\n'
      || 'Expires: ' || to_char(exp at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS "UTC"') || E'\n\n'
      || 'This signature is free and does not send a transaction.';

  insert into wallet_challenges (user_id, address, message, expires_at)
  values (me, norm, msg, exp) returning id into cid;

  return jsonb_build_object('challenge_id', cid, 'message', msg);
end;
$$;

-- Service role only (the Edge Function), after it has verified the signature.
create or replace function link_verified_wallet(challenge uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c wallet_challenges;
begin
  select * into c from wallet_challenges where id = challenge for update;
  if c.id is null then raise exception 'Unknown challenge'; end if;
  if c.used_at is not null then raise exception 'Challenge already used'; end if;
  if c.expires_at < now() then raise exception 'Challenge expired — try again'; end if;

  perform lock_player(c.user_id);
  if exists (select 1 from whitelist_allocations where user_id = c.user_id and wallet <> c.address) then
    raise exception 'Your whitelist spot is already locked to a different wallet';
  end if;
  if exists (select 1 from wallets where address = c.address and user_id <> c.user_id) then
    raise exception 'That wallet is already linked to another player';
  end if;

  update wallet_challenges set used_at = now() where id = c.id;
  insert into wallets (user_id, address) values (c.user_id, c.address)
  on conflict (user_id) do update set address = excluded.address, verified_at = now();

  return jsonb_build_object('address', c.address);
end;
$$;

-- FCFS at Hunter (Level 3). GTD only for Reptile Rush winners. Separate
-- pools, atomic, optional caps (0 = none). A player holding FCFS who wins
-- Rush calls this again to upgrade: the FCFS slot is released in the same
-- transaction.
create or replace function claim_whitelist()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me     uuid := auth.uid();
  p      profiles;
  w      text;
  cur    whitelist_allocations;
  want   text;
  lim    int;
  taken  int;
  num    int;
begin
  p := lock_player(me);
  select address into w from wallets where user_id = me;
  if w is null then raise exception 'Verify a wallet first'; end if;

  if exists (select 1 from rush_wins where user_id = me) then want := 'gtd';
  elsif p.level >= cfg('fcfs_level') then want := 'fcfs';
  else raise exception 'Reach Level % (Hunter) to unlock the whitelist', cfg('fcfs_level');
  end if;

  select * into cur from whitelist_allocations where user_id = me;
  if cur.id is not null and (cur.tier = want or cur.tier = 'gtd') then
    return player_state(me);  -- nothing to do
  end if;

  -- One claim at a time per pool, so the cap can never be overshot.
  perform pg_advisory_xact_lock(hashtext('reptilio_wl_' || want));
  lim := cfg(want || '_limit')::int;
  select count(*), coalesce(max(number), 0) + 1 into taken, num from whitelist_allocations where tier = want;
  if lim > 0 and taken >= lim then
    raise exception 'All % % spots are taken', lim, upper(want);
  end if;

  if cur.id is not null then
    update whitelist_allocations set tier = want, number = num, upgraded_at = now() where id = cur.id;
  else
    insert into whitelist_allocations (user_id, wallet, tier, number) values (me, w, want, num);
  end if;

  return player_state(me);
end;
$$;

-- ── Reptile Rush (game server only — service role) ────────────────────
-- What the game server needs to seat a player. Never callable from browsers.
create or replace function rush_player(uid uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p.id, 'handle', p.handle, 'avatar_url', coalesce(p.avatar_url, ''), 'reptilio_id', p.reptilio_id,
    'level', p.level, 'banned', p.is_banned,
    'won', exists (select 1 from rush_wins where user_id = p.id),
    'min_level', cfg('rush_min_level')
  )
  from profiles p where p.id = uid;
$$;

-- Called by the game server when its simulation sees both players in the
-- exit. Re-checks eligibility here too; each player can only win once.
create or replace function rush_record_win(room text, p1 uuid, p2 uuid, duration_ms int, deaths int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  a profiles; b profiles; mid bigint; fresh uuid[] := '{}';
begin
  if p1 = p2 then raise exception 'A duo needs two different players'; end if;
  if not campaign_open() then raise exception 'The campaign has ended'; end if;
  -- lock in a fixed order so two simultaneous results can't deadlock
  if p1 < p2 then a := lock_player(p1); b := lock_player(p2);
  else b := lock_player(p2); a := lock_player(p1); end if;
  if a.level < cfg('rush_min_level') or b.level < cfg('rush_min_level') then
    raise exception 'Both players must be Level %', cfg('rush_min_level');
  end if;

  insert into rush_matches (room_code, p1, p2, duration_ms, deaths)
  values (room, p1, p2, greatest(duration_ms, 0), greatest(deaths, 0)) returning id into mid;

  insert into rush_wins (user_id, match_id, partner_id) values (p1, mid, p2) on conflict do nothing;
  if found then fresh := fresh || p1; end if;
  insert into rush_wins (user_id, match_id, partner_id) values (p2, mid, p1) on conflict do nothing;
  if found then fresh := fresh || p2; end if;

  return jsonb_build_object('match_id', mid, 'new_winners', to_jsonb(fresh));
end;
$$;

-- ── Public reads ──────────────────────────────────────────────────────
create or replace function get_leaderboard(lim int default 50)
returns table (
  rank int, handle text, avatar_url text, reptilio_id text, level int,
  earned int, referrals int, reached_at timestamptz
) language sql stable security definer set search_path = public as $$
  select
    (row_number() over (order by p.level desc, coalesce(e.reached, p.created_at) asc))::int,
    p.handle, p.avatar_url, p.reptilio_id, p.level,
    dna_earned(p.id),
    (select count(*) from dna_ledger d where d.user_id = p.id and d.source = 'referral')::int,
    coalesce(e.reached, p.created_at)
  from profiles p
  left join lateral (select max(created_at) as reached from evolution_history where user_id = p.id) e on true
  where not p.is_banned
  order by p.level desc, coalesce(e.reached, p.created_at) asc
  limit least(greatest(lim, 1), 200);
$$;

create or replace function get_campaign_stats()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'players',    (select count(*) from profiles where not is_banned),
    'by_level',   (select coalesce(jsonb_object_agg(level, n), '{}'::jsonb)
                     from (select level, count(*) n from profiles where not is_banned group by level) s),
    'fcfs_taken', (select count(*) from whitelist_allocations where tier = 'fcfs'),
    'gtd_taken',  (select count(*) from whitelist_allocations where tier = 'gtd'),
    'fcfs_limit', cfg('fcfs_limit'),
    'gtd_limit',  cfg('gtd_limit'),
    'rush_winners', (select count(*) from rush_wins),
    'rush_matches', (select count(*) from rush_matches),
    'campaign_ends_epoch', cfg('campaign_ends_epoch')
  );
$$;

-- ── Admin RPCs (run from the SQL editor, or wire up an admin page later) ──
-- Bootstrap your first admin by hand:
--   update profiles set is_admin = true where handle = 'yourhandle';

create or replace function admin_adjust_dna(target uuid, amount int, reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  if reason is null or length(trim(reason)) = 0 then raise exception 'A reason is required'; end if;
  perform lock_player(target);
  insert into dna_ledger (user_id, amount, kind, source, description) values (target, amount, 'admin', 'admin', reason);
  insert into admin_audit_logs (admin_id, target_user_id, action, details)
  values (auth.uid(), target, 'adjust_dna', jsonb_build_object('amount', amount, 'reason', reason));
end;
$$;

create or replace function admin_set_banned(target uuid, banned boolean, reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  update profiles set is_banned = banned, updated_at = now() where id = target;
  insert into admin_audit_logs (admin_id, target_user_id, action, details)
  values (auth.uid(), target, case when banned then 'ban' else 'unban' end, jsonb_build_object('reason', reason));
end;
$$;

create or replace function admin_revoke_allocation(target uuid, reason text)
returns void language plpgsql security definer set search_path = public as $$
declare old whitelist_allocations;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  delete from whitelist_allocations where user_id = target returning * into old;
  insert into admin_audit_logs (admin_id, target_user_id, action, details)
  values (auth.uid(), target, 'revoke_allocation', jsonb_build_object('reason', reason, 'allocation', to_jsonb(old)));
end;
$$;

create or replace function admin_set_config(k text, v bigint)
returns void language plpgsql security definer set search_path = public as $$
declare old bigint;
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  select value into old from app_config where key = k;
  if old is null then raise exception 'Unknown config key %', k; end if;
  update app_config set value = v where key = k;
  insert into admin_audit_logs (admin_id, action, details)
  values (auth.uid(), 'set_config', jsonb_build_object('key', k, 'from', old, 'to', v));
end;
$$;

create or replace function admin_export_whitelist()
returns table (tier text, number int, wallet text, handle text, reptilio_id text, level int, claimed_at timestamptz)
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'Admins only'; end if;
  return query
    select w.tier, w.number, w.wallet, p.handle, p.reptilio_id, p.level, w.claimed_at
    from whitelist_allocations w join profiles p on p.id = w.user_id
    order by w.tier desc, w.number;
end;
$$;

-- ── Permissions ───────────────────────────────────────────────────────
-- Postgres grants EXECUTE to PUBLIC on new functions by default. Internal
-- helpers must not be callable from the browser — award_dna() in particular
-- would otherwise let anyone mint DNA.
revoke execute on function cfg(text)                             from public, anon, authenticated;
revoke execute on function dna_balance(uuid)                     from public, anon, authenticated;
revoke execute on function dna_earned(uuid)                      from public, anon, authenticated;
revoke execute on function lock_player(uuid)                     from public, anon, authenticated;
revoke execute on function campaign_open()                       from public, anon, authenticated;
revoke execute on function award_dna(uuid, int, text, text, text) from public, anon, authenticated;
revoke execute on function is_admin()                            from public, anon, authenticated;
revoke execute on function player_state(uuid)                    from public, anon, authenticated;
revoke execute on function link_verified_wallet(uuid)            from public, anon, authenticated;
revoke execute on function rush_player(uuid)                     from public, anon, authenticated;
revoke execute on function rush_record_win(text, uuid, uuid, int, int) from public, anon, authenticated;

grant execute on function ensure_profile(text)        to authenticated;
grant execute on function get_state()                 to authenticated;
grant execute on function complete_task(text)         to authenticated;
grant execute on function daily_checkin()             to authenticated;
grant execute on function start_quiz()                to authenticated;
grant execute on function answer_quiz(uuid, smallint) to authenticated;
grant execute on function purchase_item(text)         to authenticated;
grant execute on function evolve()                    to authenticated;
grant execute on function create_wallet_challenge(text) to authenticated;
grant execute on function claim_whitelist()           to authenticated;
grant execute on function get_leaderboard(int)        to anon, authenticated;
grant execute on function get_campaign_stats()        to anon, authenticated;
grant execute on function admin_adjust_dna(uuid, int, text)      to authenticated;
grant execute on function admin_set_banned(uuid, boolean, text)  to authenticated;
grant execute on function admin_revoke_allocation(uuid, text)    to authenticated;
grant execute on function admin_set_config(text, bigint)         to authenticated;
grant execute on function admin_export_whitelist()               to authenticated;
grant execute on function link_verified_wallet(uuid)  to service_role;
grant execute on function rush_player(uuid)           to service_role;
grant execute on function rush_record_win(text, uuid, uuid, int, int) to service_role;

-- Row Level Security: reads only. No table has an insert/update/delete
-- policy, so the only way to change anything is through the RPCs above.
alter table app_config             enable row level security;
alter table profiles               enable row level security;
alter table dna_ledger             enable row level security;
alter table items                  enable row level security;
alter table evolution_requirements enable row level security;
alter table inventory              enable row level security;
alter table purchases              enable row level security;
alter table evolution_history      enable row level security;
alter table task_catalog           enable row level security;
alter table user_tasks             enable row level security;
alter table quiz_questions         enable row level security;  -- no policy at all: answers stay secret
alter table quiz_attempts          enable row level security;
alter table wallets                enable row level security;
alter table wallet_challenges      enable row level security;
alter table whitelist_allocations  enable row level security;
alter table admin_audit_logs       enable row level security;
alter table rush_matches           enable row level security;  -- no client policy
alter table rush_wins              enable row level security;

drop policy if exists "read config"       on app_config;             create policy "read config"       on app_config             for select using (true);
drop policy if exists "read items"        on items;                  create policy "read items"        on items                  for select using (active);
drop policy if exists "read requirements" on evolution_requirements; create policy "read requirements" on evolution_requirements for select using (true);
drop policy if exists "read tasks"        on task_catalog;           create policy "read tasks"        on task_catalog           for select using (active);
drop policy if exists "own profile"       on profiles;               create policy "own profile"       on profiles               for select using (auth.uid() = id);
drop policy if exists "own ledger"        on dna_ledger;             create policy "own ledger"        on dna_ledger             for select using (auth.uid() = user_id);
drop policy if exists "own inventory"     on inventory;              create policy "own inventory"     on inventory              for select using (auth.uid() = user_id);
drop policy if exists "own purchases"     on purchases;              create policy "own purchases"     on purchases              for select using (auth.uid() = user_id);
drop policy if exists "own evolutions"    on evolution_history;      create policy "own evolutions"    on evolution_history      for select using (auth.uid() = user_id);
drop policy if exists "own user tasks"    on user_tasks;             create policy "own user tasks"    on user_tasks             for select using (auth.uid() = user_id);
drop policy if exists "own wallet"        on wallets;                create policy "own wallet"        on wallets                for select using (auth.uid() = user_id);
drop policy if exists "own allocation"    on whitelist_allocations;  create policy "own allocation"    on whitelist_allocations  for select using (auth.uid() = user_id);
drop policy if exists "own rush win"      on rush_wins;              create policy "own rush win"      on rush_wins              for select using (auth.uid() = user_id);
-- quiz_attempts, wallet_challenges, admin_audit_logs: no client policy.
