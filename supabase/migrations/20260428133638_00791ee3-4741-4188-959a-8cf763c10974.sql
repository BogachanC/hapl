DELETE FROM public.search_cache WHERE cache_key IN ('hapl:elite');

INSERT INTO public.content_availability
  (title_id, provider_id, region, availability_type, status, source, source_url,
   confidence, last_seen_at, checked_at, created_at, updated_at, raw_payload)
VALUES
  ('2e6969fe-e313-4b55-a5a3-1903b27ea45a',
   '49a9d8a5-1d66-4a1f-91c2-613518a1cae5',
   'TR', 'stream', 'available', 'tmdb', NULL,
   0.9,
   now() - interval '10 days',
   now() - interval '10 days',
   now() - interval '10 days',
   now() - interval '10 days',
   '{"test":"stale-flip-fixture"}'::jsonb)
ON CONFLICT (title_id, provider_id, region, availability_type) DO UPDATE
  SET status = 'available',
      checked_at = now() - interval '10 days',
      last_seen_at = now() - interval '10 days',
      updated_at = now() - interval '10 days',
      confidence = 0.9,
      raw_payload = '{"test":"stale-flip-fixture"}'::jsonb;