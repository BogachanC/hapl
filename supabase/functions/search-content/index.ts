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
import { getAliases, getAliasGroupMembers } from "../_shared/aliases.ts";
import {
  getAliasExpansions,
  needsHydration,
  hydrateAliases,
} from "../_shared/alias-cache.ts";
import {
  loadProviders,
  matchTmdbProvider,
  extractProvidersFromText,
  type ProviderRow,
} from "../_shared/providers.ts";
import { searchTitlesInDb, type DbContentResultOut } from "../_shared/db-search.ts";
import {
  getMeiliConfig,
  isMeiliConfigured,
  searchMeili,
  type MeiliDoc,
} from "../_shared/meili.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CACHE_TTL_SECONDS = 24 * 60 * 60;
const MAX_ENRICH = 8;
// Firecrawl is invoked when title match is strong enough.
// Used both as fallback (TMDB=0 providers) and as gap-filler
// (complete missing firecrawl_enabled providers TMDB didn't return).
const FIRECRAWL_MIN_SCORE = 0.7;
// How long an availability row stays "fresh" before considered stale
const AVAILABILITY_FRESH_HOURS = 24 * 7;

interface PlatformOut {
  id?: number;
  name: string;
  logo: string | null;
  type: "subscription" | "rent" | "free";
  link: string | null;
  source?: "tmdb" | "firecrawl";
  slug?: string;
}

// HBO Max and TV+ are distinct apps. Even though TV+ in Turkey bundles the
// HBO Max catalog inside, users may still open the HBO Max app directly, so
// both badges should appear when both are available. We do NOT suppress
// HBO Max from the display.

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
    raw_payload?: Record<string, unknown>;
  }>,
) {
  if (!titleId) return;
  const now = new Date().toISOString();
  try {
    // Defense in depth: drop firecrawl rows missing evidence before write.
    const safeRows = rows.filter((r) => {
      if (r.source !== "firecrawl") return true;
      if (!r.source_url) return false;
      if (!r.raw_payload || Object.keys(r.raw_payload).length === 0) return false;
      return true;
    });
    if (safeRows.length > 0) {
      await sb.from("content_availability").upsert(
        safeRows.map((r) => ({
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
          raw_payload: r.raw_payload ?? {},
        })),
        { onConflict: "title_id,provider_id,region,availability_type" },
      );
    }

    // Stale handling: existing rows for this title NOT in the current set →
    // mark unavailable (but only if their previous check was old enough).
    const seenKeys = new Set(safeRows.map((r) => `${r.provider_id}:${r.availability_type}`));
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
    raw_payload?: Record<string, unknown>;
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
        slug: match.slug,
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
    const fc = await firecrawlSearchText(detail.title, cand.release_year);
    if (fc.text || fc.results.length > 0) {
      usedFirecrawl = true;
      const fcResults = extractProvidersFromText(
        fc.text,
        firecrawlEligible,
        detail.title,
        fc.results,
      );
      let added = 0;
      let rejected = 0;
      for (const ext of fcResults) {
        const { provider: p, confidence, source_url, raw_payload } = ext;
        if (seen.has(p.slug)) continue;
        // Defense in depth: never persist firecrawl rows without evidence.
        if (!source_url || !raw_payload || Object.keys(raw_payload).length === 0) {
          rejected++;
          continue;
        }
        seen.add(p.slug);
        added++;
        platforms.push({
          name: p.display_name,
          logo: null,
          type: "subscription",
          link: source_url,
          source: "firecrawl",
          slug: p.slug,
        });
        availabilityRows.push({
          provider_id: p.id,
          source: "firecrawl",
          availability_type: "stream",
          confidence,
          source_url,
          raw_payload,
        });
      }
      console.log(
        `[hapl] firecrawl gap-fill: title="${detail.title}" added=${added} rejected=${rejected} ` +
        `query="${fc.query}" results=${fc.results.length}`,
      );
    }
  }

  // ── Background tasks: survive past the response via EdgeRuntime.waitUntil ─
  // Without waitUntil, Supabase edge runtime can terminate the isolate as
  // soon as the response is sent, killing in-flight DB writes.
  const ert: any = (globalThis as any).EdgeRuntime;
  const bg = (p: Promise<any>) => {
    if (ert?.waitUntil) ert.waitUntil(p.catch(() => {}));
    else p.catch(() => {});
  };

  // Persist title + availability
  bg(
    persistTitle(sb, { id: cand.id, media_type: cand.media_type }, detail).then(
      (titleId) => titleId ? persistAvailability(sb, titleId, availabilityRows) : null,
    ),
  );

  // Lazy alias hydration — top-ranked only, TTL-gated (30d)
  if (cand.score >= 0.7) {
    bg(
      needsHydration(sb, cand.id, cand.media_type).then((stale) => {
        if (!stale) return 0;
        return hydrateAliases(sb, cand.id, cand.media_type, detail).then((n) => {
          if (n > 0) console.log(`[alias-cache] hydrated id=${cand.id} type=${cand.media_type} rows=${n}`);
          return n;
        });
      }),
    );
  }

  // ── Confidence: blend TMDB strength + relevance score ───────────────────
  // Calibration:
  //  • TMDB hit on a popular title (vote_count ≥ 100): strong base 0.85
  //  • TMDB hit on a low-vote title: weaker base 0.65 (don't oversell minor variants)
  //  • Firecrawl-only:               base 0.40 (clearly tentative)
  //  • Relevance multiplier dropped from 0.15 → 0.10 to reduce inflation on weak matches
  const tmdbHit = platforms.some((p) => p.source === "tmdb");
  const popularEnoughForConf = (cand.vote_count ?? 0) >= 100;
  const base = tmdbHit
    ? (popularEnoughForConf ? 0.85 : 0.65)
    : (usedFirecrawl ? 0.40 : 0);
  const confidence = Math.round(Math.min(1, base + cand.score * 0.10) * 100);

  // Derive origin from TMDB metadata (yerli / yabancı / bilinmiyor).
  const countries = new Set<string>();
  for (const c of (detail.production_countries || [])) {
    const code = (typeof c === "string" ? c : c?.iso_3166_1) || "";
    if (code) countries.add(String(code).toUpperCase());
  }
  for (const c of (detail.origin_country || [])) countries.add(String(c).toUpperCase());
  const origLang = (detail.original_language || "").toLowerCase();
  const origin: "yerli" | "yabanci" | "bilinmiyor" =
    countries.has("TR") || origLang === "tr"
      ? "yerli"
      : (countries.size > 0 || origLang)
        ? "yabanci"
        : "bilinmiyor";

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
    origin,
  };
}

