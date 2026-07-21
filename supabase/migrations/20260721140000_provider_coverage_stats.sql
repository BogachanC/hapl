-- provider_coverage_stats: per-provider eligible row counts for the
-- subscription audit data-sufficiency gate. Returns ~12 rows instead
-- of forcing the client to fetch and count all availability rows.

CREATE VIEW public.provider_coverage_stats
WITH (security_invoker = true) AS
SELECT provider_id, count(*)::int AS eligible_rows
FROM public.content_availability
WHERE region = 'TR'
  AND status = 'available'
  AND availability_type IN ('stream', 'free', 'ads')
  AND confidence >= 0.5
GROUP BY provider_id;
