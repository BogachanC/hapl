-- profiles: per-user display profile (username + avatar selection).
-- Row creation is LAZY — no signup trigger, no backfill.
-- Absence of a row = defaults (no username, avatar falls back to initial).

-- ============================================================
-- 1. Table
-- ============================================================
CREATE TABLE public.profiles (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username    text CHECK (username IS NULL OR char_length(username) BETWEEN 1 AND 40),
  avatar_key  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RLS policies (mirrors notification_preferences exactly)
-- ============================================================
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own profile"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own profile"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- ============================================================
-- 3. Auto-update updated_at (reuses existing function from PR 1)
-- ============================================================
CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
