// hapl-notify: match unprocessed availability_changes against watchlist_items
// to produce pending_notifications for later delivery.
//
// Behavior:
//   - Auth: requires `Authorization: Bearer <HAPL_SYNC_TOKEN>` header
//   - Picks up to N unprocessed availability_changes (oldest first)
//   - For each change, finds all users watching that title via watchlist_items
//   - Inserts one pending_notification per (user, change), ON CONFLICT DO NOTHING
//   - Marks the availability_change as processed_at = now()
//   - Logs run stats to catalog_job_runs (job_name = 'notify_watchlist')

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH = 200;
const MAX_BATCH = 1000;
const LOCK_NAME = "hapl_notify";
const LOCK_TTL_MINUTES = 10;

async function acquireLock(sb: any, owner: string): Promise<boolean> {
  const now = new Date();
  const expires = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);
  const ins = await sb.from("catalog_job_locks").insert({
    lock_name: LOCK_NAME,
    locked_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: expires.toISOString(),
    owner,
  });
  if (!ins.error) return true;
  const upd = await sb
    .from("catalog_job_locks")
    .update({
      locked_at: now.toISOString(),
      heartbeat_at: now.toISOString(),
      expires_at: expires.toISOString(),
      owner,
    })
    .eq("lock_name", LOCK_NAME)
    .lte("expires_at", now.toISOString())
    .select("lock_name");
  if (upd.error) return false;
  return Array.isArray(upd.data) && upd.data.length > 0;
}

async function releaseLock(sb: any, owner: string): Promise<void> {
  await sb
    .from("catalog_job_locks")
    .delete()
    .eq("lock_name", LOCK_NAME)
    .eq("owner", owner);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const expected = Deno.env.get("HAPL_SYNC_TOKEN");
  if (!expected) {
    return new Response(
      JSON.stringify({ error: "HAPL_SYNC_TOKEN not configured" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
  const auth =
    req.headers.get("authorization") ||
    req.headers.get("Authorization") ||
    "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Params ──────────────────────────────────────────────────────────────
  let batch = DEFAULT_BATCH;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.batch === "number" && body.batch > 0) {
        batch = Math.min(MAX_BATCH, Math.floor(body.batch));
      }
    }
  } catch (_) {
    /* ignore */
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Concurrency guard ──────────────────────────────────────────────────
  const owner = `notify_${crypto.randomUUID()}`;
  const acquired = await acquireLock(sb, owner);
  if (!acquired) {
    return new Response(
      JSON.stringify({
        ok: true,
        skipped: true,
        reason: "another_run_in_progress",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Run row ────────────────────────────────────────────────────────────
  const runInsert = await sb
    .from("catalog_job_runs")
    .insert({
      job_name: "notify_watchlist",
      payload: { batch, lock_owner: owner },
    })
    .select("id")
    .maybeSingle();
  const runId = runInsert.data?.id as string | undefined;

  let changesProcessed = 0;
  let notificationsQueued = 0;
  let changesSkipped = 0;
  let failed = 0;
  let lastError: string | null = null;

  try {
    // Fetch unprocessed availability_changes, oldest first.
    const { data: changes, error: chgErr } = await sb
      .from("availability_changes")
      .select("id, title_id, provider_id, action")
      .is("processed_at", null)
      .order("detected_at", { ascending: true })
      .limit(batch);

    if (chgErr) throw chgErr;

    if (changes && changes.length > 0) {
      for (const change of changes) {
        try {
          // Find all users watching this title.
          const { data: watchers, error: wErr } = await sb
            .from("watchlist_items")
            .select("user_id")
            .eq("title_id", change.title_id);

          if (wErr) {
            console.error(
              `[hapl-notify] watchlist query failed change=${change.id}:`,
              wErr.message,
            );
            failed++;
            lastError = wErr.message;
            continue;
          }

          if (watchers && watchers.length > 0) {
            // Filter out users who opted out of email notifications.
            const watcherIds = watchers.map((w: any) => w.user_id as string);
            const { data: optedOut } = await sb
              .from("notification_preferences")
              .select("user_id")
              .eq("email_enabled", false)
              .in("user_id", watcherIds);
            const optedOutSet = new Set(
              (optedOut ?? []).map((r: any) => r.user_id as string),
            );
            const eligibleIds = watcherIds.filter(
              (id) => !optedOutSet.has(id),
            );

            if (eligibleIds.length === 0) {
              changesSkipped++;
              await sb
                .from("availability_changes")
                .update({ processed_at: new Date().toISOString() })
                .eq("id", change.id);
              changesProcessed++;
              continue;
            }

            const notifRows = eligibleIds.map((uid) => ({
              user_id: uid,
              availability_change_id: change.id,
              title_id: change.title_id,
              provider_id: change.provider_id,
              action: change.action,
            }));

            const { data: inserted, error: insErr } = await sb
              .from("pending_notifications")
              .upsert(notifRows, {
                onConflict: "user_id,availability_change_id",
                ignoreDuplicates: true,
              })
              .select("id");

            if (insErr) {
              console.error(
                `[hapl-notify] pending_notifications insert failed change=${change.id}:`,
                insErr.message,
              );
              failed++;
              lastError = insErr.message;
              continue;
            }

            notificationsQueued += inserted?.length ?? watchers.length;
          } else {
            changesSkipped++;
          }

          // Mark change as processed.
          await sb
            .from("availability_changes")
            .update({ processed_at: new Date().toISOString() })
            .eq("id", change.id);

          changesProcessed++;
        } catch (e) {
          console.error(
            `[hapl-notify] change=${change.id} failed:`,
            (e as Error).message,
          );
          failed++;
          lastError = (e as Error).message;
        }
      }
    }

    console.log(
      `[hapl-notify] changes_processed=${changesProcessed} notifications_queued=${notificationsQueued} skipped=${changesSkipped} failed=${failed} batch=${batch}`,
    );

    if (runId) {
      await sb
        .from("catalog_job_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: failed === 0,
          processed: changesProcessed,
          changed: notificationsQueued,
          failed,
          last_error: lastError,
          payload: { batch, lock_owner: owner, skipped_no_watchers: changesSkipped },
        })
        .eq("id", runId);
    }

    return new Response(
      JSON.stringify({
        ok: failed === 0,
        batch,
        changes_processed: changesProcessed,
        notifications_queued: notificationsQueued,
        skipped_no_watchers: changesSkipped,
        failed,
        run_id: runId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[hapl-notify] error:", err);
    if (runId) {
      await sb
        .from("catalog_job_runs")
        .update({
          finished_at: new Date().toISOString(),
          ok: false,
          processed: changesProcessed,
          changed: notificationsQueued,
          failed,
          last_error: err.message,
        })
        .eq("id", runId);
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await releaseLock(sb, owner);
  }
});
