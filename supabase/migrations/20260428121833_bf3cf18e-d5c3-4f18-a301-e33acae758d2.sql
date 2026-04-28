-- Enable Firecrawl fallback for major + select TR providers
UPDATE public.streaming_providers
SET firecrawl_enabled = true
WHERE slug IN ('max', 'tabii', 'puhutv', 'gain', 'mubi', 'netflix', 'amazon-prime-video', 'disney-plus');

-- Disable Firecrawl fallback for fragile/TR-niche providers
UPDATE public.streaming_providers
SET firecrawl_enabled = false
WHERE slug IN ('tv-plus', 'exxen', 'tod-tv', 'bein-connect');