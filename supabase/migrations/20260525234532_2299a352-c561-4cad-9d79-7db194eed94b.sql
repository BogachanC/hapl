
-- catalog_dirty_titles: queue of titles whose downstream caches (Meili, search_cache)
-- need refresh. Faz 1 only populates; consumer comes in Faz 3.
CREATE TABLE IF NOT EXISTS public.catalog_dirty_titles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id        uuid NOT NULL REFERENCES public.content_titles(id) ON DELETE CASCADE,
  reason          text NOT NULL,
  source_job_id   uuid,
  enqueued_at     timestamptz NOT NULL DEFAULT now(),
  processed_at    timestamptz,
  attempts        integer NOT NULL DEFAULT 0,
  last_error      text,
  metadata        jsonb
);

-- Idempotency: at most one OPEN dirty row per title.
CREATE UNIQUE INDEX IF NOT EXISTS catalog_dirty_titles_open_unique
  ON public.catalog_dirty_titles (title_id)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS catalog_dirty_titles_open_enqueued_idx
  ON public.catalog_dirty_titles (enqueued_at)
  WHERE processed_at IS NULL;

ALTER TABLE public.catalog_dirty_titles ENABLE ROW LEVEL SECURITY;

-- Admin-only read; writes happen via service role (edge functions) only.
CREATE POLICY "Admins can view catalog_dirty_titles"
  ON public.catalog_dirty_titles
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
