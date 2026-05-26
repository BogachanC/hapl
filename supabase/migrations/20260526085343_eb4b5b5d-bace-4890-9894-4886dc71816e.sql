
ALTER TABLE public.catalog_dirty_titles
  ADD COLUMN IF NOT EXISTS processing_at timestamptz,
  ADD COLUMN IF NOT EXISTS processing_owner text;

CREATE INDEX IF NOT EXISTS catalog_dirty_titles_pending_idx
  ON public.catalog_dirty_titles (enqueued_at)
  WHERE processed_at IS NULL;

-- Atomic claim: pick up to p_limit pending dirty rows that are not currently
-- being processed by another consumer (no active processing within last 10 min)
-- and have not exhausted attempts. Marks them with processing_at/owner and
-- returns the claimed rows.
CREATE OR REPLACE FUNCTION public.claim_dirty_titles(p_limit int, p_owner text)
RETURNS TABLE (
  id uuid,
  title_id uuid,
  reason text,
  attempts int,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH cte AS (
    SELECT d.id
    FROM public.catalog_dirty_titles d
    WHERE d.processed_at IS NULL
      AND d.attempts < 5
      AND (d.processing_at IS NULL OR d.processing_at < now() - interval '10 minutes')
    ORDER BY d.enqueued_at ASC
    LIMIT GREATEST(1, p_limit)
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.catalog_dirty_titles d
     SET processing_at = now(),
         processing_owner = p_owner
    FROM cte
   WHERE d.id = cte.id
   RETURNING d.id, d.title_id, d.reason, d.attempts, d.metadata;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_dirty_titles(int, text) FROM public, anon, authenticated;
