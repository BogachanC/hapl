-- Idempotent unique constraints used by search-content upserts
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_titles_tmdb_unique'
  ) THEN
    ALTER TABLE public.content_titles
      ADD CONSTRAINT content_titles_tmdb_unique UNIQUE (tmdb_id, tmdb_type);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'content_availability_unique'
  ) THEN
    ALTER TABLE public.content_availability
      ADD CONSTRAINT content_availability_unique
      UNIQUE (title_id, provider_id, region, availability_type);
  END IF;
END $$;