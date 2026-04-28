CREATE OR REPLACE FUNCTION public.set_hapl_sync_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault
AS $$
DECLARE
  existing_id uuid;
BEGIN
  SELECT id INTO existing_id FROM vault.secrets WHERE name = 'HAPL_SYNC_TOKEN';
  IF existing_id IS NULL THEN
    PERFORM vault.create_secret(p_token, 'HAPL_SYNC_TOKEN', 'Bearer token for hapl-refresh cron');
  ELSE
    PERFORM vault.update_secret(existing_id, p_token, 'HAPL_SYNC_TOKEN', 'Bearer token for hapl-refresh cron');
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_hapl_sync_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_hapl_sync_token(text) FROM anon, authenticated;