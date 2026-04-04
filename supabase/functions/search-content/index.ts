import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

const PLATFORM_MAP: Record<number, { name: string; logo: string }> = {
  8:   { name: "Netflix",         logo: "https://image.tmdb.org/t/p/original/t2yyOv40HZeVlLjYsCsPHnWLk4W.jpg" },
  337: { name: "Disney+",         logo: "https://image.tmdb.org/t/p/original/7rwgEs15tFwyR9NPQ5vpzxTj19d.jpg" },
  119: { name: "Amazon Prime",    logo: "https://image.tmdb.org/t/p/original/68MNrwlkpF7WnmNPXLah69CR5xh.jpg" },
  341: { name: "BluTV",           logo: "https://image.tmdb.org/t/p/original/rPkEoRMcFSmfMGdDTOdvXtqKQeq.jpg" },
  567: { name: "Gain",            logo: "https://image.tmdb.org/t/p/original/3niqKGngFAGGbRpSHer3LogovPa.jpg" },
  618: { name: "Mubi",            logo: "https://image.tmdb.org/t/p/original/bVR4Z1LCHY7gidXAJF5pMa4QrDS.jpg" },
  188: { name: "YouTube Premium", logo: "https://image.tmdb.org/t/p/original/6c84bF7glqZXagXWbYL9gBhiMH.jpg" },
  350: { name: "Apple TV+",       logo: "https://image.tmdb.org/t/p/original/6uhKBfmtzFqOcLousHwZuzcrScK.jpg" },
  384: { name: "HBO Max",         logo: "https://image.tmdb.org/t/p/original/Ajqyt5aNxNx9pi1zs5o1dpAKnHo.jpg" },
};

// JustWatch provider ID → platform name
const JW_PROVIDER_MAP: Record<number, string> = {
  8: "Netflix",
  9: "Amazon Prime",
  337: "Disney+",
  384: "BluTV",
  356: "Exxen",
  119: "Apple TV+",
  188: "YouTube Premium",
  567: "Gain",
  618: "Mubi",
};

// Platform keyword extraction from text
const PLATFORM_KEYWORDS: Record<string, string> = {
  netflix: "Netflix",
  blutv: "BluTV",
  "blu tv": "BluTV",
  disney: "Disney+",
  "amazon prime": "Amazon Prime",
  "prime video": "Amazon Prime",
  "apple tv": "Apple TV+",
  mubi: "Mubi",
  gain: "Gain",
  puhutv: "Puhu TV",
  exxen: "Exxen",
  "hbo max": "HBO Max",
  "youtube premium": "YouTube Premium",
};

// Source weights for AI validation scoring
const SOURCE_WEIGHTS: Record<string, number> = {
  tmdb: 0.8,
  justwatch: 0.7,
  firecrawl: 0.4,
};

const VALIDATION_THRESHOLD = 0.4;

// ─── AI Validation: Score-based platform filtering ──────────────────────────
function validatePlatforms(
  sources: Record<string, string[]>
): string[] {
  const scores: Record<string, number> = {};

  for (const [source, platforms] of Object.entries(sources)) {
    const weight = SOURCE_WEIGHTS[source] || 0.2;
    for (const p of platforms) {
      if (!scores[p]) scores[p] = 0;
      scores[p] += weight;
    }
  }

  return Object.entries(scores)
    .filter(([_, score]) => score >= VALIDATION_THRESHOLD)
    .sort((a, b) => b[1] - a[1])
    .map(([platform]) => platform);
}

// Extract platform names from text
function extractPlatformsFromText(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [keyword, name] of Object.entries(PLATFORM_KEYWORDS)) {
    if (lower.includes(keyword)) {
      found.add(name);
    }
  }
  return Array.from(found);
}

