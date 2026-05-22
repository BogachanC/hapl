
ALTER TABLE public.content_titles
  ADD COLUMN IF NOT EXISTS normalized_compact text;

ALTER TABLE public.content_title_aliases
  ADD COLUMN IF NOT EXISTS normalized_compact text;

UPDATE public.content_titles
  SET normalized_compact = regexp_replace(coalesce(normalized_title, ''), '\s+', '', 'g')
  WHERE normalized_compact IS NULL OR normalized_compact = '';

UPDATE public.content_title_aliases
  SET normalized_compact = regexp_replace(coalesce(normalized_alias, ''), '\s+', '', 'g')
  WHERE normalized_compact IS NULL OR normalized_compact = '';

CREATE OR REPLACE FUNCTION public.set_normalized_compact_title()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.normalized_compact := regexp_replace(coalesce(NEW.normalized_title, ''), '\s+', '', 'g');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_normalized_compact_alias()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.normalized_compact := regexp_replace(coalesce(NEW.normalized_alias, ''), '\s+', '', 'g');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_content_titles_compact ON public.content_titles;
CREATE TRIGGER trg_content_titles_compact
  BEFORE INSERT OR UPDATE OF normalized_title ON public.content_titles
  FOR EACH ROW EXECUTE FUNCTION public.set_normalized_compact_title();

DROP TRIGGER IF EXISTS trg_content_title_aliases_compact ON public.content_title_aliases;
CREATE TRIGGER trg_content_title_aliases_compact
  BEFORE INSERT OR UPDATE OF normalized_alias ON public.content_title_aliases
  FOR EACH ROW EXECUTE FUNCTION public.set_normalized_compact_alias();

CREATE INDEX IF NOT EXISTS idx_content_titles_normalized_compact
  ON public.content_titles (normalized_compact);

CREATE INDEX IF NOT EXISTS idx_content_title_aliases_normalized_compact
  ON public.content_title_aliases (normalized_compact);
