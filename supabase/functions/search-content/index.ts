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

    // 1. TMDB multi search
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

    // 2. Enrich top 5
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

        const flatrate = (trProviders.flatrate || []).map((p: any) => ({
          id: p.provider_id,
          name: PLATFORM_MAP[p.provider_id]?.name || p.provider_name,
          logo: PLATFORM_MAP[p.provider_id]?.logo || `https://image.tmdb.org/t/p/original${p.logo_path}`,
          type: "subscription",
          link: trProviders.link || null,
        }));

        const rent = (trProviders.rent || []).map((p: any) => ({
          id: p.provider_id,
          name: PLATFORM_MAP[p.provider_id]?.name || p.provider_name,
          logo: PLATFORM_MAP[p.provider_id]?.logo || `https://image.tmdb.org/t/p/original${p.logo_path}`,
          type: "rent",
          link: trProviders.link || null,
        }));

        const allPlatforms = [...flatrate, ...rent];

        // 3. Firecrawl fallback
        let firecrawlPlatforms: any[] = [];
        if (allPlatforms.length === 0 && FIRECRAWL_API_KEY) {
          const title = detail.title || detail.name || query;
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
                scrapeOptions: { formats: ["markdown"] },
              }),
            });
            const fcData = await fcRes.json();

            const platformKeywords: Record<string, string> = {
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
            };

            const foundNames = new Set<string>();
            for (const result of fcData.data || []) {
              const text = (result.markdown || result.description || "").toLowerCase();
              for (const [keyword, platformName] of Object.entries(platformKeywords)) {
                if (text.includes(keyword) && !foundNames.has(platformName)) {
                  foundNames.add(platformName);
                  firecrawlPlatforms.push({
                    name: platformName,
                    logo: null,
                    type: "subscription",
                    link: result.url || null,
                    source: "firecrawl",
                  });
                }
              }
            }
          } catch (err) {
            console.error("Firecrawl hatası:", err);
          }
        }

        const title = detail.title || detail.name;
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
          platforms: allPlatforms.length > 0 ? allPlatforms : firecrawlPlatforms,
          tmdb_url: `https://www.themoviedb.org/${type}/${id}`,
          available_in_tr: allPlatforms.length > 0 || firecrawlPlatforms.length > 0,
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
