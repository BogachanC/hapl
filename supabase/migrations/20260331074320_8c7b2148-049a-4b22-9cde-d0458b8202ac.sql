CREATE TYPE public.content_origin AS ENUM ('yerli', 'yabanci');
ALTER TABLE public.contents ADD COLUMN origin content_origin NOT NULL DEFAULT 'yerli';