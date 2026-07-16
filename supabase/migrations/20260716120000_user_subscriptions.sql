-- user_subscriptions: per-user streaming platform subscriptions.
-- Mirrors watchlist_items pattern — fully user-scoped RLS, no anon/public access.

-- ============================================================
-- 1. user_subscriptions table
-- ============================================================
CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, provider_id)
);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own subscriptions"
  ON public.user_subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can add to their own subscriptions"
  ON public.user_subscriptions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can remove from their own subscriptions"
  ON public.user_subscriptions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_user_subscriptions_user ON public.user_subscriptions (user_id);
CREATE INDEX idx_user_subscriptions_provider ON public.user_subscriptions (provider_id);

-- ============================================================
-- 2. Add is_local flag to streaming_providers
-- ============================================================
ALTER TABLE public.streaming_providers
  ADD COLUMN is_local boolean NOT NULL DEFAULT false;

-- Backfill Turkish domestic platforms.
-- Slugs verified from the seed migration (20260428120714).
UPDATE public.streaming_providers
  SET is_local = true
  WHERE slug IN ('tabii', 'exxen', 'puhutv', 'tod-tv', 'bein-connect', 'gain');
