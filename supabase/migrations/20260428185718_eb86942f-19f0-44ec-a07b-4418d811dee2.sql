-- Scalable alias cache for TMDB-derived multilingual titles
CREATE TABLE public.content_title_aliases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tmdb_id BIGINT NOT NULL,
  tmdb_type TEXT NOT NULL CHECK (tmdb_type IN ('movie', 'tv')),
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('tmdb_alt_title', 'tmdb_translation', 'tmdb_original', 'tmdb_canonical', 'manual')),
  language TEXT,
  country TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (tmdb_id, tmdb_type, normalized_alias, source)
);

CREATE INDEX idx_content_title_aliases_normalized ON public.content_title_aliases (normalized_alias);
CREATE INDEX idx_content_title_aliases_tmdb ON public.content_title_aliases (tmdb_id, tmdb_type);
CREATE INDEX idx_content_title_aliases_updated ON public.content_title_aliases (updated_at);

ALTER TABLE public.content_title_aliases ENABLE ROW LEVEL SECURITY;

-- Public read (search-content edge function uses anon key)
CREATE POLICY "content_title_aliases readable by everyone"
ON public.content_title_aliases FOR SELECT
USING (true);

-- Public insert/update for lazy hydration from edge functions (anon role)
CREATE POLICY "Anyone can insert content_title_aliases"
ON public.content_title_aliases FOR INSERT
WITH CHECK (true);

CREATE POLICY "Anyone can update content_title_aliases"
ON public.content_title_aliases FOR UPDATE
USING (true) WITH CHECK (true);

CREATE TRIGGER update_content_title_aliases_updated_at
BEFORE UPDATE ON public.content_title_aliases
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();