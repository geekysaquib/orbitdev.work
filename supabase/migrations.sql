-- ============================================================================
-- Consolidated prologue — everything that used to live in separate
-- supabase/add_*.sql files (add_teams.sql, add_provider_connections.sql,
-- add_pg_servers.sql, add_mail_features.sql, add_repo_link.sql,
-- add_team_notifications.sql), folded in here so this single file takes an
-- old, already-deployed project all the way to current in one run, instead of
-- requiring six separate scripts run in a specific order first. Every
-- statement is idempotent (IF NOT EXISTS / DROP ... IF EXISTS before every
-- CREATE) — safe to re-run, and safe to run even if you already applied some
-- or all of the old add_*.sql files by hand. For a brand-new project,
-- supabase/schema.sql already includes all of this — you don't need this
-- file at all in that case.
--
-- Ordered so nothing below references a table that doesn't exist yet: teams
-- before audit_log's team_id FK (further down this file) and before the
-- tasks/projects team-sharing columns/policies; provider_connections before
-- its later constraint-widening statements (also further down).

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

alter table public.projects add column if not exists team_id uuid references public.teams(id) on delete set null;
alter table public.tasks add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;
alter table public.team_invites enable row level security;

-- SECURITY DEFINER breaks the self-referencing-policy recursion this table's
-- own "am I a member" check would otherwise hit — see schema.sql's comment.
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
-- RC1 task 6: SECURITY DEFINER + Postgres's default PUBLIC execute grant on
-- every new function would let this be called directly as an RPC to probe
-- arbitrary team_id/user_id pairs, not just from inside the policies that
-- legitimately need it. `authenticated` still needs EXECUTE for those
-- policies to evaluate — only PUBLIC/anon access is being closed here.
revoke execute on function public.is_team_member(uuid, uuid) from public;
grant execute on function public.is_team_member(uuid, uuid) to authenticated;

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

