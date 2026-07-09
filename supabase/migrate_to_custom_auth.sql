-- ORBIT — migrate an EXISTING project off Supabase Auth onto the custom
-- OTP-based auth (netlify/functions/auth.ts). Run once in the Supabase SQL
-- editor, top to bottom. Safe to re-run (every step is idempotent).
--
-- What this does:
--   1. Creates public.users + public.otp_codes (and user_settings/break_logs,
--      previously undocumented tables the app already reads/writes to).
--   2. Copies every existing auth.users row into public.users, reusing the
--      SAME id and the SAME bcrypt password hash Supabase Auth already stored
--      — so everyone can sign in with their current password immediately,
--      no reset required. Anyone already confirmed is marked email_verified.
--   3. Repoints every user_id/id foreign key from auth.users to public.users
--      so all existing projects/tasks/tickets/etc. survive untouched.
--   4. Drops the old handle_new_user trigger and the now-redundant `profiles`
--      table (full_name now lives on public.users).
--
-- After this runs, nothing in the app calls supabase.auth.* anymore — do NOT
-- delete the real auth.users rows (harmless leftovers) unless you're certain
-- nothing else in your Supabase project depends on them.

-- ---------- 1. new tables ----------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  full_name text not null default '',
  email_verified boolean not null default false,
  created_at timestamptz not null default now()
);

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

create table if not exists public.user_settings (
  user_id uuid primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.break_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  seconds int not null default 0,
  beverage text,
  rows jsonb not null default '[]'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- 2. carry Supabase Auth users over, id-for-id ----------
insert into public.users (id, email, password_hash, full_name, email_verified, created_at)
select
  u.id,
  u.email,
  u.encrypted_password,                              -- already a bcrypt hash — portable as-is
  coalesce(p.full_name, u.raw_user_meta_data->>'full_name', ''),
  (u.email_confirmed_at is not null),
  u.created_at
from auth.users u
left join public.profiles p on p.id = u.id
on conflict (id) do nothing;

-- ---------- 3. repoint foreign keys onto public.users ----------
do $$
declare t text;
begin
  foreach t in array array['projects','tasks','tickets','events','notifications','time_entries','integrations']
  loop
    execute format('alter table public.%I drop constraint if exists %I;', t, t || '_user_id_fkey');
    execute format(
      'alter table public.%I add constraint %I foreign key (user_id) references public.users(id) on delete cascade;',
      t, t || '_user_id_fkey');
  end loop;
end $$;

alter table public.user_settings drop constraint if exists user_settings_user_id_fkey;
alter table public.user_settings add constraint user_settings_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

alter table public.break_logs drop constraint if exists break_logs_user_id_fkey;
alter table public.break_logs add constraint break_logs_user_id_fkey
  foreign key (user_id) references public.users(id) on delete cascade;

-- ---------- 4. retire the old Supabase-Auth-driven bits ----------
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.profiles;

-- ---------- 5. RLS ----------
do $$
declare t text;
begin
  foreach t in array array['users','otp_codes','projects','tasks','tickets','events','notifications','time_entries','integrations','user_settings','break_logs']
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- users / otp_codes: no client-facing policy — service-role (Netlify functions) only.

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

do $$
begin
  alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;

-- ---------- done ----------
-- Everyone who had a confirmed Supabase Auth account can sign in right now
-- with their existing password. Anyone who was mid-signup (unconfirmed) will
-- need to sign up again — their old auth.users row never makes it into
-- public.users with email_verified = true, so ORBIT will ask them to verify.
