-- ORBIT — Supabase schema (Postgres). Run in Supabase SQL editor.
-- Auth is custom (OTP-based, see netlify/functions/auth.ts) — Supabase is used
-- purely as Postgres + PostgREST here. `public.users` is the identity table;
-- every other table's `user_id` points at it (not at `auth.users`). Sessions are
-- JWTs we sign ourselves with the project's legacy JWT secret, using the same
-- `sub`/`role` claim shape Supabase Auth would produce — so `auth.uid()` and
-- every RLS policy below keep working exactly as if Supabase Auth issued them.
--
-- If you're migrating an EXISTING ORBIT project that still has Supabase Auth
-- users, run supabase/migrate_to_custom_auth.sql instead — it carries your
-- current users/passwords/data over to this schema. This file is for a fresh
-- project only.

-- ---------- users (custom auth) ----------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text not null default '',
  email_verified boolean not null default false,
  failed_login_attempts int not null default 0,
  lockout_until timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ---------- one-time codes for signup verification + password reset ----------
create table if not exists public.otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code text not null,
  purpose text not null check (purpose in ('verify', 'reset')),
  attempts int not null default 0,
  consumed boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists otp_codes_lookup on public.otp_codes (email, purpose, consumed, created_at desc);

-- ---------- teams ----------
-- Membership/invite writes never go through client-facing RLS policies (see the
-- security section below) — they only ever happen via netlify/functions/teams.ts
-- using the service-role key, which does its own explicit authorization checks.
-- That's what keeps a plain user from ever self-inserting into team_members as
-- 'owner' of an arbitrary team.
create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member','viewer')),
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- token_hash is sha256(raw token) — the raw token only ever appears in the
-- invite email link, same "never store the usable secret" pattern as
-- users.password_hash.
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  email text not null,
  role text not null default 'member' check (role in ('admin','member','viewer')),
  token_hash text not null,
  invited_by uuid not null references public.users(id),
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists team_invites_pending_uniq on public.team_invites(team_id, lower(email)) where status = 'pending';
create index if not exists team_invites_token_lookup on public.team_invites(token_hash) where status = 'pending';

-- ---------- projects ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  team_id uuid references public.teams(id) on delete set null,
  name text not null,
  client text,
  stacks text[] not null default '{}',
  status text not null default 'active' check (status in ('active','hold','archived')),
  accent text,
  fe_path text,
  sln_path text,
  dev_port int,
  branch text,
  description text,
  sprint_project_id text,
  sprint_project_name text,
  repo_provider text check (repo_provider in ('github','gitlab','azuredevops')),
  repo_full_name text,
  repo_id text,
  repo_default_branch text,
  created_at timestamptz not null default now()
);

-- ---------- tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','review','done')),
  priority text not null default 'med' check (priority in ('low','med','high')),
  due_date date,
  created_at timestamptz not null default now()
);

-- ---------- tickets (mirrors Zoho, synced via Netlify function) ----------
create table if not exists public.tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  zoho_id text,
  title text not null,
  body text,
  priority text not null default 'med' check (priority in ('low','med','high')),
  status text not null default 'Open',
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, zoho_id)
);

-- ---------- calendar events ----------
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  kind text default 'focus',
  meeting_url text,
  created_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'system',
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- time entries ----------
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  seconds int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- integrations (one row per user: Zoho + Gmail keys) ----------
create table if not exists public.integrations (
  user_id uuid primary key references public.users(id) on delete cascade,
  zoho_client_id text, zoho_client_secret text, zoho_refresh_token text,
  zoho_dc text default 'in', zoho_team_id text, zoho_project_id text,
  gmail_user text, gmail_app_password text,
  anthropic_api_key text,
  updated_at timestamptz not null default now()
);

