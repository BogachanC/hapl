DELETE FROM public.content_availability
WHERE title_id = '2e6969fe-e313-4b55-a5a3-1903b27ea45a'
  AND provider_id = '49a9d8a5-1d66-4a1f-91c2-613518a1cae5'
  AND raw_payload @> '{"test":"stale-flip-fixture"}'::jsonb;

DELETE FROM public.search_cache WHERE cache_key IN ('hapl:elite');