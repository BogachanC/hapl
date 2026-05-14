CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_content_titles_norm_trgm
  ON public.content_titles USING gin (normalized_title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_content_title_aliases_norm_trgm
  ON public.content_title_aliases USING gin (normalized_alias gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_content_titles_norm
  ON public.content_titles (normalized_title);

CREATE INDEX IF NOT EXISTS idx_content_title_aliases_norm
  ON public.content_title_aliases (normalized_alias);

CREATE INDEX IF NOT EXISTS idx_content_availability_title_status
  ON public.content_availability (title_id, status);

CREATE INDEX IF NOT EXISTS idx_content_availability_provider_status
  ON public.content_availability (provider_id, status);

CREATE TABLE IF NOT EXISTS public.search_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  raw_query text NOT NULL,
  normalized_query text NOT NULL,
  result_count integer NOT NULL DEFAULT 0,
  top_result_tmdb_id bigint,
  top_result_title text,
  selected_category text,
  selected_provider text,
  source text NOT NULL CHECK (source IN ('db','tmdb_fallback','mixed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_search_events_created_at
  ON public.search_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_events_normalized
  ON public.search_events (normalized_query);

ALTER TABLE public.search_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert search events"
  ON public.search_events FOR INSERT TO public WITH CHECK (true);

CREATE POLICY "Admins can read search events"
  ON public.search_events FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));