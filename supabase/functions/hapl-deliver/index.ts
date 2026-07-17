// hapl-deliver: send pending watchlist notifications via email (Resend),
// then mark them sent.
//
// Behavior:
//   - Auth: requires `Authorization: Bearer <HAPL_SYNC_TOKEN>` header
//   - Reads unsent pending_notifications (sent_at IS NULL), oldest first
//   - Groups by user_id → one email per user summarising all their changes
//   - Sends via Resend REST API (no SDK)
//   - Marks rows sent_at = now() on successful send
//   - Logs run stats to catalog_job_runs (job_name = 'deliver_watchlist')

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH = 100;
const MAX_BATCH = 500;
const LOCK_NAME = "hapl_deliver";
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

interface PendingRow {
  id: string;
  user_id: string;
  title_id: string;
  provider_id: string;
  action: string;
}

function buildEmailHtml(
  changes: { title: string; provider: string; action: string }[],
): string {
  const lines = changes.map((c) => {
    if (c.action === "added") {
      return `<li><strong>${c.title}</strong> artık <strong>${c.provider}</strong> üzerinde.</li>`;
    }
    return `<li><strong>${c.title}</strong> artık <strong>${c.provider}</strong> üzerinde değil.</li>`;
  });

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #222; max-width: 480px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 16px;">İzleme Listesi Güncellemesi</h2>
  <p>İzleme listendeki içeriklerde değişiklikler var:</p>
  <ul style="padding-left: 20px; line-height: 1.8;">
    ${lines.join("\n    ")}
  </ul>
  <p style="margin-top: 24px; color: #888; font-size: 13px;">Bu e-posta HAPL tarafından otomatik gönderilmiştir.</p>
</body>
</html>`;
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
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Required env ───────────────────────────────────────────────────────
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return new Response(
      JSON.stringify({ error: "RESEND_API_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  const fromAddress = Deno.env.get("HAPL_EMAIL_FROM");
  if (!fromAddress) {
    return new Response(
      JSON.stringify({ error: "HAPL_EMAIL_FROM not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Params ─────────────────────────────────────────────────────────────
  let batch = DEFAULT_BATCH;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.batch === "number" && body.batch > 0) {
        batch = Math.min(MAX_BATCH, Math.floor(body.batch));
      }
    }
  } catch (_) { /* ignore */ }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Concurrency guard ──────────────────────────────────────────────────
  const owner = `deliver_${crypto.randomUUID()}`;
  const acquired = await acquireLock(sb, owner);
  if (!acquired) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "another_run_in_progress" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Run row ────────────────────────────────────────────────────────────
  const runInsert = await sb
    .from("catalog_job_runs")
    .insert({ job_name: "deliver_watchlist", payload: { batch, lock_owner: owner } })
    .select("id")
    .maybeSingle();
  const runId = runInsert.data?.id as string | undefined;

  let notificationsMarkedSent = 0;
  let emailsSent = 0;
  let usersFailed = 0;
  let lastError: string | null = null;

  try {
    // ── Fetch unsent notifications ─────────────────────────────────────
    const { data: pending, error: pendErr } = await sb
      .from("pending_notifications")
      .select("id, user_id, title_id, provider_id, action")
      .is("sent_at", null)
      .order("created_at", { ascending: true })
      .limit(batch);

    if (pendErr) throw pendErr;
    if (!pending || pending.length === 0) {
      console.log("[hapl-deliver] no unsent notifications");
      if (runId) {
        await sb.from("catalog_job_runs").update({
          finished_at: new Date().toISOString(),
          ok: true, processed: 0, changed: 0, failed: 0,
        }).eq("id", runId);
      }
      return new Response(
        JSON.stringify({ ok: true, batch, notifications_sent: 0, emails_sent: 0, failed: 0, run_id: runId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Batch-fetch display data (titles + providers) ──────────────────
    const titleIds = [...new Set(pending.map((r: PendingRow) => r.title_id))];
    const providerIds = [...new Set(pending.map((r: PendingRow) => r.provider_id))];

    const [titlesRes, providersRes] = await Promise.all([
      sb.from("content_titles").select("id, title").in("id", titleIds),
      sb.from("streaming_providers").select("id, display_name").in("id", providerIds),
    ]);

    const titleMap = new Map<string, string>();
    for (const t of titlesRes.data || []) titleMap.set(t.id, t.title);

    const providerMap = new Map<string, string>();
    for (const p of providersRes.data || []) providerMap.set(p.id, p.display_name);

    // ── Group by user ──────────────────────────────────────────────────
    const byUser = new Map<string, PendingRow[]>();
    for (const row of pending as PendingRow[]) {
      const arr = byUser.get(row.user_id) || [];
      arr.push(row);
      byUser.set(row.user_id, arr);
    }

    // ── Filter out users who opted out of email notifications ──────────
    const userIds = [...byUser.keys()];
    const { data: optedOut } = await sb
      .from("notification_preferences")
      .select("user_id")
      .eq("email_enabled", false)
      .in("user_id", userIds);
    const optedOutSet = new Set(
      (optedOut ?? []).map((r: any) => r.user_id as string),
    );
    for (const uid of optedOutSet) {
      console.log(`[hapl-deliver] skipping user=${uid}: opted out of email notifications`);
      byUser.delete(uid);
    }

    if (byUser.size === 0) {
      console.log("[hapl-deliver] all users in batch opted out");
      if (runId) {
        await sb.from("catalog_job_runs").update({
          finished_at: new Date().toISOString(),
          ok: true, processed: 0, changed: 0, failed: 0,
          payload: { batch, lock_owner: owner, all_opted_out: true },
        }).eq("id", runId);
      }
      return new Response(
        JSON.stringify({ ok: true, batch, notifications_sent: 0, emails_sent: 0, failed: 0, opted_out: optedOutSet.size, run_id: runId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Fetch user emails in batch via admin API ───────────────────────
    const eligibleUserIds = [...byUser.keys()];
    const emailMap = new Map<string, string>();
    for (const uid of eligibleUserIds) {
      const { data: userData, error: userErr } = await sb.auth.admin.getUserById(uid);
      if (userErr || !userData?.user?.email) {
        console.warn(`[hapl-deliver] no email for user=${uid}: ${userErr?.message ?? "missing"}`);
        continue;
      }
      emailMap.set(uid, userData.user.email);
    }

    // ── Send one email per user ────────────────────────────────────────
    for (const [userId, rows] of byUser) {
      const email = emailMap.get(userId);
      if (!email) {
        console.warn(`[hapl-deliver] skipping user=${userId}: no email address`);
        usersFailed++;
        lastError = `no email for user ${userId}`;
        continue;
      }

      const changes = rows.map((r) => ({
        title: titleMap.get(r.title_id) ?? "(bilinmeyen içerik)",
        provider: providerMap.get(r.provider_id) ?? "(bilinmeyen platform)",
        action: r.action,
      }));

      const html = buildEmailHtml(changes);

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: fromAddress,
            to: email,
            subject: "HAPL — İzleme listende değişiklikler var",
            html,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(`[hapl-deliver] Resend error for user=${userId}: ${res.status} ${errBody}`);
          usersFailed++;
          lastError = `Resend ${res.status}: ${errBody.slice(0, 200)}`;
          continue;
        }

        // Mark all this user's rows as sent.
        const rowIds = rows.map((r) => r.id);
        const { error: updErr } = await sb
          .from("pending_notifications")
          .update({ sent_at: new Date().toISOString() })
          .in("id", rowIds);

        if (updErr) {
          console.error(`[hapl-deliver] failed to mark sent for user=${userId}: ${updErr.message}`);
          usersFailed++;
          lastError = updErr.message;
          continue;
        }

        emailsSent++;
        notificationsMarkedSent += rowIds.length;
      } catch (e) {
        console.error(`[hapl-deliver] send failed for user=${userId}:`, (e as Error).message);
        usersFailed++;
        lastError = (e as Error).message;
      }
    }

    console.log(
      `[hapl-deliver] emails_sent=${emailsSent} notifications_marked_sent=${notificationsMarkedSent} users_failed=${usersFailed} batch=${batch}`,
    );

    if (runId) {
      await sb.from("catalog_job_runs").update({
        finished_at: new Date().toISOString(),
        ok: usersFailed === 0,
        processed: notificationsMarkedSent,
        changed: emailsSent,
        failed: usersFailed,
        last_error: lastError,
        payload: { batch, lock_owner: owner, users_processed: byUser.size },
      }).eq("id", runId);
    }

    return new Response(
      JSON.stringify({
        ok: usersFailed === 0,
        batch,
        notifications_sent: notificationsMarkedSent,
        emails_sent: emailsSent,
        users_failed: usersFailed,
        run_id: runId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[hapl-deliver] error:", err);
    if (runId) {
      await sb.from("catalog_job_runs").update({
        finished_at: new Date().toISOString(),
        ok: false,
        processed: notificationsMarkedSent,
        changed: emailsSent,
        failed: usersFailed,
        last_error: err.message,
      }).eq("id", runId);
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } finally {
    await releaseLock(sb, owner);
  }
});
