-- Platforms table
CREATE TABLE public.platforms (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,
  logo_url TEXT,
  color TEXT NOT NULL DEFAULT '#666666',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.platforms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Platforms are viewable by everyone"
  ON public.platforms FOR SELECT USING (true);

-- Content types enum
CREATE TYPE public.content_type AS ENUM ('dizi', 'film');

-- Content status enum  
CREATE TYPE public.content_status AS ENUM ('yayinda', 'yakinda', 'bitti');

-- Contents table
CREATE TABLE public.contents (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  poster_url TEXT,
  content_type public.content_type NOT NULL DEFAULT 'dizi',
  status public.content_status NOT NULL DEFAULT 'yayinda',
  genre TEXT[] DEFAULT '{}',
  release_year INTEGER,
  platform_id UUID NOT NULL REFERENCES public.platforms(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.contents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Contents are viewable by everyone"
  ON public.contents FOR SELECT USING (true);

CREATE INDEX idx_contents_title ON public.contents USING gin(to_tsvector('turkish', title));
CREATE INDEX idx_contents_platform ON public.contents(platform_id);
CREATE INDEX idx_contents_type ON public.contents(content_type);
CREATE INDEX idx_contents_status ON public.contents(status);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_contents_updated_at
  BEFORE UPDATE ON public.contents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();