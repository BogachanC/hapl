UPDATE public.content_titles
SET last_tmdb_sync_at = now() - interval '30 days'
WHERE id = '2e6969fe-e313-4b55-a5a3-1903b27ea45a';