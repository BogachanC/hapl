
CREATE TABLE IF NOT EXISTS public.search_index_state (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  index_name text NOT NULL UNIQUE,
  indexed_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  current_offset integer NOT NULL DEFAULT 0,
  total_titles integer NOT NULL DEFAULT 0,
  has_more boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz,
  last_error text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.search_index_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view search index state"
  ON public.search_index_state
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_search_index_state_updated_at
  BEFORE UPDATE ON public.search_index_state
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
