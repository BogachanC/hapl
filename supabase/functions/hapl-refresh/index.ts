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
import {
  loadProviders,
  matchTmdbProvider,
  type ProviderRow,
} from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Tunables
const DEFAULT_BATCH = 25;
const MAX_BATCH = 100;
const AVAILABILITY_FRESH_HOURS = 24 * 7; // mirror search-content semantics

function deriveContentKind(
  mediaType: "movie" | "tv",
  genres: { id: number; name: string }[],
): string {
  const gnames = (genres || []).map((g) => (g.name || "").toLowerCase());
  const isDoc = gnames.some((g) => g.includes("belgesel") || g.includes("documentary"));
  const isReality =
    gnames.some((g) => g.includes("reality") || g.includes("realite")) ||
    gnames.some((g) => g.includes("yarışma") || g.includes("yarisma"));
  if (isDoc) return "documentary";
  if (mediaType === "tv" && isReality) return "reality";
  if (mediaType === "movie") return "movie";
  return "series";
}

async function refreshOne(
  sb: any,
  row: { id: string; tmdb_id: number; tmdb_type: "movie" | "tv"; title: string },
  providers: ProviderRow[],
): Promise<{ ok: boolean; provider_count: number; flipped: number }> {
  const [detail, watch] = await Promise.all([
    tmdbDetail(row.tmdb_type, row.tmdb_id),
    tmdbWatchProvidersTR(row.tmdb_type, row.tmdb_id),
  ]);
  if (!detail) return { ok: false, provider_count: 0, flipped: 0 };

  const now = new Date().toISOString();

  // Update content_titles snapshot
  await sb.from("content_titles").update({
    title: detail.title,
    original_title: detail.original_title || null,
    normalized_title: normalizeTitle(detail.title),
    release_year: detail.release_date ? new Date(detail.release_date).getFullYear() : null,
    first_release_date: detail.release_date || null,
    poster_path: detail.poster_path,
    backdrop_path: detail.backdrop_path,
    overview: detail.overview,
    genres: (detail.genres || []).map((g: any) => g.name),
    content_kind: deriveContentKind(row.tmdb_type, detail.genres || []),
    last_tmdb_sync_at: now,
  }).eq("id", row.id);

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
      const key = `${match.id}:${availType}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        provider_id: match.id,
        availability_type: availType,
        confidence: 0.9,
        source_url: watch.link,
      });
    }
  };
  push(watch.flatrate, "stream");
  push(watch.free, "free");
  push(watch.ads, "ads");
  push(watch.rent, "rent");
  push(watch.buy, "buy");

  // Upsert current availability
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
  }

  // Stale flip: rows not seen in this refresh AND old enough
  const seenKeys = new Set(rows.map((r) => `${r.provider_id}:${r.availability_type}`));
  const staleCutoff = new Date(Date.now() - AVAILABILITY_FRESH_HOURS * 3600 * 1000).toISOString();
  const { data: existing } = await sb
    .from("content_availability")
    .select("id, provider_id, availability_type, status, checked_at")
    .eq("title_id", row.id)
    .eq("region", "TR");

  const toExpire = (existing || []).filter((r: any) => {
    const k = `${r.provider_id}:${r.availability_type}`;
    if (seenKeys.has(k)) return false;
    if (r.status !== "available") return false;
    return !r.checked_at || r.checked_at < staleCutoff;
  });

  for (const r of toExpire) {
    await sb.from("content_availability").update({
      status: "unavailable",
      checked_at: now,
      expires_at: now,
      confidence: 0.3,
    }).eq("id", r.id);
  }

  return { ok: true, provider_count: rows.length, flipped: toExpire.length };
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

  try {
    // Stalest first: NULLs (never synced) come first
    const { data: titles, error } = await sb
      .from("content_titles")
      .select("id, tmdb_id, tmdb_type, title, last_tmdb_sync_at")
      .order("last_tmdb_sync_at", { ascending: true, nullsFirst: true })
      .limit(batch);

    if (error) throw error;
    if (!titles || titles.length === 0) {
      return new Response(JSON.stringify({ ok: true, processed: 0, message: "no titles" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const providers = await loadProviders(sb);

    let processed = 0;
    let failed = 0;
    let totalFlipped = 0;
    const details: Array<{ id: string; title: string; providers: number; flipped: number }> = [];

    for (const t of titles) {
      try {
        const r = await refreshOne(sb, t as any, providers);
        if (r.ok) {
          processed++;
          totalFlipped += r.flipped;
          details.push({
            id: t.id, title: t.title, providers: r.provider_count, flipped: r.flipped,
          });
        } else {
          failed++;
        }
      } catch (e) {
        console.error(`[hapl-refresh] title=${t.id} failed:`, (e as Error).message);
        failed++;
      }
    }

    console.log(
      `[hapl-refresh] processed=${processed} failed=${failed} flipped=${totalFlipped} batch=${batch}`,
    );

    return new Response(JSON.stringify({
      ok: true,
      batch,
      processed,
      failed,
      flipped: totalFlipped,
      details,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[hapl-refresh] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
