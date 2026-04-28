import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { cacheKey, normalizeTitle } from "../_shared/normalize.ts";
import { rankTmdbResults } from "../_shared/relevance.ts";
import {
  tmdbMultiSearch,
  tmdbDetail,
  tmdbWatchProvidersTR,
  tmdbImage,
} from "../_shared/tmdb.ts";
import { firecrawlSearchText } from "../_shared/firecrawl.ts";
import {
  loadProviders,
  matchTmdbProvider,
  extractProvidersFromText,
  type ProviderRow,
} from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_ENRICH = 5;
// Firecrawl is invoked when title match is strong enough.
// Used both as fallback (TMDB=0 providers) and as gap-filler
// (complete missing firecrawl_enabled providers TMDB didn't return).
const FIRECRAWL_MIN_SCORE = 0.7;
// How long an availability row stays "fresh" before considered stale
// TEMP: 0 for stale-flip live test. Restore to 24*7 after verification.
const AVAILABILITY_FRESH_HOURS = 0;

interface PlatformOut {
  id?: number;
  name: string;
  logo: string | null;
  type: "subscription" | "rent" | "free";
  link: string | null;
  source?: "tmdb" | "firecrawl";
}

interface ContentResultOut {
  id: number;
  type: "movie" | "tv";
  title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  imdb_rating: number | null;
  vote_count: number;
  genres: string[];
  platforms: PlatformOut[];
  tmdb_url: string;
  available_in_tr: boolean;
  confidence: number;
}

// ─── cache helpers ────────────────────────────────────────────────────────
async function getFromCache(sb: any, key: string): Promise<ContentResultOut[] | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_SECONDS * 1000).toISOString();
  const { data } = await sb
    .from("search_cache")
    .select("results")
    .eq("cache_key", key)
    .gt("created_at", cutoff)
    .maybeSingle();
  return data?.results || null;
}

async function writeToCache(sb: any, key: string, results: ContentResultOut[]) {
  await sb.from("search_cache").upsert(
    { cache_key: key, results, created_at: new Date().toISOString() },
    { onConflict: "cache_key" },
  );
}

// ─── DB persistence (best-effort, won't block response) ───────────────────
// Map TMDB media_type + genres → our content_kind enum-ish value
// Schema expects: movie | series | documentary | reality
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

async function persistTitle(
  sb: any,
  candidate: { id: number; media_type: "movie" | "tv" },
  detail: any,
): Promise<string | null> {
  try {
    const row = {
      tmdb_id: candidate.id,
      tmdb_type: candidate.media_type,
      title: detail.title,
      original_title: detail.original_title || null,
      normalized_title: normalizeTitle(detail.title),
      release_year: detail.release_date ? new Date(detail.release_date).getFullYear() : null,
      first_release_date: detail.release_date || null,
      poster_path: detail.poster_path,
      backdrop_path: detail.backdrop_path,
      overview: detail.overview,
      genres: (detail.genres || []).map((g: any) => g.name),
      content_kind: deriveContentKind(candidate.media_type, detail.genres || []),
      last_tmdb_sync_at: new Date().toISOString(),
      last_requested_at: new Date().toISOString(),
    };
    const { data, error } = await sb
      .from("content_titles")
      .upsert(row, { onConflict: "tmdb_id,tmdb_type" })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("persistTitle error:", error.message);
      return null;
    }
    return data?.id || null;
  } catch (err) {
    console.error("persistTitle exception:", err);
    return null;
  }
}

/**
 * Persist availability with stale handling.
 * - Upserts current findings as status="available"
 * - Marks previously-available rows that weren't seen this sync as "unavailable"
 *   (only those checked over AVAILABILITY_FRESH_HOURS ago, to avoid race flips)
 */
