// hapl-healthcheck: daily health monitor for the three scheduled cron jobs
// (refresh, notify, deliver). Driven by catalog_job_runs, NOT net._http_response.
//
// Checks per job:
//   1. STALENESS: most recent finished_at within 14 hours (12h cadence + buffer)
//   2. FAILURE:   ok=false on most recent run, or failed count regression
//   3. BACKLOG:   (notify only) availability_changes rows stuck unprocessed > 26h
//   4. THROUGHPUT: (refresh only) processed < 50% of expected batch
//
// Secondary (low priority): net._http_response entries with non-NULL status_code
// outside 2xx — catches the HAPL_SYNC_TOKEN-style 401 shape. NULL status_code +
// timed_out is IGNORED (Finding 1: normal pg_net behavior when functions take >5s).
//
// Alerts via Resend to HAPL_ADMIN_EMAIL. No email on healthy days.
// Self-logs to catalog_job_runs (job_name: 'healthcheck').

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Job name mapping: cron job name → catalog_job_runs job_name.
// These differ because catalog_job_runs names predate the cron schedule names.
const MONITORED_JOBS = [
  { cronName: "hapl-refresh-twice-daily", catalogName: "refresh_existing" },
  { cronName: "hapl-notify-twice-daily", catalogName: "notify_watchlist" },
  { cronName: "hapl-deliver-twice-daily", catalogName: "deliver_watchlist" },
] as const;

// Staleness: 14 hours covers the 12h cadence + 2h buffer for drift.
const STALENESS_HOURS = 14;

// refresh_existing: baseline failed=1 (one dead TMDB id per batch). Alert at >= 3.
const REFRESH_FAILED_THRESHOLD = 3;

// refresh_existing: cron passes batch=50. processed=49 is steady state (49 ok + 1 fail).
// Alert if processed drops below 50% of expected (< 25), meaning upstream trouble
// (TMDB errors, rate limiting, circuit breaker partially tripping).
const REFRESH_EXPECTED_BATCH = 50;
const REFRESH_PROCESSED_MIN_RATIO = 0.5;

// Backlog: availability_changes rows unprocessed for > 26 hours (2 cron cycles + buffer).
// With notify batch=200 and ~3 rows/day, the queue drains in one cycle. Stuck rows
// indicate "notify runs but silently fails to consume" — a failure mode not covered
// by staleness (the function completes) or ok=false (it doesn't throw).
const BACKLOG_HOURS = 26;

