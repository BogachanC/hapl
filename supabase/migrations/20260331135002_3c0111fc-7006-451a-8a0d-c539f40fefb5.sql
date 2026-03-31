
-- Allow public inserts on contents table (admin panel)
CREATE POLICY "Anyone can insert contents"
ON public.contents FOR INSERT
TO public
WITH CHECK (true);

-- Allow public inserts on content_platforms table
CREATE POLICY "Anyone can insert content_platforms"
ON public.content_platforms FOR INSERT
TO public
WITH CHECK (true);

-- Allow public updates on contents table
CREATE POLICY "Anyone can update contents"
ON public.contents FOR UPDATE
TO public
USING (true)
WITH CHECK (true);
