
-- Junction table for many-to-many content-platform relationship
CREATE TABLE public.content_platforms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id uuid NOT NULL REFERENCES public.contents(id) ON DELETE CASCADE,
  platform_id uuid NOT NULL REFERENCES public.platforms(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(content_id, platform_id)
);

ALTER TABLE public.content_platforms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Content platforms are viewable by everyone"
  ON public.content_platforms FOR SELECT TO public USING (true);

-- Migrate existing data
INSERT INTO public.content_platforms (content_id, platform_id)
SELECT id, platform_id FROM public.contents WHERE platform_id IS NOT NULL;
