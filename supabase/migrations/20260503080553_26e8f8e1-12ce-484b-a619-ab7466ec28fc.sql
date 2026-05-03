
-- 1) Allow new source value
ALTER TABLE public.content_availability DROP CONSTRAINT IF EXISTS content_availability_source_check;
ALTER TABLE public.content_availability
  ADD CONSTRAINT content_availability_source_check
  CHECK (source = ANY (ARRAY['tmdb'::text, 'firecrawl'::text, 'manual'::text, 'provider_rule'::text]));

-- 2) Rules table
CREATE TABLE IF NOT EXISTS public.provider_derivation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_provider_id uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  derived_provider_id uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  region text NOT NULL DEFAULT 'TR',
  availability_type text NOT NULL DEFAULT 'stream',
  confidence numeric NOT NULL DEFAULT 0.88,
  note text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_provider_id, derived_provider_id, region, availability_type)
);

ALTER TABLE public.provider_derivation_rules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "provider_derivation_rules readable by everyone" ON public.provider_derivation_rules;
CREATE POLICY "provider_derivation_rules readable by everyone"
  ON public.provider_derivation_rules FOR SELECT USING (true);

-- 3) Seed rule: HBO Max → TV+ (TR, stream)
INSERT INTO public.provider_derivation_rules
  (source_provider_id, derived_provider_id, region, availability_type, confidence, note, is_active)
SELECT s.id, d.id, 'TR', 'stream', 0.88,
       'TV+ uygulamasi icinde HBO Max katalogunun tamami izlenebiliyor. Tek yonlu: HBO Max -> TV+.',
       true
FROM public.streaming_providers s, public.streaming_providers d
WHERE s.slug = 'max' AND d.slug = 'tv-plus'
ON CONFLICT (source_provider_id, derived_provider_id, region, availability_type) DO NOTHING;

-- 4) Trigger function: derive availability rows from rules
CREATE OR REPLACE FUNCTION public.apply_provider_derivation_rules()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rule RECORD;
  existing RECORD;
BEGIN
  -- Never recurse from a derived row
  IF NEW.source = 'provider_rule' THEN
    RETURN NEW;
  END IF;

  FOR rule IN
    SELECT * FROM public.provider_derivation_rules
    WHERE is_active = true
      AND source_provider_id = NEW.provider_id
      AND region = NEW.region
      AND availability_type = NEW.availability_type
  LOOP
    SELECT id, source, status INTO existing
    FROM public.content_availability
    WHERE title_id = NEW.title_id
      AND provider_id = rule.derived_provider_id
      AND region = rule.region
      AND availability_type = rule.availability_type;

    IF NEW.status = 'available' THEN
      IF existing.id IS NULL THEN
        INSERT INTO public.content_availability (
          title_id, provider_id, region, availability_type,
          status, source, source_url, confidence,
          checked_at, last_seen_at, raw_payload
        ) VALUES (
          NEW.title_id, rule.derived_provider_id, rule.region, rule.availability_type,
          'available', 'provider_rule', NULL, rule.confidence,
          now(), now(),
          jsonb_build_object(
            'via', 'provider_rule',
            'rule_id', rule.id,
            'origin_provider_id', NEW.provider_id,
            'origin_source', NEW.source,
            'note', rule.note
          )
        );
      ELSIF existing.source = 'provider_rule' THEN
        UPDATE public.content_availability
          SET status = 'available',
              confidence = rule.confidence,
              checked_at = now(),
              last_seen_at = now(),
              raw_payload = jsonb_build_object(
                'via','provider_rule','rule_id',rule.id,
                'origin_provider_id',NEW.provider_id,'origin_source',NEW.source,
                'note', rule.note
              )
          WHERE id = existing.id;
      END IF;
    ELSIF NEW.status = 'unavailable' THEN
      -- Only retract the derived row if it was created by the rule
      IF existing.id IS NOT NULL AND existing.source = 'provider_rule' THEN
        UPDATE public.content_availability
          SET status = 'unavailable',
              checked_at = now(),
              expires_at = now(),
              confidence = 0.3
          WHERE id = existing.id;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_apply_provider_derivation_rules ON public.content_availability;
CREATE TRIGGER trg_apply_provider_derivation_rules
AFTER INSERT OR UPDATE OF status, source, confidence
ON public.content_availability
FOR EACH ROW
EXECUTE FUNCTION public.apply_provider_derivation_rules();

-- 5) Backfill: for every active rule, derive existing rows
DO $$
DECLARE
  rule RECORD;
BEGIN
  FOR rule IN SELECT * FROM public.provider_derivation_rules WHERE is_active = true LOOP
    -- Insert missing derived rows
    INSERT INTO public.content_availability (
      title_id, provider_id, region, availability_type,
      status, source, source_url, confidence,
      checked_at, last_seen_at, raw_payload
    )
    SELECT ca.title_id, rule.derived_provider_id, rule.region, rule.availability_type,
           'available', 'provider_rule', NULL, rule.confidence,
           now(), now(),
           jsonb_build_object(
             'via','provider_rule','rule_id',rule.id,
             'origin_provider_id',ca.provider_id,'origin_source',ca.source,
             'note', rule.note
           )
    FROM public.content_availability ca
    WHERE ca.provider_id = rule.source_provider_id
      AND ca.region = rule.region
      AND ca.availability_type = rule.availability_type
      AND ca.status = 'available'
      AND ca.source IN ('tmdb','manual')
      AND NOT EXISTS (
        SELECT 1 FROM public.content_availability ex
        WHERE ex.title_id = ca.title_id
          AND ex.provider_id = rule.derived_provider_id
          AND ex.region = rule.region
          AND ex.availability_type = rule.availability_type
      );

    -- Refresh existing provider_rule rows where origin still available
    UPDATE public.content_availability d
       SET status = 'available',
           confidence = rule.confidence,
           checked_at = now(),
           last_seen_at = now()
     WHERE d.provider_id = rule.derived_provider_id
       AND d.region = rule.region
       AND d.availability_type = rule.availability_type
       AND d.source = 'provider_rule'
       AND EXISTS (
         SELECT 1 FROM public.content_availability o
         WHERE o.title_id = d.title_id
           AND o.provider_id = rule.source_provider_id
           AND o.region = rule.region
           AND o.availability_type = rule.availability_type
           AND o.status = 'available'
           AND o.source IN ('tmdb','manual')
       );
  END LOOP;
END $$;