-- ---------- provider connections (one row per user+provider: GitHub, GitLab, ----------
-- Sentry, Netlify, Vercel, AWS. Unlike `integrations` above these are
-- multi-row-per-user (a user can hold a GitHub row and an AWS row at once),
-- so they get their own table with a (user_id, provider) uniqueness
-- constraint instead of more flat columns bolted onto `integrations`.
create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null check (provider in ('github','gitlab','azuredevops','sentry','netlify','vercel','aws','msteams')),
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

-- ---------- postgres machines (saved connections for the Postgres explorer) ----------
-- One row per saved server, plaintext columns — same trust model as
-- `integrations` (Zoho/Gmail keys): RLS scopes every row to its owner, and the
-- local agent is handed the connection details per-request instead of storing
-- its own copy, so this table is the single source of truth.
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

-- ---------- mail templates (reusable subject/body snippets for Compose) ----------
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

-- ---------- scheduled outgoing mail ----------
-- Sent by the netlify/functions/mail-scheduled-send.ts scheduled function
-- (runs every 5 minutes via nodemailer, same as _lib/mailer.ts) — unlike the
-- rest of Gmail (read via the local agent's IMAP session), sending a
-- scheduled message can't depend on ORBIT + the agent being open at the
-- future send time, so this path goes server-side using the Gmail app
-- password already stored in `integrations`.
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
create index if not exists scheduled_emails_due_idx on public.scheduled_emails(status, send_at);

-- ---------- mail rules (simple "from/subject contains X" -> notification) ----------
-- Evaluated client-side against the local agent's IMAP session (same
-- constraint as the rest of Gmail: ORBIT + the agent need to be running —
-- see Layout.tsx's mail-rules poller), since IMAP creds never leave the
-- agent's process. Deliberately just substring matching, not a full rule
-- engine — "email from client X" is the whole ask.
create table if not exists public.mail_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  field text not null check (field in ('from','subject')),
  value text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists mail_rules_user_idx on public.mail_rules(user_id);

-- ---------- durable per-user settings (timezone, break state, chores) ----------
create table if not exists public.user_settings (
  user_id uuid primary key references public.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- break chore digests ----------
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

-- ---------- audit log (targeted key actions, durable, append-only) ----------
-- Written explicitly from specific call sites via src/lib/audit.ts — NOT a
-- generic mutation-log (deliberately not every table write, just sign-in/out,
-- integration connect/disconnect, and create/update/delete on the main
-- work-item tables) and NOT the notify_team_task_activity trigger below
-- (that's ephemeral read/dismiss notifications; this is a durable record).
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

-- ================= Row Level Security =================
do $$
declare t text;
begin
  foreach t in array array['users','otp_codes','teams','team_members','team_invites','projects','tasks','tickets','events','notifications','time_entries','integrations','pg_servers','user_settings','break_logs','audit_log','provider_connections','mail_templates','scheduled_emails','mail_rules']
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- `otp_codes` holds verification codes — no client role gets a policy, so it's
-- reachable only from a Netlify function using the service-role key (which
-- bypasses RLS entirely).

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

-- Both of the below are called only from netlify/functions/teams.ts via the
-- service-role key, after that function has already done its own explicit
-- authorization checks — they just need to run their few statements as one
-- atomic unit (a Postgres function body is an implicit transaction), so a
-- mid-sequence failure can't leave membership/ownership half-updated.
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
grant execute on function public.transfer_team_ownership(uuid, uuid, uuid) to service_role;

-- `users` holds password_hash — no blanket policy. The one exception is
-- teammates' names/emails (below), which excludes password_hash via a
-- column-level revoke so a future policy mistake still can't leak it.
drop policy if exists "teammates are visible" on public.users;
create policy "teammates are visible" on public.users for select using (
  exists (
    select 1 from public.team_members mine
    join public.team_members theirs on theirs.team_id = mine.team_id
    where mine.user_id = auth.uid() and theirs.user_id = users.id
  )
);
revoke select (password_hash) on public.users from authenticated, anon;

-- generic owner policies (user_id = auth.uid()) for plain user-scoped tables
-- (tasks/projects are handled separately below since they're team-shareable)
do $$
declare t text;
begin
  foreach t in array array['tickets','events','notifications','time_entries','integrations','pg_servers','break_logs','provider_connections','mail_templates','scheduled_emails','mail_rules']
  loop
    execute format('drop policy if exists "owner all" on public.%I;', t);
    execute format(
      'create policy "owner all" on public.%I using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;

drop policy if exists "owner all" on public.user_settings;
create policy "owner all" on public.user_settings
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit_log is append-only by design: select + insert only, no update/delete
-- policy anywhere, so a row can never be edited or removed once written.
drop policy if exists "owner select" on public.audit_log;
create policy "owner select" on public.audit_log for select using (user_id = auth.uid());
drop policy if exists "owner insert" on public.audit_log;
create policy "owner insert" on public.audit_log for insert with check (user_id = auth.uid());
-- Team activity feed: a teammate can see any row explicitly logged against a
-- shared team (team_id set), not just their own — reuses is_team_member()
-- (defined above for team_members' own policy) since the same
-- self-referencing-lookup problem doesn't apply here (audit_log isn't the
-- table is_team_member queries).
drop policy if exists "select: team member" on public.audit_log;
create policy "select: team member" on public.audit_log for select using (
  team_id is not null and public.is_team_member(team_id, auth.uid())
);

-- ---- teams / team_members / team_invites: read-only from the client ----
-- Every write (create team, invite, accept, revoke, remove member, change
-- role, transfer ownership, leave) goes through netlify/functions/teams.ts,
-- which uses the service-role key and does its own explicit authorization
-- checks. That leaves exactly one file to audit for "can this request change
-- who's on a team" — no RLS rule here can ever be tricked into letting a user
-- self-insert a membership row.
drop policy if exists "select: member" on public.teams;
create policy "select: member" on public.teams for select using (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid())
);
-- Renaming is a single-column, non-cross-table update, so it's the one
-- exception that gets a direct RLS policy instead of a function round-trip.
drop policy if exists "update: owner or admin" on public.teams;
create policy "update: owner or admin" on public.teams for update using (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
) with check (
  exists (select 1 from public.team_members tm where tm.team_id = teams.id and tm.user_id = auth.uid() and tm.role in ('owner','admin'))
);
-- Deleting is a single statement and FK-cascade-safe (memberships/invites
-- cascade; shared tasks/projects fall back to personal via ON DELETE SET NULL).
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

-- ---- tasks / projects: owner, or member of the team they're shared with ----
-- Sharing is per-resource, not inherited — a task keeps its own team_id even
-- if its parent project is shared to a different (or no) team.
-- Spelled out literally per table rather than generated in a loop, so it's
-- trivial to eyeball and there's no dynamic-SQL step that could misfire.
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
-- A viewer can see everything shared to their team but can't create/share
-- into it — the membership check below excludes 'viewer' on purpose (not
-- just "any member"), unlike the select policy above.
create policy "insert: self, and only into your own team" on public.tasks for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin','member')
  ))
);
-- The `user_id = auth.uid()` branch of the WITH CHECK below also has to
-- re-verify real (non-viewer) membership in whatever team_id the row is
-- being pointed at — otherwise a user could set team_id to a team they
-- don't even belong to (their own row stays selectable to them, but becomes
-- visible to that other team's real members: a cross-tenant leak, not just
-- a viewer-role gap).
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
create policy "delete: creator or team owner/admin" on public.tasks for delete using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = tasks.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
);
-- user_id is otherwise indistinguishable, in a plain UPDATE ... WITH CHECK,
-- from "an admin re-sharing this row" — so make it immutable outright.
revoke update (user_id, id, created_at) on public.tasks from authenticated;

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
-- See the matching comment on tasks' insert policy — 'viewer' deliberately
-- excluded from the membership check here, unlike the select policy above.
create policy "insert: self, and only into your own team" on public.projects for insert with check (
  user_id = auth.uid()
  and (team_id is null or exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin','member')
  ))
);
-- See the matching comment on tasks' update policy re: the cross-tenant
-- team_id re-pointing gap this also closes.
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
create policy "delete: creator or team owner/admin" on public.projects for delete using (
  user_id = auth.uid()
  or (team_id is not null and exists (
    select 1 from public.team_members tm where tm.team_id = projects.team_id and tm.user_id = auth.uid() and tm.role in ('owner','admin')
  ))
);
revoke update (user_id, id, created_at) on public.projects from authenticated;

