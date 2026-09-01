-- Schedule hapl-healthcheck to run once daily at 05:00 UTC, after the last
-- existing job (hapl-deliver at 04:15). Checks catalog_job_runs for staleness,
-- failure regression, and backlog across all three pipeline jobs.
--
-- Uses timeout_milliseconds = 30000 (30s) instead of pg_net's 5s default.
-- The healthcheck queries catalog_job_runs + availability_changes and may
-- send an email via Resend — 5s is too tight. The function itself is lightweight
-- but we want to avoid the same timed_out=true noise that affects the other jobs.

DO $$
BEGIN
  PERFORM cron.unschedule('hapl-healthcheck-daily');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'hapl-healthcheck-daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://lgtlpfkvsbnyxxwhdaad.supabase.co/functions/v1/hapl-healthcheck',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_hapl_sync_token()
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
