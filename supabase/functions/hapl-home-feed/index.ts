// hapl-home-feed: read-only DB feed for the home page (no TMDB, no Firecrawl).
//
// Returns content_titles that have at least one watchable TR provider, ranked
// by a quality score with a small randomization seed so the feed feels fresh.
//
// Public endpoint (no auth) — same as search-content. RLS makes content_*
// tables publicly readable; we use the service role here only to keep joins
// simple and stable, never returning anything sensitive.
//
// Filters:
//   - category: 'all' | 'movie' | 'tv' | 'documentary' | 'reality'
//     (maps to content_titles.content_kind values: movie | series | documentary | reality)
//   - provider: streaming_providers.slug (optional)
//   - limit (default 24, max 60)
//   - offset (default 0)
//   - sort: 'quality' (default) | 'recent' | 'popular'
//   - seed: optional integer to make randomization reproducible per-session

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { pickDisplayTitle, type AliasMeta } from "../_shared/display-title.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_IMG = "https://image.tmdb.org/t/p";

// ─── Quality scoring ─────────────────────────────────────────────────────
// Combines vote_count, vote_average, popularity (from metadata jsonb) with
// safe defaults so titles seeded without metadata still score sanely.
function qualityScore(meta: any): number {
  const vc = Number(meta?.vote_count ?? 0);
  const va = Number(meta?.vote_average ?? 0);
  const pop = Number(meta?.popularity ?? 0);
  // log-dampened vote count so blockbusters don't bury solid mid-tier titles
  const voteWeight = Math.log10(1 + vc);            // 0..~5
  const ratingWeight = Math.max(0, va - 5) / 5;     // 0..1 (only counts ratings >5)
  const popWeight = Math.log10(1 + pop) / 4;        // 0..~1
  return voteWeight * 0.55 + ratingWeight * 0.30 + popWeight * 0.15;
}

// Deterministic-ish jitter: small noise (±0.15) so the feed reorders subtly
// per request without scrambling top picks.
function jitter(seed: number): number {
  // Mulberry32 lite
  let t = seed + 0x6D2B79F5;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5) * 0.30;
}

