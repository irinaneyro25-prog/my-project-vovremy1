begin;
do $$
begin
  if has_table_privilege('anon', 'public.telegram_links', 'SELECT')
    or has_table_privilege('authenticated', 'public.telegram_links', 'SELECT')
    or has_table_privilege('authenticated', 'public.telegram_deliveries', 'SELECT')
    or has_function_privilege('authenticated', 'public.claim_telegram_deliveries(integer)', 'EXECUTE')
  then raise exception 'Telegram internals are visible to the browser'; end if;
end;
$$;
insert into auth.users(id) values ('b8ad3570-3e7d-4b45-9367-ba3080c1e1a1');
insert into public.planner_tasks(owner_id, id, title, start_at, reminders)
values ('b8ad3570-3e7d-4b45-9367-ba3080c1e1a1',
  '912c1292-691e-4eb3-abf0-1658aa8407b1', 'Встреча',
  now() + interval '5 minutes', array[5]);
insert into public.telegram_links(owner_id, chat_id)
values ('b8ad3570-3e7d-4b45-9367-ba3080c1e1a1', 123456);

do $$
begin
  if (select count(*) from public.claim_telegram_deliveries(20)) <> 1 then
    raise exception 'First due reminder was not claimed';
  end if;
  if (select count(*) from public.claim_telegram_deliveries(20)) <> 0 then
    raise exception 'Reminder was claimed twice concurrently';
  end if;
end;
$$;

update public.planner_tasks set status = 'done';
do $$
begin
  if not exists (select 1 from public.telegram_deliveries where status = 'cancelled') then
    raise exception 'Completion did not cancel the claimed reminder';
  end if;
  if (select count(*) from public.claim_telegram_deliveries(20)) <> 0 then
    raise exception 'Completed task was claimed again';
  end if;
end;
$$;

update public.planner_tasks
set status = 'planned', start_at = now() + interval '5 minutes 1 second';
do $$
begin
  if (select count(*) from public.claim_telegram_deliveries(20)) <> 0 then
    raise exception 'Postponed task was claimed at its old time';
  end if;
end;
$$;
rollback;
