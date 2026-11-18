-- Data API grants are explicit in this project. The Edge Function uses the
-- server-only service_role key for Telegram tables; browser roles stay denied.
grant select, insert, update, delete on public.telegram_links to service_role;
grant select, insert, update, delete on public.telegram_link_requests to service_role;
grant select, insert, update, delete on public.telegram_deliveries to service_role;
