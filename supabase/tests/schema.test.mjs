// Runs schema.sql + quiz_questions.sql in an in-process Postgres (PGlite) with a
// minimal Supabase auth mock, then plays through the rules.  npm run test:db
import { PGlite } from "@electric-sql/pglite";
import fs from "fs";

const db = new PGlite();
const R = new URL("../", import.meta.url).pathname; // supabase/

// Minimal Supabase stand-ins: roles, auth.users, auth.identities, auth.uid()
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth;
  create table auth.users (id uuid primary key, raw_user_meta_data jsonb default '{}');
  create table auth.identities (user_id uuid, provider text, provider_id text, identity_data jsonb, created_at timestamptz default now());
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
`);
await db.exec(fs.readFileSync(R + "schema.sql", "utf8"));
await db.exec(fs.readFileSync(R + "quiz_questions.sql", "utf8"));
await db.exec(`grant select on all tables in schema public to anon, authenticated;
               grant insert, update, delete on all tables in schema public to authenticated;`); // Supabase default grants; RLS must still block writes

const ids = { A: "00000000-0000-0000-0000-00000000000a", B: "00000000-0000-0000-0000-00000000000b", C: "00000000-0000-0000-0000-00000000000c" };
for (const [k, id] of Object.entries(ids)) {
  await db.query(`insert into auth.users (id) values ($1)`, [id]);
  await db.query(`insert into auth.identities values ($1,'x',$2,$3)`, [id, "x" + k, { user_name: "player" + k, full_name: "Player " + k, avatar_url: "https://pbs.twimg.com/a_normal.jpg" }]);
}

let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ✓ " : "  ✗ ") + m); };

async function as(who, sql, params = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${who ? ids[who] : ""}', false);`);
  await db.exec(`set role authenticated`);
  try { const r = await db.query(sql, params); return r.rows; }
  finally { await db.exec(`reset role`); }
}
async function err(who, sql, params = []) {
  try { await as(who, sql, params); return null; } catch (e) { return e.message; }
}
const sup = async (sql, p = []) => (await db.query(sql, p)).rows;
const st = async (w) => (await as(w, `select get_state() s`))[0].s;

console.log("Profiles");
let s = (await as("A", `select ensure_profile(null) s`))[0].s;
ok(s.profile.reptilio_id === "RPT-00001" && s.profile.level === 1 && s.inventory.genesis_egg === 1, "A created at L1 with Genesis Egg, RPT-00001");
ok(s.profile.avatar_url.includes("_400x400"), "avatar upsized");
s = (await as("B", `select ensure_profile('rpt-00001') s`))[0].s;
ok((await sup(`select referred_by from profiles where id=$1`, [ids.B]))[0].referred_by === ids.A, "B referred by A");
await as("A", `select ensure_profile('RPT-00001')`); // self-ref on re-login does nothing
ok((await sup(`select referred_by from profiles where id=$1`, [ids.A]))[0].referred_by === null, "no self-referral");

console.log("Earning");
for (const t of ["follow", "like", "repost", "quote"]) await as("B", `select complete_task($1)`, [t]);
await as("B", `select complete_task('follow')`);
ok((await st("B")).balance === 200, "4 tasks = 200 DNA, repeat pays nothing");
const ci = (await as("B", `select daily_checkin() r`))[0].r;
ok(ci.paid === 50 && ci.state.checked_in_today, "check-in +50");
ok(/Already checked in/.test(await err("B", `select daily_checkin()`)), "second check-in rejected");

console.log("Market + evolution");
ok(/not needed/.test(await err("B", `select purchase_item('dna_capsule')`)), "can't buy items for later levels");
ok(/not for sale/.test(await err("B", `select purchase_item('genesis_egg')`)), "egg not for sale");
s = (await as("B", `select purchase_item('vitality_extract') s`))[0].s;
ok(s.balance === 150 && s.inventory.vitality_extract === 1, "bought Vitality Extract (-100)");
ok(/already have/.test(await err("B", `select purchase_item('vitality_extract')`)), "can't double-buy");
let ev = (await as("B", `select evolve() r`))[0].r;
ok(ev.new_level === 2 && !ev.state.inventory.vitality_extract, "evolved to L2, item consumed");
ok((await st("A")).balance === 50, "A paid 50 referral when B hit L2");
ok(/Missing/.test(await err("B", `select evolve()`)), "can't evolve without next item");

