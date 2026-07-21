-- ============================================================
-- 1. Add is_bundle flag to streaming_providers
-- ============================================================
-- TV+ Premium bundles the HBO Max catalogue, but TMDB does not
-- attribute HBO Max titles to TV+. A later PR must exclude
-- bundled providers from cancellation recommendations.
ALTER TABLE public.streaming_providers
  ADD COLUMN is_bundle boolean NOT NULL DEFAULT false;

UPDATE public.streaming_providers
  SET is_bundle = true
  WHERE slug = 'tv-plus';

-- ============================================================
-- 2. provider_plans — per-provider pricing tiers
-- ============================================================
CREATE TABLE public.provider_plans (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id            uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  code                   text NOT NULL UNIQUE,
  display_name           text NOT NULL,
  billing_period         text NOT NULL CHECK (billing_period IN ('monthly','annual')),
  price_try              numeric(10,2) NOT NULL,
  monthly_equivalent_try numeric(10,2) NOT NULL,
  has_ads                boolean NOT NULL DEFAULT false,
  is_promotional         boolean NOT NULL DEFAULT false,
  is_full_catalogue      boolean NOT NULL DEFAULT true,
  verified_at            date NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_plans_provider ON public.provider_plans (provider_id);

ALTER TABLE public.provider_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "provider_plans readable by everyone"
  ON public.provider_plans FOR SELECT USING (true);

CREATE TRIGGER trg_provider_plans_updated_at
  BEFORE UPDATE ON public.provider_plans
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============================================================
-- 3. Seed pricing data (verified 2026-07-21)
--
-- Deliberately NOT seeded (no verified source as of 2026-07-21):
--   puhutv, exxen, gain, tod-tv, bein-connect, Disney+ annual,
--   MUBI annual.
-- Absence of a row means "price unknown" — no placeholder rows.
-- ============================================================

-- Netflix
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'netflix'),
   'netflix-temel', 'Temel', 'monthly', 189.99, 189.99, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'netflix'),
   'netflix-standart', 'Standart', 'monthly', 289.99, 289.99, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'netflix'),
   'netflix-premium', 'Premium', 'monthly', 379.99, 379.99, false, false, true, '2026-07-21');

-- Amazon Prime Video
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'amazon-prime-video'),
   'prime-standart', 'Prime', 'monthly', 69.90, 69.90, true, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'amazon-prime-video'),
   'prime-reklamsiz', 'Prime + Reklamsız', 'monthly', 129.80, 129.80, false, false, true, '2026-07-21');

-- Disney+
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'disney-plus'),
   'disney-ads', 'With Ads', 'monthly', 249.90, 249.90, true, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'disney-plus'),
   'disney-noads', 'Without Ads', 'monthly', 449.90, 449.90, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'disney-plus'),
   'disney-ads-promo', 'With Ads (3 ay)', 'monthly', 179.90, 179.90, true, true, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'disney-plus'),
   'disney-noads-promo', 'Without Ads (3 ay)', 'monthly', 299.90, 299.90, false, true, true, '2026-07-21');

-- Max
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'max'),
   'max-standard', 'Standard', 'monthly', 229.90, 229.90, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'max'),
   'max-premium', 'Premium', 'monthly', 299.90, 299.90, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'max'),
   'max-standard-yil', 'Standard Yıllık', 'annual', 2299.00, 191.58, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'max'),
   'max-premium-yil', 'Premium Yıllık', 'annual', 2999.00, 249.92, false, false, true, '2026-07-21');

-- MUBI
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'mubi'),
   'mubi-aylik', 'Aylık', 'monthly', 229.00, 229.00, false, false, true, '2026-07-21');

-- TV+
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'tv-plus'),
   'tvplus-premium', 'Premium x HBO Max', 'monthly', 229.99, 229.99, false, false, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'tv-plus'),
   'tvplus-promo', 'Premium (ilk 3 ay)', 'monthly', 129.99, 129.99, false, true, true, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'tv-plus'),
   'tvplus-yillik', 'Premium Yıllık', 'annual', 1999.99, 166.67, false, false, true, '2026-07-21');

-- tabii
INSERT INTO public.provider_plans
  (provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at)
VALUES
  ((SELECT id FROM public.streaming_providers WHERE slug = 'tabii'),
   'tabii-ucretsiz', 'Ücretsiz', 'monthly', 0.00, 0.00, true, false, false, '2026-07-21'),
  ((SELECT id FROM public.streaming_providers WHERE slug = 'tabii'),
   'tabii-premium', 'Premium', 'monthly', 99.00, 99.00, false, false, true, '2026-07-21');
