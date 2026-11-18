begin;

create table public.planner_tasks (
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  id uuid not null default gen_random_uuid(),
  title text not null check (length(btrim(title)) > 0),
  description text,
  start_at timestamptz not null,
  end_at timestamptz,
  timezone text not null default 'Europe/Moscow',
  location text,
  category text not null default 'Другое',
  priority integer not null default 3 check (priority between 1 and 5),
  recurrence_rule text,
  recurrence_parent_id uuid,
  recurrence_until timestamptz,
  reminders integer[] not null default '{60}'
    check (array_position(reminders, null) is null
           and (cardinality(reminders) = 0 or (1 <= all(reminders) and 10080 >= all(reminders)))),
  status text not null default 'planned'
    check (status in ('planned', 'in_progress', 'done', 'cancelled')),
  postponed_count integer not null default 0 check (postponed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index planner_tasks_owner_start on public.planner_tasks (owner_id, start_at);

alter table public.planner_tasks enable row level security;
revoke all on public.planner_tasks from public, anon, authenticated;
grant select, insert, delete on public.planner_tasks to authenticated;
grant update (
  title, description, start_at, end_at, timezone, location, category,
  priority, recurrence_rule, recurrence_parent_id, recurrence_until,
  reminders, status, postponed_count
) on public.planner_tasks to authenticated;

create policy planner_tasks_read_own on public.planner_tasks for select to authenticated
  using ((select auth.uid()) = owner_id);
create policy planner_tasks_insert_own on public.planner_tasks for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy planner_tasks_update_own on public.planner_tasks for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy planner_tasks_delete_own on public.planner_tasks for delete to authenticated
  using ((select auth.uid()) = owner_id);

create function public.planner_touch_task()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.planner_touch_task() from public, anon, authenticated;

create trigger planner_tasks_touch
before update on public.planner_tasks
for each row execute function public.planner_touch_task();

commit;
