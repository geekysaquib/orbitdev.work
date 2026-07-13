-- ORBIT — notify every team member when a shared task is added, shared,
-- moved (status change), or otherwise edited. Safe to run against the live
-- DB, and safe to re-run (CREATE OR REPLACE FUNCTION / DROP TRIGGER IF
-- EXISTS before every CREATE). Requires supabase/add_teams.sql to already
-- be applied (needs the `tasks.team_id` column and `team_members` table).
--
-- This has to run server-side: notifications' own RLS only lets a user
-- insert their own row (user_id = auth.uid()), which is correct for normal
-- use and is exactly why a client-side "also notify my teammates" insert
-- can't work — a team member has no write access to someone else's
-- notifications. A SECURITY DEFINER trigger bypasses that for just this one
-- fan-out, and fires no matter which code path changes the row.

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