// ─── merge helpers (multilingual fallback) ───────────────────────────────
function mergeRawById(a: any[], b: any[]): any[] {
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of [...a, ...b]) {
    const k = `${r.media_type}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function mergeRanked(
  primary: ReturnType<typeof rankTmdbResults>,
  alias: ReturnType<typeof rankTmdbResults>,
): ReturnType<typeof rankTmdbResults> {
  const seen = new Set<string>();
  const out: typeof primary = [];
  // Alias-driven hits go first (they're the better-language match)
  for (const r of [...alias, ...primary]) {
    const k = `${r.media_type}:${r.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out.sort((x, y) => y.score - x.score);
}

// ─── Meili helpers (Stage 2, feature-flagged) ────────────────────────────
//
// MEILI_ENABLED=false (default) → these are never called and the existing
// DB-first + TMDB fallback pipeline runs unchanged.
//
// MEILI_ENABLED=true → search-content first asks Meili. Strong results are
// returned directly (source="meili"). On any error, weak result, or missing
// provider info, we fall through to the legacy pipeline silently.

type ProviderLite = { id: string; slug: string; display_name: string };

async function loadProviderSlugMap(sb: any): Promise<Map<string, ProviderLite>> {
  const { data } = await sb
    .from("streaming_providers")
    .select("id, slug, display_name")
    .eq("is_active", true);
  const map = new Map<string, ProviderLite>();
  for (const p of data || []) map.set(p.slug, p as ProviderLite);
  return map;
}

function meiliHitToContentResult(
  hit: MeiliDoc,
  providerSlugMap: Map<string, ProviderLite>,
): ContentResultOut {
  const platforms: PlatformOut[] = [];
  const seen = new Set<string>();
  const slugs = Array.isArray(hit.providers) ? hit.providers : [];
  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const p = providerSlugMap.get(slug);
    const displayName = p?.display_name || (hit.provider_names?.[i] ?? slug);
    platforms.push({
      name: displayName,
      logo: null,
      // Meili doesn't store availability_type per provider; default to
      // subscription (matches DB-first behaviour for stream availability,
      // which is the common case for indexed titles).
      type: "subscription",
      link: null,
      source: "tmdb",
      slug,
    });
  }
  return {
    id: hit.tmdb_id,
    type: hit.type,
    title: hit.title,
    year: hit.year ?? null,
    overview: "",
    poster: hit.poster ?? null,
    backdrop: hit.backdrop ?? null,
    imdb_rating: hit.vote_average ? Math.round(hit.vote_average * 10) / 10 : null,
    vote_count: hit.vote_count ?? 0,
    genres: Array.isArray(hit.genres) ? hit.genres : [],
    platforms,
    tmdb_url: `https://www.themoviedb.org/${hit.type}/${hit.tmdb_id}`,
    available_in_tr: platforms.length > 0,
    confidence: typeof hit.confidence === "number" ? hit.confidence : 80,
    origin: hit.origin || "bilinmiyor",
  };
}