-- tasks/projects: owner, or member of the team they're shared with (spelled
-- out literally per table, not generated in a loop, so it's trivial to
-- eyeball and there's no dynamic-SQL step that could silently misfire).
drop policy if exists "owner all" on public.tasks;
drop policy if exists "select: owner or team member" on public.tasks;
drop policy if exists "insert: self, and only into your own team" on public.tasks;
drop policy if exists "update: creator or team owner/admin" on public.tasks;
drop policy if exists "delete: creator or team owner/admin" on public.tasks;
create policy "select: owner or team member" on public.tasks for select using (
  user_id = auth.uid()
  or (team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid()))
);
create policy "insert: self, and only into your own team" on public.tasks for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid()))
);
create policy "update: creator or team owner/admin" on public.tasks for update using (
  user_id = auth.uid()
  or (team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')))
) with check (
  user_id = auth.uid()
  or team_id is null
  or exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);
create policy "delete: creator or team owner/admin" on public.tasks for delete using (
  user_id = auth.uid()
  or (team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')))
);
revoke update (user_id, id, created_at) on public.tasks from authenticated;

drop policy if exists "owner all" on public.projects;
drop policy if exists "select: owner or team member" on public.projects;
drop policy if exists "insert: self, and only into your own team" on public.projects;
drop policy if exists "update: creator or team owner/admin" on public.projects;
drop policy if exists "delete: creator or team owner/admin" on public.projects;
create policy "select: owner or team member" on public.projects for select using (
  user_id = auth.uid()
  or (team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid()))
);
create policy "insert: self, and only into your own team" on public.projects for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid()))
);
create policy "update: creator or team owner/admin" on public.projects for update using (
  user_id = auth.uid()
  or (team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')))
) with check (
  user_id = auth.uid()
  or team_id is null
  or exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);
create policy "delete: creator or team owner/admin" on public.projects for delete using (
  user_id = auth.uid()
  or (team_id is not null and exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')))
);
revoke update (user_id, id, created_at) on public.projects from authenticated;

-- ---------- team task-activity notifications ----------
create or replace function public.notify_team_task_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  team_name text;
  verb text;
begin
  if NEW.team_id is null then
    return NEW;
  end if;

  if TG_OP = 'INSERT' then
    verb := 'added a task to';
  elsif TG_OP = 'UPDATE' then
    if OLD.team_id is distinct from NEW.team_id then
      verb := 'shared a task with';
    elsif NEW.status is distinct from OLD.status then
      verb := 'moved a task to ' || NEW.status || ' in';
    elsif NEW.title is distinct from OLD.title or NEW.priority is distinct from OLD.priority or NEW.due_date is distinct from OLD.due_date then
      verb := 'updated a task in';
    else
      return NEW;
    end if;
  else
    return NEW;
  end if;

  select coalesce(full_name, email) into actor_name from public.users where id = actor;
  select name into team_name from public.teams where id = NEW.team_id;

  insert into public.notifications (user_id, kind, title, body)
  select tm.user_id, 'task_team',
    coalesce(actor_name, 'A teammate') || ' ' || verb || ' ' || coalesce(team_name, 'the team'),
    NEW.title
  from public.team_members tm
  where tm.team_id = NEW.team_id
    and tm.user_id is distinct from actor;

  return NEW;
end;
$$;
drop trigger if exists notify_team_task_activity on public.tasks;
create trigger notify_team_task_activity
after insert or update on public.tasks
for each row execute function public.notify_team_task_activity();

-- ---------- provider connections ----------
create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('github','gitlab','sentry','netlify','vercel','aws')),
  status text not null default 'connected' check (status in ('connected','disconnected','error')),
  client_id text,
  client_secret text,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  scope text,
  external_account_id text,
  external_account_name text,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create index if not exists provider_connections_user_idx on public.provider_connections(user_id);
alter table public.provider_connections enable row level security;
drop policy if exists "owner all" on public.provider_connections;
create policy "owner all" on public.provider_connections
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- repo-link columns (Project detail's "git" tab remote panel) ----------
alter table public.projects add column if not exists repo_provider text check (repo_provider in ('github','gitlab'));
alter table public.projects add column if not exists repo_full_name text;
alter table public.projects add column if not exists repo_id text;
alter table public.projects add column if not exists repo_default_branch text;

-- ---------- saved Postgres servers ----------
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

-- ---------- mail features (templates, scheduled send, rules) ----------
create table if not exists public.mail_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  subject text,
  body text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists mail_templates_user_idx on public.mail_templates(user_id);
alter table public.mail_templates enable row level security;
drop policy if exists "owner all" on public.mail_templates;
create policy "owner all" on public.mail_templates
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.scheduled_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  to_addr text not null,
  cc text,
  bcc text,
  subject text,
  body text not null default '',
  html text,
  in_reply_to text,
  "references" text,
  send_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','failed','canceled')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.scheduled_emails add column if not exists html text;
create index if not exists scheduled_emails_due_idx on public.scheduled_emails(status, send_at);
alter table public.scheduled_emails enable row level security;
drop policy if exists "owner all" on public.scheduled_emails;
create policy "owner all" on public.scheduled_emails
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create table if not exists public.mail_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  field text not null check (field in ('from','subject')),
  value text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists mail_rules_user_idx on public.mail_rules(user_id);
alter table public.mail_rules enable row level security;
drop policy if exists "owner all" on public.mail_rules;
create policy "owner all" on public.mail_rules
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- ============================================================================

-- Run this in the Supabase SQL editor if your projects table already exists
-- (adds the Zoho Sprints link columns without recreating the table).
alter table public.projects add column if not exists sprint_project_id text;
alter table public.projects add column if not exists sprint_project_name text;

-- Per-user integration credentials (Zoho + Gmail), replacing env-only config.
-- References public.users, NOT auth.users — this app's auth is custom (see
-- schema.sql's header comment); every table's user_id points at public.users.
-- (RC1 task 6: this line previously said `auth.users`, a leftover from before
-- the custom-auth migration. `create table if not exists` made it a dormant
-- no-op on every environment that already had this table with the correct
-- reference, but it was still wrong for anyone running this file fresh.)
create table if not exists public.integrations (
  user_id uuid primary key references public.users(id) on delete cascade,
  zoho_client_id text, zoho_client_secret text, zoho_refresh_token text,
  zoho_dc text default 'in', zoho_team_id text, zoho_project_id text,
  gmail_user text, gmail_app_password text,
  updated_at timestamptz default now()
);
-- Per-user Anthropic API key, used client-side to power project-aware dummy-data
-- seeding (SeedDataModal's optional "describe your project" prompt).
alter table public.integrations add column if not exists anthropic_api_key text;

alter table public.integrations enable row level security;
-- RC1 task 6: this used to be named "own integrations" (and used a
-- skip-if-exists idiom, so a re-run could never update it). Renamed to
-- "owner all" to match every other table's convention and schema.sql's
-- fresh-install path (which creates it under that name via the generic
-- per-table loop) — same underlying rule, just consistent naming so a future
-- policy edit here can't silently miss an already-upgraded environment.
drop policy if exists "own integrations" on public.integrations;
drop policy if exists "owner all" on public.integrations;
create policy "owner all" on public.integrations
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Login lockout (brute-force throttling) + password-change tracking, used by
-- netlify/functions/auth.ts and _lib/verifyToken.ts (which revokes any JWT
-- issued before password_changed_at).
alter table public.users add column if not exists failed_login_attempts int not null default 0;
alter table public.users add column if not exists lockout_until timestamptz;
alter table public.users add column if not exists password_changed_at timestamptz;
-- Backfill to each user's created_at, NOT now() — every already-issued session
-- token has an `iat` at or after signup, so this never revokes a currently-valid
-- token. (Also corrects anyone who already ran an earlier version of this
-- migration that backfilled to now() and revoked every existing session.)
update public.users set password_changed_at = created_at where password_changed_at is null or password_changed_at > created_at;
alter table public.users alter column password_changed_at set not null;
alter table public.users alter column password_changed_at set default now();

-- Atomic team create/transfer-ownership, used by netlify/functions/teams.ts
-- instead of separate insert/update calls that could leave membership/
-- ownership inconsistent if a step failed mid-sequence.
-- RC1 task 6: SECURITY INVOKER (the default — not specified as DEFINER), so
-- a direct call from authenticated/anon is already blocked by teams/
-- team_members' own RLS (no insert policy grants that). The revoke below is
-- defense-in-depth against that RLS layer alone changing in the future —
-- this function does no authorization of its own, it trusts its caller.
create or replace function public.create_team_with_owner(p_name text, p_owner_id uuid)
returns public.teams
language plpgsql
set search_path = public
as $$
declare t public.teams;
begin
  insert into public.teams (name, owner_id) values (p_name, p_owner_id) returning * into t;
  insert into public.team_members (team_id, user_id, role) values (t.id, p_owner_id, 'owner');
  return t;
end;
$$;
revoke execute on function public.create_team_with_owner(text, uuid) from public;
grant execute on function public.create_team_with_owner(text, uuid) to service_role;

create or replace function public.transfer_team_ownership(p_team_id uuid, p_old_owner_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.team_members set role = 'owner' where team_id = p_team_id and user_id = p_new_owner_id;
  update public.team_members set role = 'admin' where team_id = p_team_id and user_id = p_old_owner_id;
  update public.teams set owner_id = p_new_owner_id where id = p_team_id;
end;
$$;
revoke execute on function public.transfer_team_ownership(uuid, uuid, uuid) from public;
grant execute on function public.transfer_team_ownership(uuid, uuid, uuid) to service_role;

-- Durable per-user settings (timezone, break state, chores, appearance —
-- theme/accent/font/density — and dashboard layout), written via
-- merge_user_settings() below. The function existed in an earlier migration
-- but this table never did, so every save was silently failing (settings.ts
-- fails soft) and falling back to localStorage only — this backfills it.
create table if not exists public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_settings enable row level security;
do $$ begin
  create policy "owner all" on public.user_settings
    for all using (user_id = auth.uid()) with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Atomic partial-update of a user's settings blob, used by src/lib/settings.ts
-- instead of a client-side fetch-merge-upsert (which two concurrent saves —
-- e.g. starting a break while a timezone change is in flight — could race on).
create or replace function public.merge_user_settings(p_patch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare result jsonb;
begin
  insert into public.user_settings (user_id, data, updated_at)
  values (auth.uid(), p_patch, now())
  on conflict (user_id) do update
    set data = coalesce(public.user_settings.data, '{}'::jsonb) || excluded.data,
        updated_at = now()
  returning data into result;
  return result;
end;
$$;
grant execute on function public.merge_user_settings(jsonb) to authenticated;

-- Aggregates time_entries server-side instead of the client pulling every row
-- (see src/lib/orbitHours.ts). p_day_start is the caller's own local midnight
-- (as a UTC instant) so "today" still means the user's local day, not the
-- database server's timezone.
create or replace function public.orbit_hours(p_day_start timestamptz)
returns table(today_seconds bigint, total_seconds bigint)
language sql
security invoker
set search_path = public
stable
as $$
  select
    coalesce(sum(seconds) filter (
      where started_at >= p_day_start and started_at < p_day_start + interval '1 day'
    ), 0)::bigint as today_seconds,
    coalesce(sum(seconds), 0)::bigint as total_seconds
  from public.time_entries
  where user_id = auth.uid();
$$;
grant execute on function public.orbit_hours(timestamptz) to authenticated;

-- Durable, append-only record of targeted key actions (sign-in/out,
-- integration connect/disconnect, work-item create/update/delete, team
-- membership changes), written explicitly via src/lib/audit.ts — deliberately
-- not a generic mutation log and not the notify_team_task_activity trigger
-- (that's ephemeral read/dismiss notifications, not a durable log).
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_user_created_idx on public.audit_log(user_id, created_at desc);
alter table public.audit_log enable row level security;
-- append-only: select + insert policies only, no update/delete policy anywhere.
do $$ begin
  create policy "owner select" on public.audit_log for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "owner insert" on public.audit_log for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;

-- Azure DevOps as a third repo/provider option, alongside GitHub/GitLab.
-- Widens both check constraints in place (Postgres' default auto-generated
-- names for an inline `check` on a `create table`) rather than recreating
-- either table.
alter table public.projects drop constraint if exists projects_repo_provider_check;
alter table public.projects add constraint projects_repo_provider_check
  check (repo_provider in ('github','gitlab','azuredevops'));

alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check
  check (provider in ('github','gitlab','azuredevops','sentry','netlify','vercel','aws'));

-- ================= Team collaboration: presence, activity feed, mentions, RBAC =================

-- 'viewer' role: read-only team membership (see updated tasks/projects
-- insert/update policies below, which deliberately exclude it).
alter table public.team_members drop constraint if exists team_members_role_check;
alter table public.team_members add constraint team_members_role_check
  check (role in ('owner','admin','member','viewer'));
alter table public.team_invites drop constraint if exists team_invites_role_check;
alter table public.team_invites add constraint team_invites_role_check
  check (role in ('admin','member','viewer'));

-- Deep-link for a notification (used by @mentions below; any future kind can
-- set it too) — Notifications.tsx/Layout.tsx navigate here on click.
alter table public.notifications add column if not exists link text;

-- Team activity feed: let a teammate see audit_log rows explicitly logged
-- against a shared team, reusing is_team_member() (defined earlier in this
-- file for team_members' own policy).
drop policy if exists "select: team member" on public.audit_log;
create policy "select: team member" on public.audit_log for select using (
  team_id is not null and public.is_team_member(team_id, auth.uid())
);
alter publication supabase_realtime add table public.audit_log;

-- tasks/projects: tighten insert/update so a 'viewer' can see everything
-- shared to their team but can't create/share into it, and so a plain
-- update can no longer re-point team_id to a team the caller isn't really
-- (non-viewer) a member of (a pre-existing cross-tenant gap, closed here
-- alongside the viewer work since the same WITH CHECK clause is being
-- touched anyway).
drop policy if exists "insert: self, and only into your own team" on public.tasks;
create policy "insert: self, and only into your own team" on public.tasks for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin','member')
  ))
);
drop policy if exists "update: creator or team owner/admin" on public.tasks;
create policy "update: creator or team owner/admin" on public.tasks for update using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
) with check (
  (user_id = auth.uid() and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin','member')
  )))
  or exists (select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);

drop policy if exists "insert: self, and only into your own team" on public.projects;
create policy "insert: self, and only into your own team" on public.projects for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin','member')
  ))
);
drop policy if exists "update: creator or team owner/admin" on public.projects;
create policy "update: creator or team owner/admin" on public.projects for update using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
) with check (
  (user_id = auth.uid() and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin','member')
  )))
  or exists (select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);

