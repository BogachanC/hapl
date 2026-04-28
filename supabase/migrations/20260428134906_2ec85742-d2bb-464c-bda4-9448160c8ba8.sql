CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;

-- Helper to read the hapl sync token from the vault.
-- SECURITY DEFINER + restrictive grants: only postgres (cron runs as postgres) can call it.
CREATE OR REPLACE FUNCTION public.get_hapl_sync_token()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret
  FROM vault.decrypted_secrets
  WHERE name = 'HAPL_SYNC_TOKEN'
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_hapl_sync_token() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_hapl_sync_token() FROM anon, authenticated;