interface MeiliBranchResult {
  results: ContentResultOut[];
  strong: boolean;
  reason: string;
}

async function tryMeiliBranch(
  sb: any,
  query: string,
  providerSlug: string | null,
  categoryFilter: string | null,
): Promise<MeiliBranchResult | null> {
  const cfg = getMeiliConfig();
  if (!cfg.enabled || !isMeiliConfigured(cfg)) return null;
  const q = query.trim();
  if (q.length < 2) return { results: [], strong: false, reason: "query_too_short" };

  const filters: string[] = ["available_in_tr = true"];
  if (providerSlug) filters.push(`providers = "${providerSlug.replace(/"/g, '\\"')}"`);
  if (categoryFilter && categoryFilter !== "all") {
    if (categoryFilter === "series" || categoryFilter === "tv") {
      filters.push(`(content_kind = "series" OR content_kind = "reality")`);
    } else if (categoryFilter === "movie") {
      filters.push(`content_kind = "movie"`);
    } else if (categoryFilter === "documentary") {
      filters.push(`content_kind = "documentary"`);
    }
  }

  let hits: MeiliDoc[] = [];
  try {
    const t0 = Date.now();
    const res = await searchMeili(
      { q, limit: 20, filter: filters.join(" AND ") },
      cfg,
    );
    hits = res.hits || [];
    console.log(
      `[hapl] meili: query="${q}" hits=${hits.length} ms=${res.processingTimeMs} total=${Date.now() - t0}`,
    );
  } catch (e: any) {
    console.error("[hapl] meili error → fallback:", e?.message || e);
    return null;
  }

  if (hits.length === 0) return { results: [], strong: false, reason: "empty" };

  // ── Exact-match re-rank (generic) ──────────────────────────────────────
  // If the user typed something that EXACTLY equals a hit's title,
  // original_title, or one of its exact_aliases (after normalization),
  // that hit must outrank merely-related results — even if Meili's
  // text-relevance put a localized translation (e.g. "Sıkı Dostlar" for
  // "friends") above the canonical match (the original "Friends" series).
  // We assign a tier (0 = exact, 1 = otherwise) and stable-sort.
  const nq = normalizeTitle(q);
  const exactTier = (h: MeiliDoc): number => {
    const t = normalizeTitle(h.title || "");
    const ot = normalizeTitle(h.original_title || "");
    if (t === nq || ot === nq) return 0;
    const exAliases = Array.isArray(h.exact_aliases) ? h.exact_aliases : [];
    for (const a of exAliases) {
      if (normalizeTitle(a) === nq) return 0;
    }
    return 1;
  };
  const indexed = hits.map((h, i) => ({ h, i, tier: exactTier(h) }));
  const exactCount = indexed.filter((x) => x.tier === 0).length;
  if (exactCount > 0) {
    const sample = indexed.filter((x) => x.tier === 0).slice(0, 3).map((x) => `${x.h.title}|orig=${x.h.original_title}`).join(" ; ");
    console.log(`[hapl] meili re-rank: nq="${nq}" exactCount=${exactCount} sample=${sample}`);
  } else {
    console.log(`[hapl] meili re-rank: nq="${nq}" no-exact-match. top3 titles=${indexed.slice(0,3).map(x=>`${x.h.title}|orig=${x.h.original_title}`).join(" ; ")}`);
  }
  indexed.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    // Within the exact-match tier, prefer the more popular canonical entry
    // (e.g. Friends 1994 series over the obscure 1990 movie that happens to
    // share the original_title "Friends"). Outside tier 0, keep Meili order.
    if (a.tier === 0) {
      const va = a.h.vote_count ?? 0;
      const vb = b.h.vote_count ?? 0;
      if (va !== vb) return vb - va;
    }
    return a.i - b.i;
  });
  hits = indexed.map((x) => x.h);



  const providerSlugMap = await loadProviderSlugMap(sb);
  const results = hits.map((h) => meiliHitToContentResult(h, providerSlugMap));

  const top = hits[0];
  const topHasProviders = (top.providers?.length ?? 0) > 0;
  const topRankOk = (top.search_rank ?? 999) <= 200; // not a hard spin-off/special
  const enoughResults = hits.length >= 3;
  const strong = topHasProviders && topRankOk && enoughResults;
  const reason = !topHasProviders
    ? "top_no_providers"

    : !topRankOk
      ? "top_spinoff"
      : !enoughResults
        ? "too_few_results"
        : "ok";

  return { results, strong, reason };
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
    const body = await req.json().catch(() => ({}));
    const { query, provider, category, mode: rawMode } = body || {};
    if (!query || typeof query !== "string" || !query.trim()) {
      return new Response(JSON.stringify({ error: "query parametresi zorunlu" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const providerSlug: string | null =
      typeof provider === "string" && provider.trim() ? provider.trim() : null;
    const categoryFilter: string | null =
      typeof category === "string" && category.trim() ? category.trim() : null;
    const mode: "typeahead" | "full" = rawMode === "typeahead" ? "typeahead" : "full";

    const baseKey = cacheKey(query);
    const key = `${baseKey}:${categoryFilter ?? "all"}:${providerSlug ?? "all"}:${mode}`;

    // Background scheduler — survives past response.
    const ert: any = (globalThis as any).EdgeRuntime;
    const bg = (p: any) => {
      // Postgrest builders are thenable but lack .catch — wrap in Promise.resolve
      const prom = Promise.resolve(p).catch(() => {});
      if (ert?.waitUntil) ert.waitUntil(prom);
    };

    const trimmedQuery = query.trim();
    const normTrim = normalizeTitle(trimmedQuery);

    const writeTelemetry = (
      results: ContentResultOut[],
      source: "db" | "tmdb_fallback" | "mixed" | "cache" | "meili",
    ) => {
      bg(
        sb.from("search_events").insert({
          raw_query: trimmedQuery.slice(0, 200),
          normalized_query: normTrim.slice(0, 200),
          result_count: results.length,
          top_result_tmdb_id: results[0]?.id ?? null,
          top_result_title: results[0]?.title ?? null,
          selected_category: categoryFilter,
          selected_provider: providerSlug,
          source,
          mode,
        }),
      );
    };

    // 1. Cache
    const cached = await getFromCache(sb, key);
    if (cached) {
      console.log(`[hapl] cache hit: ${key} mode=${mode}`);
      writeTelemetry(cached, "cache");
      return new Response(JSON.stringify({ results: cached, cached: true, source: "cache", mode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1b. Meili branch (feature-flagged via MEILI_ENABLED).
    // Returns null when disabled / not configured / errored → silent fallback
    // to the legacy DB-first + TMDB pipeline below.
    const meiliBranch = await tryMeiliBranch(sb, trimmedQuery, providerSlug, categoryFilter);
    if (meiliBranch && meiliBranch.strong) {
      const out = meiliBranch.results;
      console.log(
        `[hapl] meili-first hit: query="${trimmedQuery}" count=${out.length} mode=${mode} → skipping DB/TMDB`,
      );
      writeToCache(sb, key, out).catch((e) => console.error("cache write:", e));
      writeTelemetry(out, "meili");
      return new Response(JSON.stringify({ results: out, cached: false, source: "meili", mode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (meiliBranch) {
      console.log(
        `[hapl] meili weak (${meiliBranch.reason}) count=${meiliBranch.results.length} → fallback to DB/TMDB`,
      );
    }


    // 2. DB-FIRST search
    const dbHit = await searchTitlesInDb(sb, trimmedQuery, {
      providerSlug,
      category: categoryFilter,
      requireAvailable: true,
      limit: 20,
      mode,
    }).catch((e) => {
      console.error("[hapl] db-search error:", e);
      return { results: [] as DbContentResultOut[], topScore: 0 };
    });

    // Typeahead mode: never call TMDB/Firecrawl. Latency-sensitive UX,
    // and the user is still typing — DB-only result is the right tradeoff.
    if (mode === "typeahead") {
      const out: ContentResultOut[] = dbHit.results.map(({ _score, ...r }) => r);
      console.log(
        `[hapl] typeahead DB-only: query="${trimmedQuery}" topScore=${dbHit.topScore.toFixed(2)} count=${out.length}`,
      );
      if (out.length > 0) {
        writeToCache(sb, key, out).catch((e) => console.error("cache write:", e));
      }
      writeTelemetry(out, "db");
      return new Response(JSON.stringify({ results: out, cached: false, source: "db", mode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const STRONG_DB = dbHit.topScore >= 0.85 && dbHit.results.length >= 3;
    if (STRONG_DB) {
      // Strip internal _score before returning, keep ContentResultOut shape.
      const out: ContentResultOut[] = dbHit.results.map(({ _score, ...r }) => r);
      console.log(
        `[hapl] DB-first hit: query="${trimmedQuery}" topScore=${dbHit.topScore.toFixed(2)} ` +
        `count=${out.length} → skipping TMDB`,
      );
      // Cache (only if any TR-available result, which by construction is true here)
      writeToCache(sb, key, out).catch((e) => console.error("cache write:", e));
      writeTelemetry(out, "db");
      return new Response(JSON.stringify({ results: out, cached: false, source: "db", mode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. TMDB fallback pipeline (existing alias-aware multi-search)
    const manualAliases = getAliases(trimmedQuery);
    const dbAliases = await getAliasExpansions(sb, trimmedQuery).catch(() => [] as string[]);
    const aliasSeen = new Set<string>([normTrim]);
    const aliasVariants: string[] = [];
    for (const v of [...manualAliases, ...dbAliases]) {
      const k = normalizeTitle(v);
      if (!k || aliasSeen.has(k)) continue;
      aliasSeen.add(k);
      aliasVariants.push(v);
    }

    let fallbackUsed: string[] = [];
    const primaryTask = tmdbMultiSearch(trimmedQuery, "tr-TR");
    const variantTasks = aliasVariants.map((v) => tmdbMultiSearch(v, "tr-TR"));
    const [raw, ...variantRaws] = await Promise.all([primaryTask, ...variantTasks]);

    let mergedRaw = raw;
    for (let i = 0; i < variantRaws.length; i++) {
      const vr = variantRaws[i];
      if (vr.length === 0) continue;
      mergedRaw = mergeRawById(mergedRaw, vr);
      fallbackUsed.push(`variant:${aliasVariants[i]}`);
    }

    let ranked = rankTmdbResults(query, mergedRaw);
    if (aliasVariants.length > 0) {
      for (const v of aliasVariants) {
        const rankedV = rankTmdbResults(v, mergedRaw);
        ranked = mergeRanked(ranked, rankedV);
      }
    }
    console.log(
      `[hapl] query="${query}" tmdb_raw=${raw.length} ` +
      `manual_aliases=${manualAliases.length} db_aliases=${dbAliases.length} ` +
      `merged_raw=${mergedRaw.length} ranked=${ranked.length} db_pre=${dbHit.results.length}`,
    );

    const needsFallback = ranked.length === 0 || (ranked[0]?.score ?? 0) < 0.7;
    if (needsFallback) {
      const rawEn = await tmdbMultiSearch(trimmedQuery, "en-US");
      if (rawEn.length > 0) {
        const merged = mergeRawById(mergedRaw, rawEn);
        const rankedEn = rankTmdbResults(query, merged);
        if (rankedEn.length > 0 && (rankedEn[0].score >= 0.7 || ranked.length === 0)) {
          ranked = rankedEn;
          fallbackUsed.push("en-US");
        }
      }
    }
    if (fallbackUsed.length > 0) {
      console.log(`[hapl] fallback used: ${fallbackUsed.join(", ")} → ranked=${ranked.length}`);
    }

    if (ranked.length === 0 && dbHit.results.length === 0) {
      writeTelemetry([], "tmdb_fallback");
      return new Response(JSON.stringify({ results: [], source: "tmdb_fallback", mode }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Enrich TMDB top N
    const providers = await loadProviders(sb);
    const top = ranked.slice(0, MAX_ENRICH);
    const enriched = await Promise.all(
      top.map((c) => enrichCandidate(sb, query, c, providers)),
    );
    const tmdbResults = enriched.filter((r): r is ContentResultOut => r !== null);

    // Merge TMDB + DB-first results (DB rows kept as supplementary signal).
    // De-dupe by tmdb id+type; TMDB enriched row wins when both present.
    // Track DB _score per id so the final ranker can use real relevance
    // (not a default 0.5) for DB-only rows.
    const merged: ContentResultOut[] = [];
    const seenIds = new Set<string>();
    const dbScoreById = new Map<string, number>();
    for (const dr of dbHit.results) {
      dbScoreById.set(`${dr.type}:${dr.id}`, dr._score ?? 0);
    }
    for (const r of tmdbResults) {
      const k = `${r.type}:${r.id}`;
      if (seenIds.has(k)) continue;
      seenIds.add(k);
      merged.push(r);
    }
    for (const dr of dbHit.results) {
      const k = `${dr.type}:${dr.id}`;
      if (seenIds.has(k)) continue;
      seenIds.add(k);
      const { _score, ...rest } = dr;
      merged.push(rest);
    }

    // Existing final ranking (alias-group / watchable / exact nudge)
    const qNormFinal = normalizeTitle(query);
    const aliasGroup = getAliasGroupMembers(query);
    const rankedById = new Map<string, { score: number; original: string }>();
    for (const r of ranked) {
      rankedById.set(`${r.media_type}:${r.id}`, {
        score: r.score,
        original: r.original_title || "",
      });
    }

    const scored = merged.map((r) => {
      const meta = rankedById.get(`${r.type}:${r.id}`);
      const dbScore = dbScoreById.get(`${r.type}:${r.id}`);
      // Real relevance: TMDB rank score, else DB _score, else 0 (NOT 0.5).
      const baseRel = meta?.score ?? dbScore ?? 0;
      const titleNorm = normalizeTitle(r.title);
      const origNorm = normalizeTitle(meta?.original || "");
      const isExact = titleNorm === qNormFinal || origNorm === qNormFinal;
      const hasProvider = r.platforms.length > 0;
      // Boost gate: weak relevance must NOT be lifted into the main list by
      // provider/popularity boosts. Only apply boosts when baseRel is healthy
      // OR the candidate is an exact title match.
      const boostsAllowed = baseRel >= 0.5 || isExact;
      const watchBoost = (hasProvider && boostsAllowed) ? 0.30 : 0;
      const noProviderPenalty = (!hasProvider && !isExact) ? 0.45 : 0;
      const exactNudge = isExact ? 0.10 : 0;
      const confSignal = boostsAllowed ? (r.confidence ?? 0) / 1000 : 0;
      let aliasGroupBoost = 0;
      if (aliasGroup) {
        const candIsGroupMember =
          (titleNorm && aliasGroup.has(titleNorm)) ||
          (origNorm && aliasGroup.has(origNorm));
        if (candIsGroupMember) aliasGroupBoost = r.type === "tv" ? 0.55 : 0.20;
      }
      const finalScore =
        baseRel + watchBoost + exactNudge + confSignal + aliasGroupBoost - noProviderPenalty;
      return { r, finalScore, baseRel };
    });

    // Drop irrelevant noise: anything with baseRel < 0.3 AND not in alias group
    // shouldn't appear in the main results list at all.
    const filtered = scored.filter((s) => {
      if (s.baseRel >= 0.3) return true;
      const tn = normalizeTitle(s.r.title);
      if (aliasGroup && tn && aliasGroup.has(tn)) return true;
      return false;
    });
    filtered.sort((a, b) => b.finalScore - a.finalScore);
    const sortedResults = filtered.map((s) => s.r);

    const trAvailable = sortedResults.filter((r) => r.available_in_tr);
    if (trAvailable.length > 0) {
      writeToCache(sb, key, sortedResults).catch((e) => console.error("cache write:", e));
    }

    const source: "tmdb_fallback" | "mixed" =
      dbHit.results.length > 0 && tmdbResults.length > 0 ? "mixed" : "tmdb_fallback";
    writeTelemetry(sortedResults, source);

    return new Response(
      JSON.stringify({ results: sortedResults, cached: false, source, mode }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("[hapl] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