-- ================= team task-activity notifications =================
-- Fans a notification out to every OTHER member of a task's team when it's
-- added, shared, moved (status change), or otherwise edited. This has to run
-- server-side: notifications' own RLS only lets a user insert their own row
-- (user_id = auth.uid()), which is correct for everything else and is
-- exactly why a client-side "also notify my teammates" insert can't work — a
-- team member has no write access to someone else's notifications. A
-- SECURITY DEFINER trigger bypasses that for just this one fan-out, and
-- fires no matter which code path changes the row (not just today's UI).
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
      return NEW; -- nothing notification-worthy changed
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

-- ================= @mention notifications (project description) =================
-- Same SECURITY DEFINER fan-out pattern as notify_team_task_activity above —
-- a client-side "notify whoever I @mentioned" insert can't work for the same
-- reason (notifications' RLS only lets you insert your own row). Matching is
-- plain substring search on '@' || full_name (not regex — sidesteps escaping
-- full_name entirely), and only fires for a name that's newly present versus
-- OLD.description, so re-saving an unrelated edit doesn't re-notify. OLD is
-- only ever referenced when TG_OP = 'update' — referencing it unconditionally
-- would error on insert, when OLD isn't assigned.
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

-- realtime for notifications (optional)
alter publication supabase_realtime add table public.notifications;
-- realtime for the team activity feed (see src/lib/activity.ts)
alter publication supabase_realtime add table public.audit_log;

-- Atomic partial-update of a user's settings blob (see src/lib/settings.ts).
-- Runs as the caller (not security definer) so the existing "owner all" RLS
-- policy on user_settings still applies — this just replaces a client-side
-- fetch-merge-upsert (which two concurrent saves could race on) with a single
-- statement, so Postgres's own row lock serializes concurrent merges instead.
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
