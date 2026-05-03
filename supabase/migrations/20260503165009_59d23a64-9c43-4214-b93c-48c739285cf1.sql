
CREATE TABLE IF NOT EXISTS public.catalog_seed_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'running', -- running | partial | paused | completed | failed
  mode text NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  cursor jsonb,
  plan_total integer NOT NULL DEFAULT 0,
  processed_jobs integer NOT NULL DEFAULT 0,
  current_provider text,
  current_strategy text,
  current_type text,
  current_page integer,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  baseline jsonb,
  coverage_delta jsonb,
  last_error text,
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_catalog_seed_jobs_status_created
  ON public.catalog_seed_jobs(status, created_at DESC);

ALTER TABLE public.catalog_seed_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view seed jobs"
  ON public.catalog_seed_jobs
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER catalog_seed_jobs_updated_at
  BEFORE UPDATE ON public.catalog_seed_jobs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
