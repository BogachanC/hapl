-- Phase 4 final verification: prove same (title, provider, availability_type, region)
-- row gets UPSERTED (not duplicated) when source flips firecrawl -> tmdb.
-- We mutate one known row to source=firecrawl/confidence=0.55, then trigger
-- hapl-refresh; the unique key (title_id, provider_id, region, availability_type)
-- ensures the same id is updated in place.
UPDATE public.content_availability
SET source = 'firecrawl',
    confidence = 0.55,
    checked_at = now() - interval '10 days',
    last_seen_at = now() - interval '10 days'
WHERE id = '1c3109d3-2a03-43de-8ede-7f9fea7f5f93';