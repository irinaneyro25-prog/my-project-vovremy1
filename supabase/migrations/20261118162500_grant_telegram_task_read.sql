-- The Telegram Edge Function checks the current task through the Data API
-- before sending. Its server-only role needs explicit read access because
-- automatic Data API grants are disabled for this project.
grant select on public.planner_tasks to service_role;
