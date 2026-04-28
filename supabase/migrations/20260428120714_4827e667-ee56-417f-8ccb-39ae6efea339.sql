
-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- streaming_providers
-- ============================================================
CREATE TABLE public.streaming_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  display_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  tmdb_names text[] NOT NULL DEFAULT '{}',
  domains text[] NOT NULL DEFAULT '{}',
  firecrawl_enabled boolean NOT NULL DEFAULT false,
  firecrawl_priority integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.streaming_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "streaming_providers readable by everyone"
  ON public.streaming_providers FOR SELECT USING (true);

CREATE TRIGGER trg_streaming_providers_updated_at
  BEFORE UPDATE ON public.streaming_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- content_titles
-- ============================================================
CREATE TABLE public.content_titles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tmdb_id bigint NOT NULL,
  tmdb_type text NOT NULL CHECK (tmdb_type IN ('movie','tv')),
  title text NOT NULL,
  original_title text,
  normalized_title text,
  search_aliases text[] NOT NULL DEFAULT '{}',
  release_year integer,
  first_release_date date,
  poster_path text,
  backdrop_path text,
  overview text,
  genres text[] NOT NULL DEFAULT '{}',
  content_kind text CHECK (content_kind IN ('movie','series','documentary','reality')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_tmdb_sync_at timestamptz,
  last_full_sync_at timestamptz,
  last_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tmdb_id, tmdb_type)
);

ALTER TABLE public.content_titles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_titles readable by everyone"
  ON public.content_titles FOR SELECT USING (true);

CREATE TRIGGER trg_content_titles_updated_at
  BEFORE UPDATE ON public.content_titles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_content_titles_title_trgm
  ON public.content_titles USING gin (title gin_trgm_ops);
CREATE INDEX idx_content_titles_original_title_trgm
  ON public.content_titles USING gin (original_title gin_trgm_ops);
CREATE INDEX idx_content_titles_normalized_title_trgm
  ON public.content_titles USING gin (normalized_title gin_trgm_ops);
CREATE INDEX idx_content_titles_last_requested_at
  ON public.content_titles (last_requested_at DESC NULLS LAST);
CREATE INDEX idx_content_titles_last_full_sync_at
  ON public.content_titles (last_full_sync_at DESC NULLS LAST);
CREATE INDEX idx_content_titles_kind ON public.content_titles (content_kind);
CREATE INDEX idx_content_titles_year ON public.content_titles (release_year);

-- ============================================================
-- content_availability
-- ============================================================
CREATE TABLE public.content_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id uuid NOT NULL REFERENCES public.content_titles(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  region text NOT NULL DEFAULT 'TR',
  availability_type text NOT NULL DEFAULT 'stream',
  status text NOT NULL CHECK (status IN ('available','unavailable','unknown')),
  source text NOT NULL CHECK (source IN ('tmdb','firecrawl','manual')),
  source_url text,
  confidence numeric NOT NULL DEFAULT 0.5,
  checked_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  expires_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (title_id, provider_id, region, availability_type)
);

ALTER TABLE public.content_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_availability readable by everyone"
  ON public.content_availability FOR SELECT USING (true);

CREATE TRIGGER trg_content_availability_updated_at
  BEFORE UPDATE ON public.content_availability
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_content_availability_title ON public.content_availability (title_id);
CREATE INDEX idx_content_availability_provider ON public.content_availability (provider_id);
CREATE INDEX idx_content_availability_expires_at
  ON public.content_availability (expires_at);
CREATE INDEX idx_content_availability_status ON public.content_availability (status);

-- ============================================================
-- manual_availability_overrides (admin-only)
-- ============================================================
CREATE TABLE public.manual_availability_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id uuid NOT NULL REFERENCES public.content_titles(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('add','remove')),
  source_url text,
  note text,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.manual_availability_overrides ENABLE ROW LEVEL SECURITY;

-- No public policies: only service role (edge functions) can access.

CREATE TRIGGER trg_manual_overrides_updated_at
  BEFORE UPDATE ON public.manual_availability_overrides
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_manual_overrides_title ON public.manual_availability_overrides (title_id);

-- ============================================================
-- Seed: 12 Türkiye platformları
-- Max provider'ı BluTV ve HBO Max adlarını da kapsıyor
-- ============================================================
INSERT INTO public.streaming_providers
  (slug, display_name, sort_order, tmdb_names, domains, firecrawl_enabled, firecrawl_priority)
VALUES
  ('netflix','Netflix',10,
    ARRAY['Netflix','Netflix basic with Ads'],
    ARRAY['netflix.com'], false, 100),
  ('amazon-prime-video','Amazon Prime Video',20,
    ARRAY['Amazon Prime Video','Amazon Video'],
    ARRAY['primevideo.com','amazon.com.tr'], false, 100),
  ('max','Max',30,
    ARRAY['Max','HBO Max','BluTV'],
    ARRAY['max.com','play.max.com','hbomax.com','blutv.com'], true, 20),
  ('disney-plus','Disney+',40,
    ARRAY['Disney Plus','Disney+'],
    ARRAY['disneyplus.com'], false, 100),
  ('mubi','MUBI',50,
    ARRAY['MUBI','Mubi'],
    ARRAY['mubi.com'], false, 100),
  ('tv-plus','TV+',60,
    ARRAY['TV+','Turkcell TV+'],
    ARRAY['tvplus.com.tr'], true, 60),
  ('tabii','tabii',70,
    ARRAY['tabii','Tabii'],
    ARRAY['tabii.com'], true, 30),
  ('exxen','EXXEN',80,
    ARRAY['Exxen','EXXEN'],
    ARRAY['exxen.com'], true, 30),
  ('puhutv','PuhuTV',90,
    ARRAY['Puhu TV','puhutv','PuhuTV'],
    ARRAY['puhutv.com'], true, 30),
  ('tod-tv','TOD TV',100,
    ARRAY['TOD','TOD TV','beIN SPORTS Connect TR'],
    ARRAY['tod.tv'], true, 50),
  ('bein-connect','beIN CONNECT',110,
    ARRAY['beIN CONNECT','beIN Connect'],
    ARRAY['beinconnect.com.tr'], true, 70),
  ('gain','GAIN',120,
    ARRAY['GAIN','Gain'],
    ARRAY['gain.tv'], true, 30);
