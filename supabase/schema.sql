-- Run this once in your Supabase project's SQL Editor (Dashboard -> SQL Editor -> New query).
-- It creates one table that stores each signed-in user's entire board as JSON, and locks it
-- down so a user can only ever read or write their own row.

create table if not exists public.boards (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.boards enable row level security;

create policy "Users can read their own board"
  on public.boards for select
  using (auth.uid() = user_id);

create policy "Users can insert their own board"
  on public.boards for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own board"
  on public.boards for update
  using (auth.uid() = user_id);

-- Optional but recommended: let the app's live "second device updates in real time"
-- feature receive change events for this table.
alter publication supabase_realtime add table public.boards;
