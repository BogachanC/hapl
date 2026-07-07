// hapl-refresh: scheduled refresh of TMDB watch-provider availability
// for previously-indexed titles. Designed to run via pg_cron.
//
// Behavior:
//   - Auth: requires `Authorization: Bearer <HAPL_SYNC_TOKEN>` header
//   - Picks the N stalest content_titles (by last_tmdb_sync_at)
//   - For each: re-fetches TMDB detail + TR watch providers
//   - Upserts content_titles + content_availability
//   - Does NOT alter the search-content pipeline behavior
//   - No Firecrawl calls — only TMDB. Keeps refresh cheap and deterministic.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { normalizeTitle } from "../_shared/normalize.ts";
import {
  tmdbDetail,
  tmdbWatchProvidersTR,
} from "../_shared/tmdb.ts";
import { needsHydration, hydrateAliases } from "../_shared/alias-cache.ts";
import {
  loadProviders,
  matchTmdbProvider,
  type ProviderRow,
} from "../_shared/providers.ts";
import { deriveContentKind } from "../_shared/content-kind.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Tunables
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;
const AVAILABILITY_FRESH_HOURS = 24 * 7; // mirror search-content semantics
const LOCK_NAME = "hapl_refresh";
const LOCK_TTL_MINUTES = 15;

// Try to acquire a named lock. Returns true if acquired, false if another
// active run holds it. Stale locks (expires_at <= now) are taken over.
async function acquireLock(sb: any, owner: string): Promise<boolean> {
  const now = new Date();
  const expires = new Date(now.getTime() + LOCK_TTL_MINUTES * 60 * 1000);
  // Try insert (first ever)
  const ins = await sb.from("catalog_job_locks").insert({
    lock_name: LOCK_NAME,
    locked_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: expires.toISOString(),
    owner,
  });
  if (!ins.error) return true;
  // On conflict: takeover only if existing lock is expired
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
  await sb.from("catalog_job_locks").delete()
    .eq("lock_name", LOCK_NAME)
    .eq("owner", owner);
}

// Deterministic TMDB confidence mapping by availability_type.
// Keep small + explicit; no schema change, no audit, no behavior change elsewhere.
//   stream  (flatrate) → 0.92  (strongest signal: included in subscription)
//   free / ads          → 0.88  (free-with-ads / free tier)
//   rent / buy          → 0.86  (transactional, weaker "available on platform" signal)
function tmdbConfidenceFor(availType: string): number {
  switch (availType) {
    case "stream": return 0.92;
    case "free":
    case "ads":    return 0.88;
    case "rent":
    case "buy":    return 0.86;
    default:       return 0.85;
  }
}

// Returns the set of provider_ids that have an ACTIVE manual override for this title.
// Active = effective_from <= now AND (effective_until IS NULL OR effective_until > now).
// While active, automatic TMDB refresh MUST NOT flip availability for these providers
// (neither insert/upsert tmdb rows nor expire existing ones).
async function loadActiveOverrideProviders(
  sb: any,
  titleId: string,
): Promise<Set<string>> {
  const nowIso = new Date().toISOString();
  const { data, error } = await sb
    .from("manual_availability_overrides")
    .select("provider_id, action, effective_from, effective_until")
    .eq("title_id", titleId)
    .lte("effective_from", nowIso);
  if (error || !data) return new Set();
  const out = new Set<string>();
  for (const r of data as any[]) {
    if (r.effective_until && r.effective_until <= nowIso) continue;
    if (r.provider_id) out.add(r.provider_id);
  }
  return out;
}