async function persistAvailability(
  sb: any,
  titleId: string,
  rows: Array<{
    provider_id: string;
    source: "tmdb" | "firecrawl";
    availability_type: string;
    confidence: number;
    source_url: string | null;
  }>,
) {
  if (!titleId) return;
  const now = new Date().toISOString();
  try {
    if (rows.length > 0) {
      await sb.from("content_availability").upsert(
        rows.map((r) => ({
          title_id: titleId,
          provider_id: r.provider_id,
          region: "TR",
          availability_type: r.availability_type,
          status: "available",
          source: r.source,
          source_url: r.source_url,
          confidence: r.confidence,
          last_seen_at: now,
          checked_at: now,
          raw_payload: {},
        })),
        { onConflict: "title_id,provider_id,region,availability_type" },
      );
    }

    // Stale handling: existing rows for this title NOT in the current set →
    // mark unavailable (but only if their previous check was old enough).
    const seenKeys = new Set(rows.map((r) => `${r.provider_id}:${r.availability_type}`));
    const staleCutoff = new Date(Date.now() - AVAILABILITY_FRESH_HOURS * 3600 * 1000).toISOString();
    const { data: existing } = await sb
      .from("content_availability")
      .select("id, provider_id, availability_type, status, checked_at")
      .eq("title_id", titleId)
      .eq("region", "TR");

    const toExpire = (existing || []).filter((row: any) => {
      const key = `${row.provider_id}:${row.availability_type}`;
      if (seenKeys.has(key)) return false;
      if (row.status !== "available") return false;
      // Only flip if it was last checked before the freshness window
      return !row.checked_at || row.checked_at < staleCutoff;
    });

    for (const r of toExpire) {
      await sb
        .from("content_availability")
        .update({
          status: "unavailable",
          checked_at: now,
          expires_at: now,
          confidence: 0.3,
        })
        .eq("id", r.id);
    }
  } catch (err) {
    console.error("persistAvailability exception:", err);
  }
}

