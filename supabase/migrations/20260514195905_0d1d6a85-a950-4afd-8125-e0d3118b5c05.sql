ALTER TABLE public.search_events ADD COLUMN IF NOT EXISTS mode text;
DELETE FROM public.search_cache;