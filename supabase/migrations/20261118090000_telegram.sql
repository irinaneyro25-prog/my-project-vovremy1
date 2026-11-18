begin;

create table public.telegram_links (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  chat_id bigint not null unique,
  privacy text not null default 'neutral' check (privacy in ('neutral', 'title')),
  active boolean not null default true,
  linked_at timestamptz not null default now()
);

create table public.telegram_link_requests (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null
);

create table public.telegram_deliveries (
  owner_id uuid not null,
  task_id uuid not null,
  start_at timestamptz not null,
  offset_minutes integer not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'retry', 'sent', 'cancelled', 'failed')),
  attempts integer not null default 0,
  claimed_at timestamptz,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  last_error text,
  primary key (owner_id, task_id, start_at, offset_minutes),
  foreign key (owner_id, task_id)
    references public.planner_tasks(owner_id, id) on delete cascade
);

create index telegram_deliveries_ready on public.telegram_deliveries(next_attempt_at)
  where status in ('pending', 'retry', 'sending');

create function public.cancel_changed_telegram_deliveries()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.start_at is distinct from new.start_at
    or old.status is distinct from new.status
    or old.reminders is distinct from new.reminders then
    update public.telegram_deliveries
    set status = 'cancelled'
    where owner_id = new.owner_id and task_id = new.id
      and status in ('pending', 'retry', 'sending');
  end if;
  return new;
end;
$$;

create trigger planner_tasks_cancel_old_telegram
after update of start_at, status, reminders on public.planner_tasks
for each row execute function public.cancel_changed_telegram_deliveries();

alter table public.telegram_links enable row level security;
alter table public.telegram_link_requests enable row level security;
alter table public.telegram_deliveries enable row level security;
revoke all on public.telegram_links, public.telegram_link_requests, public.telegram_deliveries
  from public, anon, authenticated;

create function public.consume_telegram_link(request_hash text, telegram_chat bigint)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare linked_owner uuid;
begin
  delete from public.telegram_link_requests
  where code_hash = request_hash and expires_at > now()
  returning owner_id into linked_owner;
  if linked_owner is null then return false; end if;
  insert into public.telegram_links(owner_id, chat_id)
  values (linked_owner, telegram_chat)
  on conflict (owner_id) do update
    set chat_id = excluded.chat_id, active = true, linked_at = now();
  return true;
end;
$$;

create function public.claim_telegram_deliveries(batch_size integer default 20)
returns setof public.telegram_deliveries
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.telegram_deliveries(owner_id, task_id, start_at, offset_minutes)
  select distinct t.owner_id, t.id, t.start_at, offset_value.minutes
  from public.planner_tasks t
  join public.telegram_links l on l.owner_id = t.owner_id and l.active
  cross join lateral unnest(t.reminders) as offset_value(minutes)
  where t.status in ('planned', 'in_progress')
    and t.start_at - make_interval(mins => offset_value.minutes) <= now()
    and t.start_at - make_interval(mins => offset_value.minutes) > now() - interval '1 day'
  on conflict (owner_id, task_id, start_at, offset_minutes) do update
    set status = 'pending', attempts = 0, claimed_at = null,
        next_attempt_at = now(), last_error = null
    where public.telegram_deliveries.status = 'cancelled';

  return query
  with candidates as (
    select d.owner_id, d.task_id, d.start_at, d.offset_minutes
    from public.telegram_deliveries d
    join public.planner_tasks t on t.owner_id = d.owner_id and t.id = d.task_id
    join public.telegram_links l on l.owner_id = d.owner_id and l.active
    where d.attempts < 5
      and (d.status in ('pending', 'retry')
        or (d.status = 'sending' and d.claimed_at < now() - interval '2 minutes'))
      and d.next_attempt_at <= now()
      and t.status in ('planned', 'in_progress')
      and t.start_at = d.start_at
      and d.offset_minutes = any(t.reminders)
    order by d.next_attempt_at
    for update of d skip locked
    limit least(greatest(batch_size, 1), 100)
  )
  update public.telegram_deliveries d
  set status = 'sending', attempts = d.attempts + 1, claimed_at = now()
  from candidates c
  where (d.owner_id, d.task_id, d.start_at, d.offset_minutes) =
    (c.owner_id, c.task_id, c.start_at, c.offset_minutes)
  returning d.*;
end;
$$;

revoke all on function public.consume_telegram_link(text, bigint) from public, anon, authenticated;
revoke all on function public.claim_telegram_deliveries(integer) from public, anon, authenticated;
revoke all on function public.cancel_changed_telegram_deliveries() from public, anon, authenticated;
grant execute on function public.consume_telegram_link(text, bigint) to service_role;
grant execute on function public.claim_telegram_deliveries(integer) to service_role;

commit;
