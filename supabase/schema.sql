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

-- ---------- projects ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
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
  created_at timestamptz not null default now()
);

-- ---------- tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
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
  created_at timestamptz not null default now()
);

-- ---------- notifications ----------
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'system',
  title text not null,
  body text,
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
  updated_at timestamptz not null default now()
);

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

-- ================= Row Level Security =================
do $$
declare t text;
begin
  foreach t in array array['users','otp_codes','projects','tasks','tickets','events','notifications','time_entries','integrations','user_settings','break_logs']
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- `users` and `otp_codes` hold password hashes / verification codes — no client
-- role (anon or authenticated) gets a policy, so they're reachable only from a
-- Netlify function using the service-role key (which bypasses RLS entirely).

-- generic owner policies (user_id = auth.uid()) for user-scoped tables
do $$
declare t text;
begin
  foreach t in array array['projects','tasks','tickets','events','notifications','time_entries','integrations','break_logs']
  loop
    execute format('drop policy if exists "owner all" on public.%I;', t);
    execute format(
      'create policy "owner all" on public.%I using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;

drop policy if exists "owner all" on public.user_settings;
create policy "owner all" on public.user_settings
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- realtime for notifications (optional)
alter publication supabase_realtime add table public.notifications;
