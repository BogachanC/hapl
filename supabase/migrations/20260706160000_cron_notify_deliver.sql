-- Schedule hapl-notify and hapl-deliver to run after hapl-refresh, completing
-- the M2 notification pipeline automation:
--
--   03:15 / 15:15  hapl-refresh   (writes availability_changes)
--   03:45 / 15:45  hapl-notify    (matches changes → pending_notifications)
--   04:15 / 16:15  hapl-deliver   (sends emails via Resend, marks sent_at)
--
-- Each job is offset by 30 min so the previous step has time to finish.
-- Auth uses the same get_hapl_sync_token() pattern as the existing refresh job.

-- ── hapl-notify ──────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('hapl-notify-twice-daily');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'hapl-notify-twice-daily',
  '45 3,15 * * *',
  $$
  select net.http_post(
    url := 'https://lgtlpfkvsbnyxxwhdaad.supabase.co/functions/v1/hapl-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_hapl_sync_token()
    ),
    body := jsonb_build_object('batch', 200)
  );
  $$
);

-- ── hapl-deliver ─────────────────────────────────────────────────────────

DO $$
BEGIN
  PERFORM cron.unschedule('hapl-deliver-twice-daily');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$$;

SELECT cron.schedule(
  'hapl-deliver-twice-daily',
  '15 4,16 * * *',
  $$
  select net.http_post(
    url := 'https://lgtlpfkvsbnyxxwhdaad.supabase.co/functions/v1/hapl-deliver',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || public.get_hapl_sync_token()
    ),
    body := jsonb_build_object('batch', 100)
  );
  $$
);
