-- ORBIT — add the team system to an already-deployed project.
-- Safe to run against the live DB, and safe to RE-run: every statement is
-- idempotent (IF NOT EXISTS / DROP POLICY IF EXISTS before every CREATE).
-- For a brand-new project, supabase/schema.sql already includes all of this
-- — you don't need this file too.
--
-- Re-running this script is also the fix if projects/tasks became invisible
-- after an earlier run: it forcibly drops and recreates the policies on
-- `tasks`/`projects` with literal, non-dynamic SQL (no `do $$ ... execute
-- format(...) $$` loop) so there's nothing to silently go wrong. It never
-- touches table data — ADD COLUMN and RLS policy changes cannot delete rows.

-- ---------- sanity check: your rows are still there ----------
-- The SQL Editor runs as a privileged role that bypasses RLS, so these counts
-- reflect everyone's real data regardless of any policy bug below.
select
  (select count(*) from public.projects) as project_rows,
  (select count(*) from public.tasks) as task_rows;

-- ---------- teams ----------
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member')),
  token_hash text not null,
  invited_by uuid not null references public.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists team_invites_pending_uniq on public.team_invites(team_id, lower(email)) where status = 'pending';
create index if not exists team_invites_token_lookup on public.team_invites(token_hash) where status = 'pending';

-- ---------- sharing columns on existing tables ----------
alter table public.projects add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.tasks add column if not exists team_id uuid references public.teams(id) on delete set null;

-- ---------- RLS ----------
alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

-- `team_members`'s own "am I a member of this row's team" policy needs to
-- query team_members to answer that — which would normally re-trigger the
-- very policy being evaluated ("infinite recursion detected in policy for
-- relation team_members"). SECURITY DEFINER runs this one lookup as the
-- function's owner (the table owner), which bypasses RLS entirely for just
-- this query, breaking the cycle. This is the standard Postgres/Supabase
-- pattern for self-referencing membership-table policies.
create or replace function public.is_team_member(p_team_id uuid, p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.team_members
    where team_id = p_team_id and user_id = p_user_id
  );
$$;

drop policy if exists "teammates are visible" on public.users;
create policy "teammates are visible" on public.users for select using (
  exists (
    select 1 from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid() and theirs.user_id = users.id
  )
);
revoke select (password_hash) on public.users from authenticated, anon;

drop policy if exists "select: member" on public.teams;
create policy "select: member" on public.teams for select using (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid())
);
drop policy if exists "update: owner or admin" on public.teams;
create policy "update: owner or admin" on public.teams for update using (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
) with check (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);
drop policy if exists "delete: owner" on public.teams;
create policy "delete: owner" on public.teams for delete using (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid() and tm.role = 'owner')
);

drop policy if exists "select: fellow member" on public.team_members;
create policy "select: fellow member" on public.team_members for select using (
  public.is_team_member(team_members.team_id, auth.uid())
);

drop policy if exists "select: owner or admin of the team" on public.team_invites;
create policy "select: owner or admin of the team" on public.team_invites for select using (
  exists (select 1 from public.team_members tm where tm.team_id = team_invites.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);

-- ---- tasks: owner, or member of the team it's shared with ----
-- (spelled out literally, not generated in a loop, so it's trivial to eyeball
-- and there's no dynamic-SQL step that could silently misfire)
drop policy if exists "owner all" on public.tasks;
drop policy if exists "select: owner or team member" on public.tasks;
drop policy if exists "insert: self, and only into your own team" on public.tasks;
drop policy if exists "update: creator or team owner/admin" on public.tasks;
drop policy if exists "delete: creator or team owner/admin" on public.tasks;

create policy "select: owner or team member" on public.tasks for select using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid()
  ))
);
create policy "insert: self, and only into your own team" on public.tasks for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid()
  ))
);
create policy "update: creator or team owner/admin" on public.tasks for update using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
) with check (
  user_id = auth.uid()
  or team_id is null
  or exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);
create policy "delete: creator or team owner/admin" on public.tasks for delete using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
);
revoke update (user_id, id, created_at) on public.tasks from authenticated;

-- ---- projects: identical pattern ----
drop policy if exists "owner all" on public.projects;
drop policy if exists "select: owner or team member" on public.projects;
drop policy if exists "insert: self, and only into your own team" on public.projects;
drop policy if exists "update: creator or team owner/admin" on public.projects;
drop policy if exists "delete: creator or team owner/admin" on public.projects;

create policy "select: owner or team member" on public.projects for select using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid()
  ))
);
create policy "insert: self, and only into your own team" on public.projects for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid()
  ))
);
create policy "update: creator or team owner/admin" on public.projects for update using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
) with check (
  user_id = auth.uid()
  or team_id is null
  or exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);
create policy "delete: creator or team owner/admin" on public.projects for delete using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
);
revoke update (user_id, id, created_at) on public.projects from authenticated;

-- ---------- confirm: exactly 4 policies per table, listed below ----------
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename in ('tasks', 'projects')
order by tablename, cmd;
