-- Reptile Rush rollout — for a database that already ran the original schema.sql.
-- 1) Re-run supabase/schema.sql (adds the Rush tables/functions; safe to re-run).
-- 2) Then run this file once: it updates config values that schema.sql
--    deliberately never overwrites on re-run.

update app_config set value = 3 where key = 'fcfs_level';   -- FCFS at Hunter
update app_config set value = 0 where key = 'gtd_limit';    -- no GTD cap
insert into app_config (key, value) values ('rush_min_level', 3) on conflict (key) do update set value = excluded.value;
delete from app_config where key = 'gtd_level';             -- Apex no longer grants GTD
update items set description = 'Hunter form. Unlocks FCFS and Reptile Rush.' where key = 'dna_capsule';