console.log("Quiz");
s = (await as("B", `select start_quiz() s`))[0].s;
const open = s.quiz.open;
ok(open && open.options.length === 4 && !("answer" in open), "quiz started, 4 options, no answer leaked");
ok((await as("B", `select count(*)::int n from quiz_questions`))[0].n === 0, "quiz_questions unreadable by players");
const s2 = (await as("B", `select start_quiz() s`))[0].s;
ok(s2.quiz.open.attempt_id === open.attempt_id, "restart returns same running quiz (no reroll)");
const [{ answer, options, option_order }] = await sup(
  `select q.answer, q.options, a.option_order from quiz_attempts a join quiz_questions q on q.id=a.question_id where a.id=$1`, [open.attempt_id]);
const rightIx = option_order.indexOf(answer);
ok(open.options[rightIx] === options[answer], "shuffle maps correctly");
let ans = (await as("B", `select answer_quiz($1, $2::smallint) r`, [open.attempt_id, rightIx]))[0].r;
ok(ans.correct && ans.reward === 60 && ans.correct_choice === rightIx, "correct answer +60");
ok(/Already answered/.test(await err("B", `select answer_quiz($1, 0::smallint)`, [open.attempt_id])), "can't answer twice");
ok(/Next quiz unlocks/.test(await err("B", `select start_quiz()`)), "5h cooldown enforced");
await sup(`update quiz_attempts set started_at = started_at - interval '6 hours', expires_at = expires_at - interval '6 hours' where user_id=$1`, [ids.B]);
s = (await as("B", `select start_quiz() s`))[0].s;
ok(s.quiz.open && s.quiz.open.attempt_id !== open.attempt_id, "new quiz after cooldown, different question");
const a2 = s.quiz.open.attempt_id;
const [{ answer: an2, option_order: oo2 }] = await sup(`select q.answer, a.option_order from quiz_attempts a join quiz_questions q on q.id=a.question_id where a.id=$1`, [a2]);
const wrong = [0, 1, 2, 3].find((i) => i !== oo2.indexOf(an2));
ans = (await as("B", `select answer_quiz($1, $2::smallint) r`, [a2, wrong]))[0].r;
ok(!ans.correct && ans.reward === 10, "wrong answer +10");
await sup(`update quiz_attempts set started_at = started_at - interval '6 hours', expires_at = now() - interval '10 seconds' where user_id=$1`, [ids.B]);
await sup(`update quiz_attempts set answered_at=null, correct=null where id=$1`, [a2]); // fake an un-answered, expired attempt
ans = (await as("B", `select answer_quiz($1, $2::smallint) r`, [a2, 0]))[0].r;
ok(ans.timed_out && ans.reward === 0, "late answer = time's up, 0 DNA");

console.log("Security");
ok(!!(await err("B", `insert into dna_ledger (user_id, amount, kind, source) values ($1, 9999, 'earn', 'hack')`, [ids.B])), "direct ledger insert blocked");
ok(!!(await err("B", `update profiles set level = 6 where id = $1`, [ids.B])) || (await sup(`select level from profiles where id=$1`, [ids.B]))[0].level === 2, "direct level update blocked");
ok(/permission denied/.test(await err("B", `select award_dna($1, 9999, 'x', 'y', 'z')`, [ids.B])), "award_dna not callable");
ok(/permission denied/.test(await err("B", `select player_state($1)`, [ids.A])), "can't read others' state");
ok(/permission denied/.test(await err("B", `select link_verified_wallet(gen_random_uuid())`)), "link_verified_wallet service-only");
ok(/Admins only/.test(await err("B", `select admin_adjust_dna($1, 5000, 'gift')`, [ids.B])), "admin fns need admin");
ok((await as("B", `select count(*)::int n from profiles`))[0].n === 1, "profiles: only own row visible");