-- @mention notifications on a shared project's description. Same
-- SECURITY DEFINER fan-out pattern as notify_team_task_activity (schema.sql)
-- — notifications' RLS only allows inserting your own row, so fanning a
-- notification out to whoever got @mentioned has to run server-side. Plain
-- substring match on '@' || full_name (not regex, so full_name never needs
-- escaping), and only for a name that's newly present vs. OLD.description so
-- re-saving an unrelated edit doesn't re-notify. OLD is only referenced when
-- TG_OP = 'update' (referencing it on insert would error — OLD isn't assigned).
create or replace function public.notify_project_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  actor_name text;
  member record;
  old_desc text := '';
  new_desc text := coalesce(NEW.description, '');
  snippet text;
begin
  if NEW.team_id is null or NEW.description is null then
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    old_desc := coalesce(OLD.description, '');
  end if;

  select coalesce(full_name, email) into actor_name from public.users where id = actor;
  snippet := left(NEW.description, 240);

  for member in
    select tm.user_id, u.full_name
    from public.team_members tm
    join public.users u on u.id = tm.user_id
    where tm.team_id = NEW.team_id
      and tm.user_id is distinct from actor
      and coalesce(u.full_name, '') <> ''
  loop
    if position('@' || member.full_name in new_desc) > 0
       and position('@' || member.full_name in old_desc) = 0 then
      insert into public.notifications (user_id, kind, title, body, link)
      values (
        member.user_id, 'mention',
        coalesce(actor_name, 'A teammate') || ' mentioned you in ' || NEW.name,
        snippet,
        '/projects/' || NEW.id
      );
    end if;
  end loop;

  return NEW;
end;
$$;

drop trigger if exists notify_project_mentions on public.projects;
create trigger notify_project_mentions
after insert or update of description on public.projects
for each row execute function public.notify_project_mentions();

-- Microsoft Teams as a connected provider (meeting creation via Graph),
-- alongside GitHub/GitLab/Azure DevOps/Sentry/Netlify/Vercel/AWS.
alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check
  check (provider in ('github','gitlab','azuredevops','sentry','netlify','vercel','aws','msteams'));

-- Join link for a calendar event's Teams meeting, if one was created for it.
alter table public.events add column if not exists meeting_url text;

-- ---------- focus events (append-only activity log for insights) ----------
-- Idle/resume pairs (from the tab-level idle detection that pauses the focus
-- timer, see src/context/Break.tsx) plus top-level route changes (see
-- src/components/Layout.tsx) — enough to later derive interrupted-hours and
-- context-switching-cost views without needing a heavier event pipeline.
create table if not exists public.focus_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  type text not null check (type in ('idle','resume','route_change')),
  route text,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists focus_events_user_at_idx on public.focus_events(user_id, at desc);
alter table public.focus_events enable row level security;
drop policy if exists "owner select" on public.focus_events;
create policy "owner select" on public.focus_events for select using (user_id = auth.uid());
drop policy if exists "owner insert" on public.focus_events;
create policy "owner insert" on public.focus_events for insert with check (user_id = auth.uid());

-- ---------- break chore digests ----------
-- RC1 task 6: this table exists in schema.sql (the fresh-install path) but
-- was missing from this file entirely — an environment that only ever ran
-- migrations.sql (this file's whole purpose, per the header at the top) had
-- no break_logs table at all, so every write from BreakView.tsx would have
-- hard-failed with "relation does not exist," not merely an RLS gap.
create table if not exists public.break_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds int not null default 0,
  beverage text,
  rows jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.break_logs enable row level security;
drop policy if exists "owner all" on public.break_logs;
create policy "owner all" on public.break_logs
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- metric snapshots (daily-brief/anomaly-scan crons' day-over-day deltas) ----------
create table if not exists public.metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  metric text not null,
  value numeric not null,
  meta jsonb not null default '{}'::jsonb,
  snapshot_date date not null default current_date,
  created_at timestamptz not null default now(),
  unique (user_id, metric, snapshot_date)
);
create index if not exists metric_snapshots_user_idx on public.metric_snapshots(user_id, metric, snapshot_date desc);
alter table public.metric_snapshots enable row level security;
drop policy if exists "owner all" on public.metric_snapshots;
create policy "owner all" on public.metric_snapshots for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- AI-triage reasoning ("Summary"/"Suggested next step"), persisted so it survives reload
-- instead of only existing ephemerally in Tickets.tsx's local component state.
alter table public.tickets add column if not exists ai_note text;

-- ---------- estimate accuracy + weekly retrospective columns ----------
-- estimate_minutes: user-set planned effort on a task (Tasks.tsx board card).
-- completed_at: auto-stamped by the trigger below, not settable by the client
-- — status is the single source of truth for it. task_id on time_entries lets
-- a logged session be attributed to a specific task (not just its project),
-- which is what makes "planned vs actual" computable at all.
alter table public.tasks add column if not exists estimate_minutes int;
alter table public.tasks drop constraint if exists tasks_estimate_minutes_check;
alter table public.tasks add constraint tasks_estimate_minutes_check check (estimate_minutes is null or estimate_minutes > 0);
alter table public.tasks add column if not exists completed_at timestamptz;
-- Backfill: best-effort guess for tasks already sitting in 'done' pre-migration
-- (no history of *when* they finished), so they aren't silently excluded from
-- future weekly-retrospective windows solely for having a null completed_at.
update public.tasks set completed_at = created_at where status = 'done' and completed_at is null;

create or replace function public.set_task_completed_at()
returns trigger
language plpgsql
as $$
begin
  if NEW.status = 'done' and (TG_OP = 'INSERT' or OLD.status is distinct from 'done') then
    NEW.completed_at := now();
  elsif NEW.status <> 'done' then
    NEW.completed_at := null;
  end if;
  return NEW;
end;
$$;
drop trigger if exists set_task_completed_at on public.tasks;
create trigger set_task_completed_at
before insert or update on public.tasks
for each row execute function public.set_task_completed_at();

alter table public.time_entries add column if not exists task_id uuid references public.tasks(id) on delete set null;
create index if not exists time_entries_task_idx on public.time_entries(task_id) where task_id is not null;

-- ---------- multi-provider AI keys ----------
-- Ask AI / seeding / triage / standup / commit-writer previously only supported
-- Anthropic; a low-credit or expired key meant a hard failure with no cloud
-- fallback short of the free local model. Adding Gemini/OpenAI/Grok as peer
-- providers plus a user-chosen `ai_provider` preference so the client can try
-- other configured cloud keys before dropping to local.
alter table public.integrations add column if not exists gemini_api_key text;
alter table public.integrations add column if not exists openai_api_key text;
alter table public.integrations add column if not exists grok_api_key text;
alter table public.integrations add column if not exists ai_provider text default 'anthropic';
alter table public.integrations drop constraint if exists integrations_ai_provider_check;
alter table public.integrations add constraint integrations_ai_provider_check check (ai_provider in ('anthropic','gemini','openai','grok'));

-- ---------- automation: when-X-then-Y rules ----------
-- Cross-module rules ("task moved to done -> notify", "timer started -> ...").
-- Triggers are raised client-side where the change happens and actions run
-- through the user's own RLS-scoped client calls, so a rule can never do
-- something its owner couldn't. See src/lib/automation.ts.
create table if not exists public.automation_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  trigger_type text not null check (trigger_type in ('task_status','ticket_status','timer_started','timer_stopped')),
  trigger_config jsonb not null default '{}'::jsonb,
  action_type text not null check (action_type in ('create_task','set_task_status','set_ticket_status','notify','start_timer')),
  action_config jsonb not null default '{}'::jsonb,
  run_count integer not null default 0,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists automation_rules_user_idx on public.automation_rules(user_id, enabled);
alter table public.automation_rules enable row level security;
drop policy if exists "owner all" on public.automation_rules;
create policy "owner all" on public.automation_rules
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- automation: engine v2 (multi-condition rules, more triggers/actions) ----------
-- `trigger_config.conditions` (an array of {field,op,value}) rides in the existing
-- jsonb column, so no schema change was needed for multi-condition matching itself
-- — this migration only widens the type check constraints for the two new
-- triggers (ticket_created, mail_rule_matched) and four new actions
-- (send_email, create_teams_meeting, run_agent_command, webhook). See
-- src/lib/automation.ts.
alter table public.automation_rules drop constraint if exists automation_rules_trigger_type_check;
alter table public.automation_rules add constraint automation_rules_trigger_type_check
  check (trigger_type in ('task_status','ticket_status','ticket_created','timer_started','timer_stopped','mail_rule_matched'));
alter table public.automation_rules drop constraint if exists automation_rules_action_type_check;
alter table public.automation_rules add constraint automation_rules_action_type_check
  check (action_type in ('create_task','set_task_status','set_ticket_status','notify','start_timer','send_email','create_teams_meeting','run_agent_command','webhook'));

-- ---------- domain events (Event Engine — see docs/architecture/event-engine.md) ----------
-- Immutable log every engine (AI, Integration, future ones) publishes
-- through: `source` is the publishing engine ("integration-engine", ...),
-- `type` is engine-defined ("connected", "sync_completed", ...). Append-only
-- like audit_log above (no update/delete policy, ever) but a distinct table
-- because its purpose is different — inter-engine domain events, not a
-- user-audit trail (audit_log) or a user-facing inbox (notifications).
create table if not exists public.domain_events (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  type text not null,
  user_id uuid references public.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists domain_events_source_type_idx on public.domain_events(source, type, occurred_at desc);
create index if not exists domain_events_user_idx on public.domain_events(user_id, occurred_at desc);
alter table public.domain_events enable row level security;
do $$ begin
  create policy "owner select" on public.domain_events for select using (user_id = auth.uid());
exception when duplicate_object then null; end $$;
do $$ begin
  create policy "owner insert" on public.domain_events for insert with check (user_id = auth.uid());
exception when duplicate_object then null; end $$;
drop policy if exists "select: team member" on public.domain_events;
create policy "select: team member" on public.domain_events for select using (
  team_id is not null and public.is_team_member(team_id, auth.uid())
);
alter publication supabase_realtime add table public.domain_events;

-- ---------- migration tracking (RC1 task 4 — see docs/architecture/rc1-release.md) ----------
-- Until now, this file was applied by hand with no record of what any given
-- environment had actually run — no way to answer "is this database fully
-- up to date" except by inference. One row per migration from here on,
-- `on conflict do nothing` so re-running the whole file (the established,
-- safe way to run this file — see the header comment at the top of this
-- file) never duplicates a row.
create table if not exists public.schema_migrations (
  version integer primary key,
  description text not null,
  applied_at timestamptz not null default now()
);
alter table public.schema_migrations enable row level security;
-- No policy defined — same pattern as otp_codes above: reachable only via
-- direct SQL with a service-role/superuser connection, never through the app.

-- Baseline: marks everything above this line (the entire migration history
-- prior to this table existing) as version 1 in one shot, rather than
-- retroactively splitting ~25 already-applied historical sections into
-- individually numbered rows — those already ran, on every environment that
-- matters, before this table could have tracked them; re-deriving exact
-- per-section history now would be a large, purely cosmetic diff for no
-- operational benefit. Every migration ADDED FROM HERE ON gets its own
-- version number.
insert into public.schema_migrations (version, description) values
  (1, 'baseline — everything above this line, before migration tracking existed')
on conflict (version) do nothing;

-- ---------- RC1 task 6: RLS/schema hardening (see docs/architecture/rc1-release.md) ----------
-- Four fixes found auditing every table's RLS against schema.sql:
--  1. break_logs was entirely missing from this file's upgrade path (added above).
--  2. integrations.user_id referenced auth.users instead of public.users.
--  3. integrations' RLS policy was named "own integrations" here vs "owner
--     all" in schema.sql (same rule, inconsistent naming — renamed to match).
--  4. is_team_member()/create_team_with_owner()/transfer_team_ownership()
--     relied only on RLS (or nothing) to block misuse via Postgres's default
--     PUBLIC execute grant — explicit revokes added as defense-in-depth.
insert into public.schema_migrations (version, description) values
  (2, 'RC1 task 6 — RLS hardening: missing break_logs, integrations FK + policy name fix, function execute grants')
on conflict (version) do nothing;

-- ---------- HOW TO ADD THE NEXT MIGRATION (read before editing this file) ----------
-- 1. Add your SQL above this comment block.
-- 2. Also fold the equivalent change into supabase/schema.sql (the
--    fresh-install path) if it changes what a brand-new project needs —
--    schema.sql has no per-migration granularity, so just edit the
--    relevant `create table`/function there directly, the same way every
--    prior migration in this file's history already has.
-- 3. Register it here, picking the next integer after the highest `version`
--    already used above:
--      insert into public.schema_migrations (version, description) values
--        (N, 'short, one-line description')
--      on conflict (version) do nothing;
-- 4. To check any environment's status:
--      select max(version) from public.schema_migrations;
--    — compare against the highest version number defined in this file.