// Get logo URL for a platform name
function getPlatformLogo(name: string): string | null {
  for (const entry of Object.values(PLATFORM_MAP)) {
    if (entry.name === name) return entry.logo;
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const TMDB_API_KEY = Deno.env.get("TMDB_API_TOKEN");
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");

  if (!TMDB_API_KEY) {
    return new Response(JSON.stringify({ error: "TMDB_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { query } = await req.json();
    if (!query) throw new Error("query parametresi zorunlu");

    // ─── 1. TMDB multi search ─────────────────────────────────────────────
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

    // ─── 2. Enrich top 5 ──────────────────────────────────────────────────
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

        // ─── Source: TMDB ─────────────────────────────────────────────────
        const tmdbPlatformNames: string[] = [];
        const tmdbPlatformDetails: any[] = [];

        for (const p of (trProviders.flatrate || [])) {
          const name = PLATFORM_MAP[p.provider_id]?.name || p.provider_name;
          tmdbPlatformNames.push(name);
          tmdbPlatformDetails.push({
            id: p.provider_id,
            name,
            logo: PLATFORM_MAP[p.provider_id]?.logo || `https://image.tmdb.org/t/p/original${p.logo_path}`,
            type: "subscription",
            link: trProviders.link || null,
            source: "tmdb",
          });
        }
        for (const p of (trProviders.rent || [])) {
          const name = PLATFORM_MAP[p.provider_id]?.name || p.provider_name;
          tmdbPlatformNames.push(name);
          tmdbPlatformDetails.push({
            id: p.provider_id,
            name,
            logo: PLATFORM_MAP[p.provider_id]?.logo || `https://image.tmdb.org/t/p/original${p.logo_path}`,
            type: "rent",
            link: trProviders.link || null,
            source: "tmdb",
          });
        }

        // ─── Source: JustWatch ────────────────────────────────────────────
        const jwPlatformNames: string[] = [];
        const title = detail.title || detail.name || query;

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
              const name = JW_PROVIDER_MAP[o.provider_id];
              if (name && !seen.has(name)) {
                seen.add(name);
                jwPlatformNames.push(name);
              }
            }
          }
        } catch (err) {
          console.error("JustWatch hatası:", err);
        }

        // ─── Source: Firecrawl (fallback) ─────────────────────────────────
        const fcPlatformNames: string[] = [];
        if (tmdbPlatformNames.length === 0 && jwPlatformNames.length === 0 && FIRECRAWL_API_KEY) {
          try {
            const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
              },
              body: JSON.stringify({
                query: `"${title}" Türkiye streaming platform Netflix BluTV Disney Plus izle 2024`,
                limit: 5,
                lang: "tr",
                country: "tr",
                location: { country: "TR", languages: ["tr"] },
                scrapeOptions: { formats: ["markdown"] },
              }),
            });
            const fcData = await fcRes.json();

            for (const result of fcData.data || []) {
              const text = (result.markdown || result.description || "");
              const found = extractPlatformsFromText(text);
              fcPlatformNames.push(...found);
            }
          } catch (err) {
            console.error("Firecrawl hatası:", err);
          }
        }

        // ─── AI Validation: Score & Filter ────────────────────────────────
        const validatedNames = validatePlatforms({
          tmdb: tmdbPlatformNames,
          justwatch: jwPlatformNames,
          firecrawl: [...new Set(fcPlatformNames)],
        });

        // Build final platform objects with details
        const platformsMap = new Map<string, any>();

        // Add TMDB details first (highest quality data)
        for (const p of tmdbPlatformDetails) {
          if (validatedNames.includes(p.name)) {
            platformsMap.set(p.name, p);
          }
        }

        // Add remaining validated platforms from other sources
        for (const name of validatedNames) {
          if (!platformsMap.has(name)) {
            platformsMap.set(name, {
              name,
              logo: getPlatformLogo(name),
              type: "subscription",
              link: trProviders.link || null,
              source: jwPlatformNames.includes(name) ? "justwatch" : "firecrawl",
            });
          }
        }

        const releaseDate = detail.release_date || detail.first_air_date || "";
        const year = releaseDate ? new Date(releaseDate).getFullYear() : null;
        const finalPlatforms = Array.from(platformsMap.values());

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
          platforms: finalPlatforms,
          tmdb_url: `https://www.themoviedb.org/${type}/${id}`,
          available_in_tr: finalPlatforms.length > 0,
        };
      }),
    );

    return new Response(JSON.stringify({ results: enriched }), {
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
