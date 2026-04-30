UPDATE public.content_availability
SET status = 'unavailable',
    confidence = 0.0,
    checked_at = now(),
    raw_payload = jsonb_build_object(
      'invalidated_reason', 'firecrawl_no_evidence',
      'invalidated_at', now()
    )
WHERE source = 'firecrawl'
  AND source_url IS NULL
  AND raw_payload = '{}'::jsonb
  AND status = 'available';