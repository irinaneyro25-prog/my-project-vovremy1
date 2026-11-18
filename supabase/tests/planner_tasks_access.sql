-- Execute as the database administrator against a disposable database.
begin;

insert into auth.users (id) values
  ('b8ad3570-3e7d-4b45-9367-ba3080c1e1a1'),
  ('b8ad3570-3e7d-4b45-9367-ba3080c1e1a2');

set local role anon;
do $$
begin
  if has_table_privilege('public.planner_tasks', 'SELECT, INSERT, UPDATE, DELETE')
     or has_any_column_privilege('public.planner_tasks', 'SELECT, INSERT, UPDATE') then
    raise exception 'Anonymous role has task privileges';
  end if;
end;
$$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a1', true);
insert into public.planner_tasks (id, title, start_at)
values ('912c1292-691e-4eb3-abf0-1658aa8407b1', 'Task A', '2026-11-18T15:00:00Z');

select set_config('request.jwt.claim.sub', 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a2', true);
do $$
begin
  if exists (select 1 from public.planner_tasks where title = 'Task A') then
    raise exception 'Account B can read the task of A';
  end if;
  update public.planner_tasks set title = 'Hijacked' where title = 'Task A';
  if found then raise exception 'Account B can edit the task of A'; end if;
  delete from public.planner_tasks where title = 'Task A';
  if found then raise exception 'Account B can delete the task of A'; end if;

  begin
    insert into public.planner_tasks (owner_id, title, start_at)
    values ('b8ad3570-3e7d-4b45-9367-ba3080c1e1a1', 'Impersonation', now());
    raise exception 'Account B can create a task for A';
  exception when insufficient_privilege then
    null;
  end;
end;
$$;

insert into public.planner_tasks (id, title, start_at)
values ('912c1292-691e-4eb3-abf0-1658aa8407b1', 'Imported task B', '2026-11-18T15:00:00Z')
on conflict (owner_id, id) do nothing;
insert into public.planner_tasks (id, title, start_at)
values ('912c1292-691e-4eb3-abf0-1658aa8407b1', 'Duplicate', '2026-11-18T15:00:00Z')
on conflict (owner_id, id) do nothing;

do $$
begin
  if (select count(*) from public.planner_tasks) <> 1
     or not exists (select 1 from public.planner_tasks where title = 'Imported task B') then
    raise exception 'Repeated import altered the task or produced duplicates';
  end if;
  update public.planner_tasks set status = 'done' where title = 'Imported task B';
  if not found then raise exception 'Account B cannot complete its task'; end if;
  begin
    update public.planner_tasks set owner_id = 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a1'
    where title = 'Imported task B';
    raise exception 'Account B can transfer ownership';
  exception when insufficient_privilege then
    null;
  end;
  delete from public.planner_tasks where title = 'Imported task B';
  if not found then raise exception 'Account B cannot delete its task'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', 'b8ad3570-3e7d-4b45-9367-ba3080c1e1a1', true);
do $$
begin
  if (select count(*) from public.planner_tasks) <> 1
     or not exists (select 1 from public.planner_tasks where title = 'Task A' and status = 'planned') then
    raise exception 'Account A lost access or its task was modified';
  end if;
end;
$$;

rollback;
