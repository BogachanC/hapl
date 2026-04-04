CREATE TABLE public.search_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key text NOT NULL UNIQUE,
  results jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Search cache is readable by everyone"
  ON public.search_cache FOR SELECT TO public
  USING (true);

CREATE POLICY "Anyone can insert search cache"
  ON public.search_cache FOR INSERT TO public
  WITH CHECK (true);

CREATE POLICY "Anyone can delete search cache"
  ON public.search_cache FOR DELETE TO public
  USING (true);