interface FeedItem {
  id: string;
  tmdb_id: number;
  type: "movie" | "tv";
  content_kind: string;
  title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  imdb_rating: number | null;
  vote_count: number;
  genres: string[];
  platforms: Array<{ id: string; slug: string; name: string; logo_url: string | null; color: string; availability_type: string; confidence: number }>;
  available_in_tr: boolean;
  confidence: number;
  origin?: "yerli" | "yabanci" | "bilinmiyor";
  _score: number;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const category: string = (body.category || "all").toLowerCase();
  const providerSlug: string | null = body.provider || null;
  const limit = Math.max(1, Math.min(60, body.limit ?? 24));
  const offset = Math.max(0, body.offset ?? 0);
  const sort: string = body.sort || "quality";
  const seed: number = Number.isFinite(body.seed) ? body.seed : Math.floor(Date.now() / (60 * 60 * 1000));

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1) Resolve provider filter to id (optional)
    let providerIdFilter: string | null = null;
    if (providerSlug) {
      const { data: p } = await sb
        .from("streaming_providers")
        .select("id")
        .eq("slug", providerSlug)
        .eq("is_active", true)
        .maybeSingle();
      if (!p?.id) {
        return new Response(JSON.stringify({ ok: true, results: [], total: 0, note: "unknown provider" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      providerIdFilter = p.id;
    }

    // 2) Map category → content_kind values
    let kindFilter: string[] | null = null;
    switch (category) {
      case "movie":       kindFilter = ["movie"]; break;
      case "tv":
      case "series":      kindFilter = ["series"]; break;
      case "documentary": kindFilter = ["documentary"]; break;
      case "reality":     kindFilter = ["reality"]; break;
      case "all":
      default:            kindFilter = null;
    }

    // 3) Two-phase availability fetch:
    //   Phase A — apply provider filter (if any) to find ELIGIBLE title_ids.
    //             This decides which titles appear in the feed.
    //   Phase B — fetch FULL availability for those title_ids (no provider
    //             filter). This decides which platform badges show on each
    //             card. A title surfaced via TV+ should still display Max,
    //             Netflix, etc. if also available there.
    const WATCHABLE_TYPES = ["stream", "free", "ads"];

    // Phase A: filter
    let filterQuery = sb
      .from("content_availability")
      .select("title_id")
      .eq("region", "TR")
      .eq("status", "available")
      .in("availability_type", WATCHABLE_TYPES)
      .gte("confidence", 0.5);
    if (providerIdFilter) filterQuery = filterQuery.eq("provider_id", providerIdFilter);

    // Cap candidate pool — small filtered set so home stays snappy.
    const POOL_SIZE = Math.min(800, Math.max(120, (offset + limit) * 4));
    const { data: filterRows, error: filterErr } = await filterQuery.limit(POOL_SIZE * 3);
    if (filterErr) throw filterErr;
    if (!filterRows || filterRows.length === 0) {
      return new Response(JSON.stringify({ ok: true, results: [], total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const eligibleTitleIds = Array.from(new Set(filterRows.map((r: any) => r.title_id))).slice(0, POOL_SIZE);

    // Phase B: full availability for those titles (NO provider filter).
    // Batch in chunks to keep URL length under server/proxy limits (~8KB).
    const availRows: Array<{ title_id: string; provider_id: string; availability_type: string; confidence: number }> = [];
    const CHUNK = 80;
    for (let i = 0; i < eligibleTitleIds.length; i += CHUNK) {
      const slice = eligibleTitleIds.slice(i, i + CHUNK);
      const { data: rows, error: availErr } = await sb
        .from("content_availability")
        .select("title_id, provider_id, availability_type, confidence")
        .eq("region", "TR")
        .eq("status", "available")
        .in("availability_type", WATCHABLE_TYPES)
        .gte("confidence", 0.5)
        .in("title_id", slice);
      if (availErr) throw availErr;
      if (rows) availRows.push(...rows as any);
    }

    // Group by title_id
    const byTitle = new Map<string, Array<{ provider_id: string; availability_type: string; confidence: number }>>();
    for (const r of availRows || []) {
      const arr = byTitle.get(r.title_id) || [];
      arr.push({ provider_id: r.provider_id, availability_type: r.availability_type, confidence: Number(r.confidence) });
      byTitle.set(r.title_id, arr);
    }
    const titleIds = eligibleTitleIds;

    // 4) Pull title rows
    let titleQuery = sb
      .from("content_titles")
      .select("id, tmdb_id, tmdb_type, title, original_title, release_year, overview, poster_path, backdrop_path, genres, content_kind, metadata, created_at, updated_at")
      .in("id", titleIds);
    if (kindFilter) titleQuery = titleQuery.in("content_kind", kindFilter);

    const { data: titleRows, error: titleErr } = await titleQuery;
    if (titleErr) throw titleErr;
    if (!titleRows || titleRows.length === 0) {
      return new Response(JSON.stringify({ ok: true, results: [], total: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5) Pull provider metadata for the providers actually referenced
    const providerIdsUsed = new Set<string>();
    for (const arr of byTitle.values()) for (const a of arr) providerIdsUsed.add(a.provider_id);
    const { data: provRows } = await sb
      .from("streaming_providers")
      .select("id, slug, display_name")
      .in("id", Array.from(providerIdsUsed));
    const provById = new Map<string, { id: string; slug: string; display_name: string }>();
    for (const p of provRows || []) provById.set(p.id, p);

    // 5b) Pull aliases for displayed titles (for display-title policy v2).
    const movieIdsF = titleRows.filter((t: any) => t.tmdb_type === "movie").map((t: any) => Number(t.tmdb_id));
    const tvIdsF = titleRows.filter((t: any) => t.tmdb_type === "tv").map((t: any) => Number(t.tmdb_id));
    const aliasMetaByKey = new Map<string, AliasMeta[]>();
    const aliasTasks: Promise<any>[] = [];
    if (movieIdsF.length > 0) {
      aliasTasks.push(sb.from("content_title_aliases")
        .select("tmdb_id, tmdb_type, alias, source, language, country")
        .eq("tmdb_type", "movie").in("tmdb_id", movieIdsF));
    }
    if (tvIdsF.length > 0) {
      aliasTasks.push(sb.from("content_title_aliases")
        .select("tmdb_id, tmdb_type, alias, source, language, country")
        .eq("tmdb_type", "tv").in("tmdb_id", tvIdsF));
    }
    const aliasRes = await Promise.all(aliasTasks);
    for (const r of aliasRes) {
      for (const row of r.data || []) {
        const k = `${row.tmdb_type}:${row.tmdb_id}`;
        const arr = aliasMetaByKey.get(k) || [];
        arr.push({ alias: row.alias, source: row.source ?? null, language: row.language ?? null, country: row.country ?? null });
        aliasMetaByKey.set(k, arr);
      }
    }

    // Also pull display platforms metadata (logo/color) from `platforms` if slug matches.
    // The two tables (`streaming_providers` vs legacy `platforms`) drifted on a few
    // slugs — bridge them so we don't silently drop titles whose only provider is
    // amazon-prime-video / max / tod-tv.
    const SLUG_ALIASES: Record<string, string[]> = {
      "amazon-prime-video": ["prime-video", "amazon-prime-video"],
      "max":                ["hbo-max", "max"],
      "tod-tv":             ["tod", "tod-tv"],
    };
    const { data: dispRows } = await sb
      .from("platforms")
      .select("id, slug, name, logo_url, color");
    const dispBySlug = new Map<string, { id: string; slug: string; name: string; logo_url: string | null; color: string }>();
    for (const d of dispRows || []) dispBySlug.set(d.slug, d);
    function resolveDisplay(providerSlug: string) {
      const direct = dispBySlug.get(providerSlug);
      if (direct) return direct;
      for (const alt of SLUG_ALIASES[providerSlug] || []) {
        const hit = dispBySlug.get(alt);
        if (hit) return hit;
      }
      return undefined;
    }

    // 6) Build feed items + score
    const items: FeedItem[] = [];
    for (const t of titleRows) {
      // Require poster (cards look bad otherwise)
      if (!t.poster_path) continue;
      const meta = t.metadata || {};
      const baseScore = qualityScore(meta);
      const noise = jitter(seed + t.tmdb_id);
      const score = baseScore + noise;

      const rawAvail = byTitle.get(t.id) || [];
      // Best confidence per provider (prefer stream over rent/buy through earlier filter)
      const bestPerProvider = new Map<string, { availability_type: string; confidence: number }>();
      for (const a of rawAvail) {
        const cur = bestPerProvider.get(a.provider_id);
        if (!cur || a.confidence > cur.confidence) {
          bestPerProvider.set(a.provider_id, { availability_type: a.availability_type, confidence: a.confidence });
        }
      }
      const platforms = Array.from(bestPerProvider.entries()).map(([pid, info]) => {
        const sp = provById.get(pid);
        const disp = sp ? resolveDisplay(sp.slug) : undefined;
        // Fallback: even when the legacy `platforms` row is missing, surface the
        // streaming_providers entry so the title still renders. Color/logo will
        // be best-effort defaults.
        const slug = sp?.slug || "";
        return {
          id: pid,
          slug,
          name: disp?.name || sp?.display_name || slug,
          logo_url: disp?.logo_url || null,
          color: disp?.color || "#666666",
          availability_type: info.availability_type,
          confidence: info.confidence,
        };
      }).filter((p) => p.slug);

      // Both HBO Max and TV+ are shown when present. The provider_rule trigger
      // ensures HBO Max-only titles also get a derived TV+ row, but we never
      // suppress HBO Max from the user-facing list — they are distinct apps.
      const displayPlatforms = platforms;

      if (displayPlatforms.length === 0) continue;
      const maxConf = Math.max(...displayPlatforms.map((p) => p.confidence));

      // Derive origin from cached metadata.
      const countries = new Set<string>();
      for (const c of (meta?.production_countries || [])) {
        const code = (typeof c === "string" ? c : c?.iso_3166_1) || "";
        if (code) countries.add(String(code).toUpperCase());
      }
      for (const c of (meta?.origin_country || [])) countries.add(String(c).toUpperCase());
      const origLang = String(meta?.original_language || "").toLowerCase();
      const origin: "yerli" | "yabanci" | "bilinmiyor" =
        countries.has("TR") || origLang === "tr"
          ? "yerli"
          : (countries.size > 0 || origLang)
            ? "yabanci"
            : "bilinmiyor";

      const aliasMetas = aliasMetaByKey.get(`${t.tmdb_type}:${t.tmdb_id}`) || [];
      const picked = pickDisplayTitle(t.title || "", t.original_title || null, aliasMetas, meta);
      const displayTitle = picked.display || t.title;
      items.push({
        id: t.id,
        tmdb_id: t.tmdb_id,
        type: t.tmdb_type,
        content_kind: t.content_kind,
        title: displayTitle,
        year: t.release_year,
        overview: t.overview || "",
        poster: t.poster_path ? `${TMDB_IMG}/w500${t.poster_path}` : null,
        backdrop: t.backdrop_path ? `${TMDB_IMG}/w780${t.backdrop_path}` : null,
        imdb_rating: meta?.vote_average ? Math.round(Number(meta.vote_average) * 10) / 10 : null,
        vote_count: Number(meta?.vote_count ?? 0),
        genres: t.genres || [],
        platforms: displayPlatforms,
        available_in_tr: true,
        confidence: maxConf,
        origin,
        _score: score,
      });
    }

    // 7) Sort
    if (sort === "recent") {
      items.sort((a, b) => (b.tmdb_id - a.tmdb_id)); // proxy when no created_at exposed
    } else if (sort === "popular") {
      items.sort((a, b) => (b.vote_count - a.vote_count));
    } else {
      items.sort((a, b) => (b._score - a._score));
    }

    // 8) Paginate
    const total = items.length;
    const page = items.slice(offset, offset + limit).map(({ _score, ...rest }) => rest);

    return new Response(JSON.stringify({
      ok: true,
      total,
      limit,
      offset,
      sort,
      category,
      provider: providerSlug,
      results: page,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[hapl-home-feed] error:", (err as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
