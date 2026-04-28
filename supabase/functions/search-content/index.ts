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
const FIRECRAWL_MIN_SCORE = 0.7;

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
      content_kind: candidate.media_type,
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
  if (!titleId || rows.length === 0) return;
  try {
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
        last_seen_at: new Date().toISOString(),
        checked_at: new Date().toISOString(),
        raw_payload: {},
      })),
      { onConflict: "title_id,provider_id,region,availability_type" },
    );
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

  // ── Firecrawl fallback (only if TMDB empty AND strong name match) ───────
  let usedFirecrawl = false;
  if (platforms.length === 0 && cand.score >= FIRECRAWL_MIN_SCORE) {
    const text = await firecrawlSearchText(detail.title, cand.release_year);
    if (text) {
      usedFirecrawl = true;
      const fcProviders = extractProvidersFromText(text, providers);
      for (const p of fcProviders) {
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
          confidence: 0.4,
          source_url: null,
        });
      }
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
