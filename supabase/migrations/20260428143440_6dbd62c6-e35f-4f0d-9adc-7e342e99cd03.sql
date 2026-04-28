CREATE TABLE public.content_availability_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  availability_id uuid,
  title_id uuid NOT NULL,
  provider_id uuid NOT NULL,
  region text NOT NULL,
  availability_type text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('insert','update','delete')),
  old_status text,
  new_status text,
  old_source text,
  new_source text,
  old_confidence numeric,
  new_confidence numeric,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cah_title_provider
  ON public.content_availability_history (title_id, provider_id, changed_at DESC);
CREATE INDEX idx_cah_changed_at
  ON public.content_availability_history (changed_at DESC);

ALTER TABLE public.content_availability_history ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.log_content_availability_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.content_availability_history (
      availability_id, title_id, provider_id, region, availability_type,
      change_type, old_status, new_status, old_source, new_source,
      old_confidence, new_confidence
    ) VALUES (
      NEW.id, NEW.title_id, NEW.provider_id, NEW.region, NEW.availability_type,
      'insert', NULL, NEW.status, NULL, NEW.source,
      NULL, NEW.confidence
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.source IS DISTINCT FROM OLD.source
       OR NEW.confidence IS DISTINCT FROM OLD.confidence THEN
      INSERT INTO public.content_availability_history (
        availability_id, title_id, provider_id, region, availability_type,
        change_type, old_status, new_status, old_source, new_source,
        old_confidence, new_confidence
      ) VALUES (
        NEW.id, NEW.title_id, NEW.provider_id, NEW.region, NEW.availability_type,
        'update', OLD.status, NEW.status, OLD.source, NEW.source,
        OLD.confidence, NEW.confidence
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.content_availability_history (
      availability_id, title_id, provider_id, region, availability_type,
      change_type, old_status, new_status, old_source, new_source,
      old_confidence, new_confidence
    ) VALUES (
      OLD.id, OLD.title_id, OLD.provider_id, OLD.region, OLD.availability_type,
      'delete', OLD.status, NULL, OLD.source, NULL,
      OLD.confidence, NULL
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_content_availability_change ON public.content_availability;
CREATE TRIGGER trg_log_content_availability_change
AFTER INSERT OR UPDATE OR DELETE ON public.content_availability
FOR EACH ROW EXECUTE FUNCTION public.log_content_availability_change();