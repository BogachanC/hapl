-- Codify the existing hapl-refresh pg_cron schedule into the migration history.
-- This job was manually created in the Supabase dashboard and confirmed live
-- via `SELECT * FROM cron.job` during M2 diagnostics (2026-07-03). No schedule
-- change — this captures the exact live configuration so it survives DB rebuild.

DO $$
BEGIN
  -- Remove existing job if present (idempotent: safe to run against the live DB
  -- that already has this job, or against a fresh DB that doesn't).
  PERFORM cron.unschedule('hapl-refresh-twice-daily');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'hapl-refresh-twice-daily',
  '15 3,15 * * *',
  $$
  select net.http_post(
    url := 'https://lgtlpfkvsbnyxxwhdaad.supabase.co/functions/v1/hapl-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_hapl_sync_token()
    ),
    body := jsonb_build_object('batch', 50)
  );
  $$
);