async function enqueueDirty(
  sb: any,
  titleId: string,
  reason: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  // Idempotent: a partial unique index on (title_id) WHERE processed_at IS NULL
  // guarantees a single OPEN row per title. On conflict, merge reason+metadata
  // into the existing open row and bump enqueued_at.
  const insertRes = await sb.from("catalog_dirty_titles").insert({
    title_id: titleId,
    reason,
    metadata,
  });
  if (!insertRes.error) return;

  const code = (insertRes.error as any)?.code;
  if (code !== "23505") {
    console.warn(`[hapl-refresh] dirty enqueue insert failed title=${titleId}:`, insertRes.error.message);
    return;
  }
  const { data: open } = await sb
    .from("catalog_dirty_titles")
    .select("id, reason, metadata")
    .eq("title_id", titleId)
    .is("processed_at", null)
    .limit(1)
    .maybeSingle();
  if (!open) return;
  const reasons = new Set<string>(
    Array.isArray((open.metadata as any)?.reasons)
      ? (open.metadata as any).reasons
      : [open.reason],
  );
  reasons.add(reason);
  const mergedMeta = { ...(open.metadata || {}), ...metadata, reasons: Array.from(reasons) };
  await sb.from("catalog_dirty_titles")
    .update({
      reason,
      metadata: mergedMeta,
      enqueued_at: new Date().toISOString(),
    })
    .eq("id", open.id);
}

