-- Применять после развёртывания Edge Function telegram и сохранения
-- TELEGRAM_JOB_KEY также в Supabase Vault под именем vovremya_telegram_job_key.
-- Никаких значений секретов в этом файле нет.
select cron.schedule(
  'vovremya-telegram-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://sxmaumiqmujgjzelxdrz.supabase.co/functions/v1/telegram/run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-job-key', (select decrypted_secret
                    from vault.decrypted_secrets
                    where name = 'vovremya_telegram_job_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