console.log("Whitelist");
await sup(`update profiles set is_admin = true where id=$1`, [ids.A]);
await as("A", `select admin_adjust_dna($1, 2000, 'test grant')`, [ids.B]);
ok((await sup(`select count(*)::int n from admin_audit_logs`))[0].n === 1, "admin action audited");
for (const [item] of [["dna_capsule"], ["ancient_scale"]]) { await as("B", `select purchase_item($1)`, [item]); await as("B", `select evolve()`); }
ok((await st("B")).profile.level === 4, "B reached Predator");
ok(/Verify a wallet/.test(await err("B", `select claim_whitelist()`)), "claim needs verified wallet");
ok(/valid EVM/.test(await err("B", `select create_wallet_challenge('0x123')`)), "bad address rejected");
const ch = (await as("B", `select create_wallet_challenge('0xAbCdEf0123456789abcdef0123456789ABCDEF01') r`))[0].r;
ok(ch.message.includes("RPT-00002") && ch.message.includes("0xabcdef0123456789abcdef0123456789abcdef01"), "challenge message ok");
await db.exec(`set role service_role`); await db.query(`select link_verified_wallet($1)`, [ch.challenge_id]); await db.exec(`reset role`);
let e = null; try { await db.query(`select link_verified_wallet($1)`, [ch.challenge_id]); } catch (x) { e = x.message; }
ok(/already used/.test(e), "challenge single-use");
s = (await as("B", `select claim_whitelist() s`))[0].s;
ok(s.allocation.tier === "fcfs" && s.allocation.number === 1, "FCFS #1 claimed");
for (const item of ["mutation_core", "evolution_catalyst"]) { await as("B", `select purchase_item($1)`, [item]); await as("B", `select evolve()`); }
s = (await as("B", `select claim_whitelist() s`))[0].s;
ok(s.profile.level === 6 && s.allocation.tier === "gtd" && s.allocation.number === 1, "Apex upgrade → GTD #1, FCFS released");
ok((await sup(`select count(*)::int n from whitelist_allocations where tier='fcfs'`))[0].n === 0, "FCFS pool freed");
ok(/already Apex/.test(await err("B", `select evolve()`)), "no level 7");
// C: blocked from reusing B's wallet
await as("C", `select ensure_profile(null)`);
ok(/already linked/.test(await err("C", `select create_wallet_challenge('0xabcdef0123456789abcdef0123456789abcdef01')`)), "wallet can't be shared");
// pool cap
await sup(`update app_config set value = 0 where key='fcfs_limit'`);
await sup(`update profiles set level = 4 where id=$1`, [ids.C]);
const ch2 = (await as("C", `select create_wallet_challenge('0x1111111111111111111111111111111111111111') r`))[0].r;
await db.query(`select link_verified_wallet($1)`, [ch2.challenge_id]);
ok(/spots are taken/.test(await err("C", `select claim_whitelist()`)), "FCFS cap enforced");

console.log("Cap + campaign end");
await sup(`update app_config set value = extract(epoch from now())::bigint - 10 where key='campaign_ends_epoch'`);
ok(/ended/.test(await err("C", `select daily_checkin()`)), "earning stops after campaign end");

console.log("Public reads");
const lb = await as(null, `select * from get_leaderboard(10)`);
ok(lb[0].handle === "playerB" && lb[0].level === 6, "leaderboard: Apex first");
const stats = (await as(null, `select get_campaign_stats() s`))[0].s;
ok(stats.players === 3 && stats.gtd_taken === 1, "stats ok");
ok((await sup(`select count(*)::int n from quiz_questions`))[0].n >= 60, "quiz bank loaded: " + (await sup(`select count(*)::int n from quiz_questions`))[0].n);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