async function refreshOne(
  sb: any,
  row: { id: string; tmdb_id: number; tmdb_type: "movie" | "tv"; title: string },
  providers: ProviderRow[],
): Promise<{ ok: boolean; provider_count: number; flipped: number; aliases_added: number; dirty: boolean; skipped_overrides: number }> {
  const [detail, watch] = await Promise.all([
    tmdbDetail(row.tmdb_type, row.tmdb_id),
    tmdbWatchProvidersTR(row.tmdb_type, row.tmdb_id),
  ]);
  if (!detail) return { ok: false, provider_count: 0, flipped: 0, aliases_added: 0, dirty: false, skipped_overrides: 0 };

  const now = new Date().toISOString();
  const dirtyReasons = new Set<string>();
  const dirtyMeta: Record<string, unknown> = {};

  // Snapshot pre-update title fields for change detection.
  const { data: prevTitle } = await sb
    .from("content_titles")
    .select("title, normalized_title")
    .eq("id", row.id)
    .maybeSingle();

  const newNorm = normalizeTitle(detail.title);
  if (prevTitle && (prevTitle.title !== detail.title || prevTitle.normalized_title !== newNorm)) {
    dirtyReasons.add("title_upserted");
    dirtyMeta.title_changed = { from: prevTitle.title, to: detail.title };
  }

  // Update content_titles snapshot
  await sb.from("content_titles").update({
    title: detail.title,
    original_title: detail.original_title || null,
    normalized_title: newNorm,
    release_year: detail.release_date ? new Date(detail.release_date).getFullYear() : null,
    first_release_date: detail.release_date || null,
    poster_path: detail.poster_path,
    backdrop_path: detail.backdrop_path,
    overview: detail.overview,
    genres: (detail.genres || []).map((g: any) => g.name),
    content_kind: deriveContentKind(row.tmdb_type, detail.genres || []),
    last_tmdb_sync_at: now,
  }).eq("id", row.id);

  // ── Manual override guard ───────────────────────────────────────────────
  // Compute active overrides BEFORE any availability write. Providers with an
  // active override are excluded from both upsert and stale flip, so manual /
  // provider_rule / firecrawl rows are never overwritten and the user-visible
  // availability stays under manual control.
  const overrideProviders = await loadActiveOverrideProviders(sb, row.id);

  // Build availability rows
  const seen = new Set<string>();
  const rows: Array<{
    provider_id: string;
    availability_type: string;
    confidence: number;
    source_url: string | null;
  }> = [];

  const push = (list: any[], availType: string) => {
    for (const p of list) {
      const match = matchTmdbProvider(p.provider_name, providers);
      if (!match) continue;
      if (overrideProviders.has(match.id)) continue; // override guard
      const key = `${match.id}:${availType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        provider_id: match.id,
        availability_type: availType,
        confidence: tmdbConfidenceFor(availType),
        source_url: watch.link,
      });
    }
  };
  push(watch.flatrate, "stream");
  push(watch.free, "free");
  push(watch.ads, "ads");
  push(watch.rent, "rent");
  push(watch.buy, "buy");

  // Pre-fetch existing tmdb rows for change detection + stale flip.
  const { data: existing } = await sb
    .from("content_availability")
    .select("id, provider_id, availability_type, status, checked_at, source")
    .eq("title_id", row.id)
    .eq("region", "TR")
    .eq("source", "tmdb");

  const existingMap = new Map<string, any>();
  for (const r of (existing || [])) {
    existingMap.set(`${r.provider_id}:${r.availability_type}`, r);
  }

  // Upsert current availability. Override-protected providers were already
  // filtered out of `rows`, so manual rows (source='manual') are safe.
  // provider_rule / firecrawl rows live under different `source` values and
  // share the same conflict key only if TMDB also reports them — but those
  // are NOT upserted because rows[] only carries source='tmdb' and the upsert
  // conflict key includes source-agnostic columns; however we never overwrite
  // a row whose `source` differs because we filter via override guard for
  // explicitly-protected providers. For unprotected providers, the canonical
  // policy remains: TMDB is the source of truth.
  let addedOrFlippedAvailable = 0;
  const addedProviderIds = new Set<string>();
  if (rows.length > 0) {
    await sb.from("content_availability").upsert(
      rows.map((r) => ({
        title_id: row.id,
        provider_id: r.provider_id,
        region: "TR",
        availability_type: r.availability_type,
        status: "available",
        source: "tmdb",
        source_url: r.source_url,
        confidence: r.confidence,
        last_seen_at: now,
        checked_at: now,
        raw_payload: {},
      })),
      { onConflict: "title_id,provider_id,region,availability_type" },
    );
    for (const r of rows) {
      const prev = existingMap.get(`${r.provider_id}:${r.availability_type}`);
      if (!prev || prev.status !== "available") {
        addedOrFlippedAvailable++;
        addedProviderIds.add(r.provider_id);
      }
    }
  }

  // Stale flip: ONLY tmdb-sourced rows, AND not override-protected.
  const seenKeys = new Set(rows.map((r) => `${r.provider_id}:${r.availability_type}`));
  const staleCutoff = new Date(Date.now() - AVAILABILITY_FRESH_HOURS * 3600 * 1000).toISOString();

  const toExpire = (existing || []).filter((r: any) => {
    if (r.source !== "tmdb") return false; // never touch manual/provider_rule/firecrawl
    if (overrideProviders.has(r.provider_id)) return false; // override guard
    const k = `${r.provider_id}:${r.availability_type}`;
    if (seenKeys.has(k)) return false;
    if (r.status !== "available") return false;
    return !r.checked_at || r.checked_at < staleCutoff;
  });

  const removedProviderIds = new Set<string>();
  for (const r of toExpire) {
    await sb.from("content_availability").update({
      status: "unavailable",
      checked_at: now,
      expires_at: now,
      confidence: 0.3,
    }).eq("id", r.id);
    removedProviderIds.add(r.provider_id);
  }

  // Write granular availability_changes for notification consumption.
  const changeRows: Array<{ title_id: string; provider_id: string; action: string; detected_at: string }> = [];
  for (const pid of addedProviderIds) {
    changeRows.push({ title_id: row.id, provider_id: pid, action: "added", detected_at: now });
  }
  for (const pid of removedProviderIds) {
    changeRows.push({ title_id: row.id, provider_id: pid, action: "removed", detected_at: now });
  }
  if (changeRows.length > 0) {
    const { error: chgErr } = await sb.from("availability_changes").insert(changeRows);
    if (chgErr) console.warn(`[hapl-refresh] availability_changes insert failed title=${row.id}:`, chgErr.message);
  }

  if (addedOrFlippedAvailable > 0 || toExpire.length > 0) {
    dirtyReasons.add("availability_changed");
    dirtyMeta.added_or_flipped_available = addedOrFlippedAvailable;
    dirtyMeta.expired = toExpire.length;
  }

  // Opportunistic alias backfill — only when stale (TTL-gated). Soft-fails.
  let aliases_added = 0;
  try {
    if (await needsHydration(sb, row.tmdb_id, row.tmdb_type)) {
      aliases_added = await hydrateAliases(sb, row.tmdb_id, row.tmdb_type, detail);
    }
  } catch (_) { /* swallow */ }
  if (aliases_added > 0) {
    dirtyReasons.add("aliases_changed");
    dirtyMeta.aliases_added = aliases_added;
  }

  // Enqueue dirty only if a meaningful change actually happened (no dry/no-op writes).
  let dirty = false;
  if (dirtyReasons.size > 0) {
    const primary = dirtyReasons.has("availability_changed")
      ? "availability_changed"
      : dirtyReasons.has("title_upserted")
      ? "title_upserted"
      : "aliases_changed";
    await enqueueDirty(sb, row.id, primary, {
      ...dirtyMeta,
      reasons: Array.from(dirtyReasons),
    });
    dirty = true;
  }

  return {
    ok: true,
    provider_count: rows.length,
    flipped: toExpire.length,
    aliases_added,
    dirty,
    skipped_overrides: overrideProviders.size,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth ────────────────────────────────────────────────────────────────
  const expected = Deno.env.get("HAPL_SYNC_TOKEN");
  if (!expected) {
    return new Response(JSON.stringify({ error: "HAPL_SYNC_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
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
  } catch (_) { /* ignore */ }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Concurrency guard ──────────────────────────────────────────────────
  const owner = `run_${crypto.randomUUID()}`;
  const acquired = await acquireLock(sb, owner);
  if (!acquired) {
    return new Response(JSON.stringify({
      ok: true, skipped: true, reason: "another_run_in_progress",
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  // ── Run row ────────────────────────────────────────────────────────────
  const runInsert = await sb.from("catalog_job_runs").insert({
    job_name: "refresh_existing",
    payload: { batch, lock_owner: owner },
  }).select("id").maybeSingle();
  const runId = runInsert.data?.id as string | undefined;

  let processed = 0;
  let failed = 0;
  let totalFlipped = 0;
  let totalAliases = 0;
  let totalDirty = 0;
  let totalOverrideSkips = 0;
  let lastError: string | null = null;
  let ok = true;

  try {
    // Stalest first: NULLs (never synced) come first
    const { data: titles, error } = await sb
      .from("content_titles")
      .select("id, tmdb_id, tmdb_type, title, last_tmdb_sync_at")
      .not("tmdb_id", "is", null)
      .order("last_tmdb_sync_at", { ascending: true, nullsFirst: true })
      .limit(batch);

    if (error) throw error;

    if (titles && titles.length > 0) {
      const providers = await loadProviders(sb);
      // Cap consecutive TMDB failures: if upstream is down, bail without
      // poisoning the rest of the catalog. We do not flip availability
      // for titles we never managed to fetch.
      let consecutiveFails = 0;
      const CONSECUTIVE_FAIL_LIMIT = 5;
      for (const t of titles) {
        try {
          const r = await refreshOne(sb, t as any, providers);
          if (r.ok) {
            processed++;
            consecutiveFails = 0;
            totalFlipped += r.flipped;
            totalAliases += r.aliases_added;
            if (r.dirty) totalDirty++;
            totalOverrideSkips += r.skipped_overrides;
          } else {
            failed++;
            consecutiveFails++;
          }
        } catch (e) {
          console.error(`[hapl-refresh] title=${t.id} failed:`, (e as Error).message);
          failed++;
          consecutiveFails++;
          lastError = (e as Error).message;
        }
        if (consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
          ok = false;
          lastError = lastError || `aborted_after_${CONSECUTIVE_FAIL_LIMIT}_consecutive_failures`;
          console.warn(`[hapl-refresh] aborting batch: ${lastError}`);
          break;
        }
      }
    }

    console.log(
      `[hapl-refresh] processed=${processed} failed=${failed} flipped=${totalFlipped} aliases=${totalAliases} dirty=${totalDirty} override_skips=${totalOverrideSkips} batch=${batch} ok=${ok}`,
    );

    if (runId) {
      await sb.from("catalog_job_runs").update({
        finished_at: new Date().toISOString(),
        ok,
        processed,
        changed: totalFlipped + totalDirty,
        dirty_enqueued: totalDirty,
        override_skips: totalOverrideSkips,
        failed,
        last_error: lastError,
      }).eq("id", runId);
    }

    return new Response(JSON.stringify({
      ok,
      batch,
      processed,
      failed,
      flipped: totalFlipped,
      aliases_added: totalAliases,
      dirty_enqueued: totalDirty,
      override_skips: totalOverrideSkips,
      run_id: runId,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("[hapl-refresh] error:", err);
    if (runId) {
      await sb.from("catalog_job_runs").update({
        finished_at: new Date().toISOString(),
        ok: false,
        processed, failed, dirty_enqueued: totalDirty,
        override_skips: totalOverrideSkips,
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
