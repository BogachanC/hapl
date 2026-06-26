
-- 1) Make tmdb_id nullable (allows manual content without a TMDB match)
ALTER TABLE public.content_titles ALTER COLUMN tmdb_id DROP NOT NULL;

-- 2) Add source column (existing rows default to 'tmdb')
ALTER TABLE public.content_titles
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'tmdb';

-- 3) CHECK constraint on source
ALTER TABLE public.content_titles
  DROP CONSTRAINT IF EXISTS content_titles_source_check;
ALTER TABLE public.content_titles
  ADD CONSTRAINT content_titles_source_check
  CHECK (source = ANY (ARRAY['tmdb'::text, 'manual'::text]));
