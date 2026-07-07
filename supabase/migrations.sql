-- Run this in the Supabase SQL editor if your projects table already exists
-- (adds the Zoho Sprints link columns without recreating the table).
alter table public.projects add column if not exists sprint_project_id text;
alter table public.projects add column if not exists sprint_project_name text;

-- Per-user integration credentials (Zoho + Gmail), replacing env-only config.
create table if not exists public.integrations (
  user_id uuid primary key references auth.users(id) on delete cascade,
  zoho_client_id text, zoho_client_secret text, zoho_refresh_token text,
  zoho_dc text default 'in', zoho_team_id text, zoho_project_id text,
  gmail_user text, gmail_app_password text,
  updated_at timestamptz default now()
);
alter table public.integrations enable row level security;
do $$ begin
  create policy "own integrations" on public.integrations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
exception when duplicate_object then null; end $$;
