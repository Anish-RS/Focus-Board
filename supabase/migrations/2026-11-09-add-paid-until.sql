-- Run this in Supabase -> SQL Editor if your project was created from an earlier
-- schema.sql. It is idempotent, so running it twice is harmless.
--
-- WHY THIS EXISTS
-- The app has always read a `paid_until` column (js/sync.js -> fetchProfile selects it,
-- getTrialStatus counts down to it) but schema.sql never created it and no server
-- function ever wrote it. Two consequences:
--
--   1. If the column doesn't exist in your database, that `select` returns a 400 from
--      PostgREST. sync.js treats any profile-fetch error as "load failed", so every
--      signed-in user lands in the "Couldn't load your account" / view-only state.
--      That is the single most damaging bug in the current build -- apply this migration
--      before anything else.
--   2. Even once the column exists, it stays null, so the header can never show
--      "Full access - N days left" and a cancelled-at-cycle-end subscription loses access
--      the moment the webhook fires instead of at the end of the paid period.
--
-- The webhook / verification / reconciliation functions now populate it from Razorpay's
-- `current_end` (the end of the cycle that was actually paid for).

alter table public.profiles add column if not exists paid_until timestamptz;

-- Existing paid accounts: give them a month of credit from now so the UI shows something
-- sensible until the next renewal webhook supplies a real value.
update public.profiles
set paid_until = now() + interval '30 days'
where is_paid = true
  and paid_until is null;

-- Keep the column consistent with is_paid for accounts that were never paid.
update public.profiles
set paid_until = null
where is_paid = false
  and paid_until is not null
  and paid_until < now();

-- Sanity check: should list exactly one row per paid account.
select user_id, is_paid, trial_ends_at, paid_until from public.profiles order by is_paid desc;
