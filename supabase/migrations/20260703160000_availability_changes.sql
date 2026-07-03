-- Granular per-title-per-provider availability change tracking.
-- Populated by hapl-refresh when a provider is added or removed for a title.
-- Consumed (later) by a notification job that turns unprocessed rows into
-- user-facing watchlist alerts.

CREATE TABLE public.availability_changes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title_id      uuid NOT NULL REFERENCES public.content_titles(id) ON DELETE CASCADE,
  provider_id   uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  action        text NOT NULL CHECK (action IN ('added', 'removed')),
  detected_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz
);

ALTER TABLE public.availability_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view availability_changes"
  ON public.availability_changes
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_availability_changes_unprocessed
  ON public.availability_changes (detected_at)
  WHERE processed_at IS NULL;

CREATE INDEX idx_availability_changes_title
  ON public.availability_changes (title_id);
