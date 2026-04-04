import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

// ─── JustWatch provider ID → platform name ──────────────────────────────────
const JW_PROVIDER_MAP: Record<number, string> = {
  8: "Netflix",
  9: "Amazon Prime",
  337: "Disney+",
  384: "BluTV",
  356: "EXXEN",
  119: "TV+",
  11: "MUBI",
  123: "Puhu",
  456: "Gain",
  789: "Bein Connect",
  321: "HBO Max",
  654: "TOD TV",
  987: "D-Smart Go",
  111: "Tabii",
};

// ─── TMDB provider ID → platform name ───────────────────────────────────────
const TMDB_PROVIDER_MAP: Record<number, string> = {
  8: "Netflix",
  337: "Disney+",
  119: "Amazon Prime",
  341: "BluTV",
  1899: "BluTV",
  567: "Gain",
  618: "MUBI",
  350: "TV+",
  384: "HBO Max",
  1796: "EXXEN",
  542: "Bein Connect",
  1870: "Puhu",
  2077: "Tabii",
  1898: "TOD TV",
  1871: "TV+",
  188: "YouTube Premium",
};

// ─── Platform logo URLs ─────────────────────────────────────────────────────
const PLATFORM_LOGOS: Record<string, string> = {
  "Netflix": "https://image.tmdb.org/t/p/original/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg",
  "Disney+": "https://image.tmdb.org/t/p/original/7rwgEs15tFwyR9NPQ5vpzxTj19d.jpg",
  "Amazon Prime": "https://image.tmdb.org/t/p/original/68MNrwlkpF7WnmNPXLah69CR5xh.jpg",
  "BluTV": "https://image.tmdb.org/t/p/original/rPkEoRMcFSmfMGdDTOdvXtqKQeq.jpg",
  "Gain": "https://image.tmdb.org/t/p/original/3niqKGngFAGGbRpSHer3LogovPa.jpg",
  "MUBI": "https://image.tmdb.org/t/p/original/bVR4Z1LCHY7gidXAJF5pMa4QrDS.jpg",
  "YouTube Premium": "https://image.tmdb.org/t/p/original/6c84bF7glqZXagXWbYL9gBhiMH.jpg",
  "TV+": "https://image.tmdb.org/t/p/original/6uhKBfmtzFqOcLousHwZuzcrScK.jpg",
  "HBO Max": "https://image.tmdb.org/t/p/original/Ajqyt5aNxNx9pi1zs5o1dpAKnHo.jpg",
  "EXXEN": "https://image.tmdb.org/t/p/original/6Q3YKUNA2GGksPxVybiqcJFo0KB.jpg",
  "Bein Connect": "https://image.tmdb.org/t/p/original/bYEv5OGel1V0DJFmYJ44bCgkAy1.jpg",
  "Puhu": "https://image.tmdb.org/t/p/original/lPSQb4u6KYJc7G2SurMKvr6WLIx.jpg",
  "Tabii": "https://image.tmdb.org/t/p/original/k0Pjmg0JaZfJnjT2gM9dNKo5VWb.jpg",
  "TOD TV": "https://image.tmdb.org/t/p/original/eNE4BpYcUbGKpAe5kXfPCLDjg3P.jpg",
  "D-Smart Go": "https://image.tmdb.org/t/p/original/hDma0zYCTGzqQSbYj2GvOiUmMJw.jpg",
};

// ─── Extract platforms from text (Firecrawl fallback) ───────────────────────
function extractPlatforms(text: string): string[] {
  const platforms: string[] = [];
  const t = text || "";
  if (t.includes("Netflix")) platforms.push("Netflix");
  if (t.includes("Amazon")) platforms.push("Amazon Prime");
  if (t.includes("Gain")) platforms.push("Gain");
  if (t.includes("Puhu") || t.includes("puhu")) platforms.push("Puhu");
  if (t.includes("MUBI") || t.includes("Mubi")) platforms.push("MUBI");
  if (t.includes("Apple TV") || t.includes("TV+")) platforms.push("TV+");
  if (t.includes("EXXEN") || t.includes("Exxen") || t.includes("exxen")) platforms.push("EXXEN");
  if (t.includes("Tabii") || t.includes("tabii")) platforms.push("Tabii");
  if (t.includes("Bein Connect") || t.includes("beIN") || t.includes("bein")) platforms.push("Bein Connect");
  if (t.includes("HBO Max") || t.includes("HBO")) platforms.push("HBO Max");
  if (t.includes("Disney")) platforms.push("Disney+");
  if (t.includes("TOD TV") || t.includes("TOD")) platforms.push("TOD TV");
  if (t.includes("D-Smart") || t.includes("DSmart")) platforms.push("D-Smart Go");
  if (t.includes("BluTV") || t.includes("Blu TV") || t.includes("blutv")) platforms.push("BluTV");
  return [...new Set(platforms)];
}