interface Alert {
  job: string;
  condition: string;
  detail: string;
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
  const adminEmail = Deno.env.get("HAPL_ADMIN_EMAIL");
  if (!adminEmail) {
    return new Response(
      JSON.stringify({ error: "HAPL_ADMIN_EMAIL not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Self-log: create run row ───────────────────────────────────────────
  const runInsert = await sb
    .from("catalog_job_runs")
    .insert({ job_name: "healthcheck", payload: {} })
    .select("id")
    .maybeSingle();
  const runId = runInsert.data?.id as string | undefined;

  const alerts: Alert[] = [];
  let lastError: string | null = null;

  try {
    const now = new Date();
    const stalenessCutoff = new Date(now.getTime() - STALENESS_HOURS * 3600 * 1000).toISOString();

    // ── Check each monitored job ──────────────────────────────────────────
    for (const job of MONITORED_JOBS) {
      // Fetch the 2 most recent completed runs for this job.
      const { data: runs, error: runErr } = await sb
        .from("catalog_job_runs")
        .select("finished_at, ok, processed, changed, failed, last_error")
        .eq("job_name", job.catalogName)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: false })
        .limit(2);

      if (runErr) {
        alerts.push({
          job: job.catalogName,
          condition: "query_error",
          detail: `catalog_job_runs query failed: ${runErr.message}`,
        });
        continue;
      }

      // ── 1. Staleness ──────────────────────────────────────────────────
      if (!runs || runs.length === 0) {
        alerts.push({
          job: job.catalogName,
          condition: "staleness",
          detail: "No completed runs found at all.",
        });
        continue;
      }

      const latest = runs[0];
      if (latest.finished_at < stalenessCutoff) {
        alerts.push({
          job: job.catalogName,
          condition: "staleness",
          detail: `Most recent run finished at ${latest.finished_at}, older than ${STALENESS_HOURS}h cutoff (${stalenessCutoff}).`,
        });
      }

      // ── 2. Failure — job-specific logic ────────────────────────────────
      if (job.catalogName === "refresh_existing") {
        // Single-run threshold: failed >= 3 (baseline is 1).
        if (typeof latest.failed === "number" && latest.failed >= REFRESH_FAILED_THRESHOLD) {
          alerts.push({
            job: job.catalogName,
            condition: "failed_regression",
            detail: `Latest run failed=${latest.failed} (threshold ${REFRESH_FAILED_THRESHOLD}, baseline 1). last_error: ${latest.last_error ?? "null"}`,
          });
        }

        // ok=false means circuit breaker tripped (5+ consecutive TMDB failures).
        // Note: 4 failures still reports ok=true, so failed regression is the
        // primary signal; ok=false catches catastrophic upstream outage.
        if (latest.ok === false) {
          alerts.push({
            job: job.catalogName,
            condition: "ok_false",
            detail: `Latest run ok=false (circuit breaker tripped). last_error: ${latest.last_error ?? "null"}`,
          });
        }

        // Throughput: processed < 50% of expected batch.
        // With a fixed batch=50, processed=49 is steady state. A material drop
        // means upstream trouble (TMDB errors, rate limiting, partial circuit
        // breaker trip).
        const minProcessed = Math.floor(REFRESH_EXPECTED_BATCH * REFRESH_PROCESSED_MIN_RATIO);
        if (typeof latest.processed === "number" && latest.processed < minProcessed) {
          alerts.push({
            job: job.catalogName,
            condition: "low_throughput",
            detail: `Latest run processed=${latest.processed}, below minimum ${minProcessed} (${REFRESH_PROCESSED_MIN_RATIO * 100}% of batch ${REFRESH_EXPECTED_BATCH}).`,
          });
        }
      } else {
        // notify_watchlist / deliver_watchlist: persistence condition.
        // Alert only when TWO consecutive runs both have failed > 0.
        // Filters out transient Resend errors or single bounced addresses.
        if (runs.length >= 2) {
          const [run1, run2] = runs;
          if (
            typeof run1.failed === "number" && run1.failed > 0 &&
            typeof run2.failed === "number" && run2.failed > 0
          ) {
            alerts.push({
              job: job.catalogName,
              condition: "consecutive_failures",
              detail: `Two consecutive runs with failures: latest failed=${run1.failed} (${run1.finished_at}), previous failed=${run2.failed} (${run2.finished_at}). last_error: ${run1.last_error ?? "null"}`,
            });
          }
        }

        // ok=false on latest run — indicates a thrown exception, not just
        // per-item failures. Always worth flagging.
        if (latest.ok === false) {
          alerts.push({
            job: job.catalogName,
            condition: "ok_false",
            detail: `Latest run ok=false. last_error: ${latest.last_error ?? "null"}`,
          });
        }
      }
    }

    // ── 3. Backlog check: unprocessed availability_changes > 26h ─────────
    const backlogCutoff = new Date(now.getTime() - BACKLOG_HOURS * 3600 * 1000).toISOString();
    const { count: stuckCount, error: backlogErr } = await sb
      .from("availability_changes")
      .select("id", { count: "exact", head: true })
      .is("processed_at", null)
      .lt("detected_at", backlogCutoff);

    if (backlogErr) {
      alerts.push({
        job: "notify_watchlist",
        condition: "backlog_query_error",
        detail: `availability_changes backlog query failed: ${backlogErr.message}`,
      });
    } else if (stuckCount !== null && stuckCount > 0) {
      alerts.push({
        job: "notify_watchlist",
        condition: "backlog",
        detail: `${stuckCount} availability_changes row(s) unprocessed for > ${BACKLOG_HOURS}h.`,
      });
    }

    // ── 4. Secondary: net._http_response non-2xx status codes ────────────
    // Would catch the HAPL_SYNC_TOKEN-401 shape (real HTTP error returned
    // within 5s, so status_code is non-NULL). Rows with status_code IS NULL
    // + timed_out are IGNORED (Finding 1: normal pg_net behavior).
    //
    // net._http_response lives in the `net` schema, not accessible via the
    // Supabase JS client (public schema only). Adding an RPC wrapper is
    // possible but low priority — the primary checks via catalog_job_runs
    // already cover the failure modes that matter. If a future migration
    // adds a public wrapper function, this check can be enabled.
    console.log("[hapl-healthcheck] net._http_response check skipped (net schema not accessible via JS client)");

    // ── Alerting ─────────────────────────────────────────────────────────
    const healthy = alerts.length === 0;

    if (!healthy) {
      console.warn(`[hapl-healthcheck] ${alerts.length} alert(s) detected:`);
      for (const a of alerts) {
        console.warn(`  [${a.job}] ${a.condition}: ${a.detail}`);
      }

      const html = buildAlertEmail(alerts);
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: fromAddress,
            to: adminEmail,
            subject: `HAPL Healthcheck — ${alerts.length} alert(s)`,
            html,
          }),
        });

        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          console.error(`[hapl-healthcheck] Resend error: ${res.status} ${errBody}`);
          lastError = `Resend ${res.status}: ${errBody.slice(0, 200)}`;
        } else {
          console.log("[hapl-healthcheck] alert email sent");
        }
      } catch (e) {
        console.error("[hapl-healthcheck] email send failed:", (e as Error).message);
        lastError = (e as Error).message;
      }
    } else {
      console.log("[hapl-healthcheck] all checks passed, no alert sent");
    }

    // ── Self-log: update run row ─────────────────────────────────────────
    if (runId) {
      await sb.from("catalog_job_runs").update({
        finished_at: new Date().toISOString(),
        ok: healthy,
        processed: MONITORED_JOBS.length,
        changed: alerts.length,
        failed: healthy ? 0 : alerts.length,
        last_error: lastError ?? (healthy ? null : alerts.map((a) => `${a.job}:${a.condition}`).join("; ")),
        payload: {
          alerts,
          checked_jobs: MONITORED_JOBS.map((j) => j.catalogName),
        },
      }).eq("id", runId);
    }

    return new Response(
      JSON.stringify({
        ok: healthy,
        alerts,
        run_id: runId,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[hapl-healthcheck] error:", err);
    if (runId) {
      await sb.from("catalog_job_runs").update({
        finished_at: new Date().toISOString(),
        ok: false,
        processed: 0,
        changed: 0,
        failed: 1,
        last_error: err.message,
      }).eq("id", runId);
    }
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function buildAlertEmail(alerts: Alert[]): string {
  const rows = alerts.map((a) =>
    `<tr>
      <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-family: monospace; font-size: 13px;">${escapeHtml(a.job)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px;">${escapeHtml(a.condition)}</td>
      <td style="padding: 8px 12px; border-bottom: 1px solid #eee; font-size: 13px;">${escapeHtml(a.detail)}</td>
    </tr>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="tr">
<head><meta charset="utf-8"></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 24px;">
  <h2 style="margin: 0 0 8px; color: #c0392b;">⚠️ HAPL Healthcheck Alert</h2>
  <p style="margin: 0 0 16px; color: #555; font-size: 14px;">
    ${alerts.length} issue(s) detected at ${new Date().toISOString()}.
  </p>
  <table style="width: 100%; border-collapse: collapse; border: 1px solid #ddd;">
    <thead>
      <tr style="background: #f8f8f8;">
        <th style="padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Job</th>
        <th style="padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Condition</th>
        <th style="padding: 8px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666;">Detail</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  <p style="margin-top: 24px; color: #888; font-size: 12px;">
    Bu e-posta HAPL healthcheck tarafından otomatik gönderilmiştir.<br>
    Kontrol: Lovable Cloud SQL Editor → <code>SELECT * FROM catalog_job_runs WHERE job_name = 'healthcheck' ORDER BY finished_at DESC LIMIT 5;</code>
  </p>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
