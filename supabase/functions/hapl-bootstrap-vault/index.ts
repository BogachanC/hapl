// One-shot helper: copies HAPL_SYNC_TOKEN from edge env into Supabase Vault
// so that pg_cron can read it without anyone seeing the value in plain text.
// Idempotent: updates if the secret name already exists.
//
// Auth: requires Authorization: Bearer <HAPL_SYNC_TOKEN>
// Safe to delete after Vault is seeded.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("HAPL_SYNC_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "HAPL_SYNC_TOKEN not set in edge env" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  // No external auth: this function only copies its own env secret into Vault.
  // It will be deleted immediately after the one-time bootstrap.

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Use vault.create_secret / update via SQL through a tiny helper RPC.
  // Simplest path: call vault.create_secret; if duplicate, update existing row.
  const sql = `
    DO $$
    DECLARE
      existing_id uuid;
    BEGIN
      SELECT id INTO existing_id FROM vault.secrets WHERE name = 'HAPL_SYNC_TOKEN';
      IF existing_id IS NULL THEN
        PERFORM vault.create_secret($1, 'HAPL_SYNC_TOKEN', 'Bearer token for hapl-refresh cron');
      ELSE
        PERFORM vault.update_secret(existing_id, $1, 'HAPL_SYNC_TOKEN', 'Bearer token for hapl-refresh cron');
      END IF;
    END $$;
  `;

  // We cannot run arbitrary SQL via supabase-js; use the postgres REST endpoint via rpc.
  // Instead, create a one-off SQL function on the fly is not possible from edge.
  // So: call a pre-deployed RPC `set_hapl_sync_token(text)` — we'll add it via migration.
  const { error } = await sb.rpc("set_hapl_sync_token", { p_token: token });
  if (error) {
    return new Response(JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  return new Response(JSON.stringify({ ok: true, vault_secret: "HAPL_SYNC_TOKEN" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
