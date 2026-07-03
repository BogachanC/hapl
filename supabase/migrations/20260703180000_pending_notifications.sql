-- Notification queue: one row per (user, availability_change) pair.
-- Populated by hapl-notify, consumed by a future delivery job.

CREATE TABLE public.pending_notifications (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  availability_change_id  uuid NOT NULL REFERENCES public.availability_changes(id) ON DELETE CASCADE,
  title_id                uuid NOT NULL REFERENCES public.content_titles(id) ON DELETE CASCADE,
  provider_id             uuid NOT NULL REFERENCES public.streaming_providers(id) ON DELETE CASCADE,
  action                  text NOT NULL CHECK (action IN ('added', 'removed')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  sent_at                 timestamptz,
  UNIQUE (user_id, availability_change_id)
);

ALTER TABLE public.pending_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view pending_notifications"
  ON public.pending_notifications
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_pending_notifications_unsent
  ON public.pending_notifications (created_at)
  WHERE sent_at IS NULL;

CREATE INDEX idx_pending_notifications_user
  ON public.pending_notifications (user_id);
