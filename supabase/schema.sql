-- ORBIT — Supabase schema (Postgres). Run in Supabase SQL editor.
-- Every table is scoped to the signed-in user via Row Level Security.

-- ---------- profiles ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

-- create a profile row automatically on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''));
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- projects ----------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  created_at timestamptz not null default now()
);

-- ---------- tasks ----------
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
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
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null default 'system',
  title text not null,
  body text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- time entries ----------
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid references public.projects(id) on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  seconds int not null default 0,
  created_at timestamptz not null default now()
);

-- ---------- integrations ----------
create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  connected boolean not null default false,
  config jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

-- ================= Row Level Security =================
do $$
declare t text;
begin
  foreach t in array array['profiles','projects','tasks','tickets','events','notifications','time_entries','integrations']
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- profiles: owner is the row id
drop policy if exists "profiles owner" on public.profiles;
create policy "profiles owner" on public.profiles
  using (id = auth.uid()) with check (id = auth.uid());

-- generic owner policies (user_id = auth.uid()) for the rest
do $$
declare t text;
begin
  foreach t in array array['projects','tasks','tickets','events','notifications','time_entries','integrations']
  loop
    execute format('drop policy if exists "owner all" on public.%I;', t);
    execute format(
      'create policy "owner all" on public.%I using (user_id = auth.uid()) with check (user_id = auth.uid());', t);
  end loop;
end $$;

-- realtime for notifications (optional)
alter publication supabase_realtime add table public.notifications;