// ─── per-candidate enrichment ─────────────────────────────────────────────
async function enrichCandidate(
  sb: any,
  query: string,
  cand: ReturnType<typeof rankTmdbResults>[number],
  providers: ProviderRow[],
): Promise<ContentResultOut | null> {
  const [detail, watch] = await Promise.all([
    tmdbDetail(cand.media_type, cand.id),
    tmdbWatchProvidersTR(cand.media_type, cand.id),
  ]);
  if (!detail) return null;

  // ── TMDB → mapped platforms ─────────────────────────────────────────────
  const seen = new Set<string>();
  const platforms: PlatformOut[] = [];
  const availabilityRows: Array<{
    provider_id: string; source: "tmdb" | "firecrawl";
    availability_type: string; confidence: number; source_url: string | null;
  }> = [];

  const pushFromTmdb = (
    list: any[],
    type: "subscription" | "rent" | "free",
    availType: string,
  ) => {
    for (const p of list) {
      const match = matchTmdbProvider(p.provider_name, providers);
      if (!match) continue;
      if (seen.has(match.slug)) continue;
      seen.add(match.slug);
      platforms.push({
        id: p.provider_id,
        name: match.display_name,
        logo: tmdbImage(p.logo_path, "original"),
        type,
        link: watch.link,
        source: "tmdb",
      });
      availabilityRows.push({
        provider_id: match.id,
        source: "tmdb",
        availability_type: availType,
        confidence: 0.9,
        source_url: watch.link,
      });
    }
  };
  pushFromTmdb(watch.flatrate, "subscription", "stream");
  pushFromTmdb(watch.free, "free", "free");
  pushFromTmdb(watch.ads, "free", "ads");
  pushFromTmdb(watch.rent, "rent", "rent");
  pushFromTmdb(watch.buy, "rent", "buy");

  // ── Firecrawl: fallback + gap-filler ────────────────────────────────────
  // Runs when title match is strong AND there is at least one
  // firecrawl_enabled provider that TMDB did NOT already report for this title.
  let usedFirecrawl = false;
  const firecrawlEligible = providers.filter(
    (p) => p.firecrawl_enabled && !seen.has(p.slug),
  );
  // Skip firecrawl on low-popularity duplicate titles. Even when the
  // normalized title is an exact match (score ≥ 0.9), an obscure same-name
  // entry with very few votes shouldn't inherit mainstream search results.
  const popularEnough = (cand.vote_count ?? 0) >= 50;
  const shouldRunFirecrawl =
    cand.score >= FIRECRAWL_MIN_SCORE &&
    popularEnough &&
    firecrawlEligible.length > 0;

  if (shouldRunFirecrawl) {
    const text = await firecrawlSearchText(detail.title, cand.release_year);
    if (text) {
      usedFirecrawl = true;
      // Only consider providers TMDB didn't already supply
      const fcResults = extractProvidersFromText(text, firecrawlEligible, detail.title);
      for (const { provider: p, confidence } of fcResults) {
        if (seen.has(p.slug)) continue;
        seen.add(p.slug);
        platforms.push({
          name: p.display_name,
          logo: null,
          type: "subscription",
          link: null,
          source: "firecrawl",
        });
        availabilityRows.push({
          provider_id: p.id,
          source: "firecrawl",
          availability_type: "stream",
          confidence,
          source_url: null,
        });
      }
      console.log(
        `[hapl] firecrawl gap-fill: title="${detail.title}" added=${fcResults.length} ` +
        `tmdb_count=${platforms.length - fcResults.length}`,
      );
    }
  }

  // ── Persist (fire-and-forget) ───────────────────────────────────────────
  persistTitle(sb, { id: cand.id, media_type: cand.media_type }, detail).then(
    (titleId) => {
      if (titleId) persistAvailability(sb, titleId, availabilityRows);
    },
  ).catch(() => {});

  // ── Confidence: blend TMDB strength + relevance score ───────────────────
  const tmdbHit = platforms.some((p) => p.source === "tmdb");
  const base = tmdbHit ? 0.85 : usedFirecrawl ? 0.45 : 0;
  const confidence = Math.round(Math.min(1, base + cand.score * 0.15) * 100);

  return {
    id: cand.id,
    type: cand.media_type,
    title: detail.title,
    year: cand.release_year,
    overview: detail.overview,
    poster: tmdbImage(detail.poster_path, "w500"),
    backdrop: tmdbImage(detail.backdrop_path, "w780"),
    imdb_rating: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
    vote_count: detail.vote_count,
    genres: (detail.genres || []).map((g: any) => g.name),
    platforms,
    tmdb_url: `https://www.themoviedb.org/${cand.media_type}/${cand.id}`,
    available_in_tr: platforms.length > 0,
    confidence,
  };
}

// ─── handler ──────────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    const { query } = await req.json();
    if (!query || typeof query !== "string" || !query.trim()) {
      return new Response(JSON.stringify({ error: "query parametresi zorunlu" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = cacheKey(query);

    // 1. Cache
    const cached = await getFromCache(sb, key);
    if (cached) {
      console.log(`[hapl] cache hit: ${key}`);
      return new Response(JSON.stringify({ results: cached, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2. TMDB multi-search + rank
    const raw = await tmdbMultiSearch(query.trim());
    const ranked = rankTmdbResults(query, raw);
    console.log(`[hapl] query="${query}" tmdb_raw=${raw.length} ranked=${ranked.length}`);

    if (ranked.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Load providers, enrich top N
    const providers = await loadProviders(sb);
    const top = ranked.slice(0, MAX_ENRICH);
    const enriched = await Promise.all(
      top.map((c) => enrichCandidate(sb, query, c, providers)),
    );
    const results = enriched.filter((r): r is ContentResultOut => r !== null);

    // 4. Cache & return (cache only when we have TR-available results)
    const trAvailable = results.filter((r) => r.available_in_tr);
    if (trAvailable.length > 0) {
      writeToCache(sb, key, results).catch((e) => console.error("cache write:", e));
    }

    return new Response(JSON.stringify({ results, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[hapl] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