// ─── AI Validation ──────────────────────────────────────────────────────────
const SOURCE_WEIGHTS: Record<string, number> = {
  tmdb: 0.5,
  justwatch: 0.8,
  firecrawl: 0.3,
};

function validatePlatforms(sources: Record<string, string[]>): string[] {
  const scores: Record<string, number> = {};
  for (const [source, platforms] of Object.entries(sources)) {
    const weight = SOURCE_WEIGHTS[source] || 0.2;
    for (const p of platforms) {
      if (!scores[p]) scores[p] = 0;
      scores[p] += weight;
    }
  }
  return Object.entries(scores)
    .filter(([_, score]) => score >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .map(([platform]) => platform);
}

function getConfidenceScore(sources: Record<string, string[]>): number {
  const total =
    sources.justwatch.length * 0.8 +
    sources.tmdb.length * 0.5 +
    sources.firecrawl.length * 0.3;
  return Math.min(100, Math.round(total * 100));
}

// ─── Cache helpers ──────────────────────────────────────────────────────────
function getCacheKey(query: string): string {
  return `hapl:${query.toLowerCase().trim()}`;
}

async function getFromCache(sb: any, key: string): Promise<any | null> {
  const cutoff = new Date(Date.now() - CACHE_TTL_SECONDS * 1000).toISOString();
  const { data } = await sb
    .from("search_cache")
    .select("results")
    .eq("cache_key", key)
    .gt("created_at", cutoff)
    .maybeSingle();
  return data?.results || null;
}

async function writeToCache(sb: any, key: string, results: any): Promise<void> {
  // Upsert: aynı key varsa güncelle
  await sb.from("search_cache").upsert(
    { cache_key: key, results, created_at: new Date().toISOString() },
    { onConflict: "cache_key" }
  );
}

// ─── Main handler ───────────────────────────────────────────────────────────
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const TMDB_API_KEY = Deno.env.get("TMDB_API_TOKEN");
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!TMDB_API_KEY) {
    return new Response(JSON.stringify({ error: "TMDB_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  try {
    const { query } = await req.json();
    if (!query) throw new Error("query parametresi zorunlu");

    // ─── 1. Cache kontrol ─────────────────────────────────────────────────
    const cacheKey = getCacheKey(query);
    const cached = await getFromCache(sb, cacheKey);
    if (cached) {
      console.log(`Cache hit: ${cacheKey}`);
      return new Response(JSON.stringify({ results: cached, cached: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 2. TMDB multi search ─────────────────────────────────────────────
    const searchRes = await fetch(
      `${TMDB_BASE}/search/multi?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(query)}&language=tr-TR&region=TR`,
    );
    const searchData = await searchRes.json();
    const results = (searchData.results || []).filter(
      (r: any) => r.media_type === "movie" || r.media_type === "tv",
    );

    if (results.length === 0) {
      return new Response(JSON.stringify({ results: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ─── 3. Enrich top 5 ──────────────────────────────────────────────────
    const enriched = await Promise.all(
      results.slice(0, 5).map(async (item: any) => {
        const type = item.media_type;
        const id = item.id;

        const [detailRes, providerRes] = await Promise.all([
          fetch(`${TMDB_BASE}/${type}/${id}?api_key=${TMDB_API_KEY}&language=tr-TR`),
          fetch(`${TMDB_BASE}/${type}/${id}/watch/providers?api_key=${TMDB_API_KEY}`),
        ]);

        const detail = await detailRes.json();
        const providerData = await providerRes.json();
        const trProviders = providerData.results?.TR || {};
        const title = detail.title || detail.name || item.title || item.name || query;

        // ─── Source: TMDB ─────────────────────────────────────────────────
        const tmdbPlatformNames: string[] = [];
        for (const p of (trProviders.flatrate || [])) {
          const name = TMDB_PROVIDER_MAP[p.provider_id];
          if (name) tmdbPlatformNames.push(name);
        }
        for (const p of (trProviders.rent || [])) {
          const name = TMDB_PROVIDER_MAP[p.provider_id];
          if (name) tmdbPlatformNames.push(name);
        }
        for (const p of (trProviders.free || [])) {
          const name = TMDB_PROVIDER_MAP[p.provider_id];
          if (name) tmdbPlatformNames.push(name);
        }

        // ─── Source: JustWatch ────────────────────────────────────────────
        const jwPlatformNames: string[] = [];
        try {
          const jwRes = await fetch("https://apis.justwatch.com/content/titles/tr_TR/popular", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              query: title,
              page_size: 1,
              page: 1,
              content_types: type === "movie" ? ["movie"] : ["show"],
            }),
          });
          const jwData = await jwRes.json();
          if (jwData.items && jwData.items.length > 0) {
            const offers = jwData.items[0].offers || [];
            const seen = new Set<string>();
            for (const o of offers) {
              if (o.monetization_type === "flatrate") {
                const name = JW_PROVIDER_MAP[o.provider_id];
                if (name && !seen.has(name)) {
                  seen.add(name);
                  jwPlatformNames.push(name);
                }
              }
            }
          }
        } catch (err) {
          console.error("JustWatch hatası:", err);
        }

        // ─── Source: Firecrawl (smart fallback: < 3 platform) ─────────────
        const fcPlatformNames: string[] = [];
        const knownCount = new Set([...tmdbPlatformNames, ...jwPlatformNames]).size;
        if (knownCount < 3 && FIRECRAWL_API_KEY) {
          try {
            const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
              },
              body: JSON.stringify({
                query: `${title} Türkiye hangi platformda`,
                limit: 3,
              }),
            });
            const fcData = await fcRes.json();
            for (const result of fcData.data || []) {
              const text = result.markdown || result.description || "";
              const found = extractPlatforms(text);
              // Firecrawl'dan sadece bilinmeyen platformları ekle
              for (const p of found) {
                if (!tmdbPlatformNames.includes(p) && !jwPlatformNames.includes(p)) {
                  fcPlatformNames.push(p);
                }
              }
            }
          } catch (err) {
            console.error("Firecrawl hatası:", err);
          }
        }

        // ─── AI Validation ────────────────────────────────────────────────
        const sources = {
          tmdb: [...new Set(tmdbPlatformNames)],
          justwatch: jwPlatformNames,
          firecrawl: [...new Set(fcPlatformNames)],
        };

        const validatedNames = validatePlatforms(sources);
        const confidence = getConfidenceScore(sources);

        const platforms = validatedNames.map((name) => ({
          name,
          logo: PLATFORM_LOGOS[name] || null,
          type: "subscription" as const,
          link: trProviders.link || null,
          source: tmdbPlatformNames.includes(name)
            ? "tmdb"
            : jwPlatformNames.includes(name)
            ? "justwatch"
            : "firecrawl",
        }));

        const releaseDate = detail.release_date || detail.first_air_date || "";
        const year = releaseDate ? new Date(releaseDate).getFullYear() : null;

        return {
          id,
          type,
          title,
          year,
          overview: detail.overview || "",
          poster: detail.poster_path ? `https://image.tmdb.org/t/p/w500${detail.poster_path}` : null,
          backdrop: detail.backdrop_path ? `https://image.tmdb.org/t/p/w780${detail.backdrop_path}` : null,
          imdb_rating: detail.vote_average ? Math.round(detail.vote_average * 10) / 10 : null,
          vote_count: detail.vote_count || 0,
          genres: (detail.genres || []).map((g: any) => g.name),
          platforms,
          tmdb_url: `https://www.themoviedb.org/${type}/${id}`,
          available_in_tr: platforms.length > 0,
          confidence,
        };
      }),
    );

    // Only return results with TR platforms
    const filtered = enriched.filter((r) => r.available_in_tr);

    // ─── 4. Cache'e yaz ───────────────────────────────────────────────────
    if (filtered.length > 0) {
      await writeToCache(sb, cacheKey, filtered).catch((err) =>
        console.error("Cache write error:", err)
      );
    }

    return new Response(JSON.stringify({ results: filtered, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error(err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
