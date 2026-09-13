-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL Editor -> New query).
-- It creates:
--   1. boards      -- each signed-in user's entire board as JSON (unchanged from before)
--   2. usernames   -- a public, unique-per-user display name (no email, no trial data)
--   3. profiles    -- private per-user trial/payment status
--   4. RLS policies so a user can only ever read/write their own rows, and so writes to
--      `boards` are blocked once a user's trial has expired and they haven't paid --
--      giving the "view-only after trial" behavior at the database level, not just in
--      the UI (so it can't be bypassed by editing client-side JS).

create table if not exists public.boards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;

-- ---------- usernames (public, for the "pick a unique username" requirement) ----------
create table if not exists public.usernames (
  username_lower text primary key,        -- enforces case-insensitive uniqueness
  username text not null,                 -- the display casing the user actually chose
  user_id uuid not null unique references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.usernames enable row level security;

drop policy if exists "Anyone can check username availability" on public.usernames;
drop policy if exists "A user can claim their own username" on public.usernames;

create policy "Anyone can check username availability"
  on public.usernames for select
  using (true);

create policy "A user can claim their own username"
  on public.usernames for insert
  with check (auth.uid() = user_id);

-- ---------- profiles (private, holds the trial clock) ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  trial_ends_at timestamptz not null default (now() + interval '30 days'),
  is_paid boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;

create policy "Users can read their own profile"
  on public.profiles for select
  using (auth.uid() = user_id);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = user_id);

-- ---------- helper: is this user still allowed to write? ----------
create or replace function public.trial_active(uid uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select is_paid or trial_ends_at > now() from public.profiles where user_id = uid),
    false
  );
$$;

-- ---------- boards policies (reads always allowed; writes gated by the trial) ----------
-- Drop-and-recreate so this script is safe to re-run on a project that already has the
-- older (pre-trial) policies from an earlier version of this file.
drop policy if exists "Users can read their own board" on public.boards;
drop policy if exists "Users can insert their own board" on public.boards;
drop policy if exists "Users can update their own board" on public.boards;
drop policy if exists "Users can insert their own board while trial is active" on public.boards;
drop policy if exists "Users can update their own board while trial is active" on public.boards;

create policy "Users can read their own board"
  on public.boards for select
  using (auth.uid() = user_id);

create policy "Users can insert their own board while trial is active"
  on public.boards for insert
  with check (auth.uid() = user_id and public.trial_active(auth.uid()));

create policy "Users can update their own board while trial is active"
  on public.boards for update
  using (auth.uid() = user_id and public.trial_active(auth.uid()));

-- Let the app's live "second device updates in real time" feature receive change events.
alter publication supabase_realtime add table public.boards;
