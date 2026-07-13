-- ORBIT — add the pg_servers table to an already-deployed project.
-- Safe to run against the live DB, and safe to RE-run: every statement is
-- idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS before every CREATE).
-- For a brand-new project, supabase/schema.sql already includes all of this
-- — you don't need this file too.
--
-- Moves saved Postgres connections (the "machines" on the Postgres tab) from
-- the local agent's pg-config.json into Supabase, scoped per user via RLS —
-- same trust model as the existing `integrations` table (Zoho/Gmail keys):
-- plaintext columns, RLS is the only gate. The local agent no longer stores
-- servers itself; the browser hands it connection details per request.

create table if not exists public.pg_servers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  host text not null,
  port int not null default 5432,
  db_user text not null,
  password text,
  database text,
  ssl boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists pg_servers_user_id_idx on public.pg_servers(user_id);

alter table public.pg_servers enable row level security;

drop policy if exists "owner all" on public.pg_servers;
create policy "owner all" on public.pg_servers
  using (user_id = auth.uid()) with check (user_id = auth.uid());
