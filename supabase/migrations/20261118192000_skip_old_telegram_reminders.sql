-- Do not send a reminder whose time had already passed when a task was
-- created or imported. A two-minute window allows normal cron delay.
-- Existing delivery rows can still retry transient send failures.
begin;

create or replace function public.skip_old_telegram_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.start_at <= now()
    or new.start_at - make_interval(mins => new.offset_minutes)
       < now() - interval '2 minutes' then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.skip_old_telegram_delivery() from public, anon, authenticated;

drop trigger if exists telegram_deliveries_skip_old on public.telegram_deliveries;
create trigger telegram_deliveries_skip_old
before insert on public.telegram_deliveries
for each row execute function public.skip_old_telegram_delivery();

commit;
