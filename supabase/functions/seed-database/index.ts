import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

// ─── TMDB provider ID → platform slug ───────────────────────────────────────
const TMDB_PROVIDER_SLUG: Record<number, string> = {
  8: "netflix",
  337: "disney-plus",
  119: "prime-video",
  341: "blutv",
  1899: "blutv",
  567: "gain",
  618: "mubi",
  350: "tv-plus",
  384: "hbo-max",
  1796: "exxen",
  542: "bein-connect",
  1870: "puhutv",
  2077: "tabii",
  1898: "tod",
  1871: "tv-plus",
  188: "youtube-premium",
};

// ─── JustWatch provider ID → platform slug ──────────────────────────────────
const JW_PROVIDER_SLUG: Record<number, string> = {
  8: "netflix",
  9: "prime-video",
  337: "disney-plus",
  384: "blutv",
  356: "exxen",
  119: "tv-plus",
  11: "mubi",
  123: "puhutv",
  456: "gain",
  789: "bein-connect",
  321: "hbo-max",
  654: "tod",
  987: "dsmart-go",
  111: "tabii",
};

// ─── Platform keyword → slug (Firecrawl fallback) ───────────────────────────
const PLATFORM_KEYWORDS: Record<string, string> = {
  netflix: "netflix",
  blutv: "blutv",
  "blu tv": "blutv",
  disney: "disney-plus",
  "amazon prime": "prime-video",
  "prime video": "prime-video",
  "apple tv": "tv-plus",
  "tv+": "tv-plus",
  mubi: "mubi",
  gain: "gain",
  puhutv: "puhutv",
  puhu: "puhutv",
  exxen: "exxen",
  tabii: "tabii",
  "bein connect": "bein-connect",
  bein: "bein-connect",
  "hbo max": "hbo-max",
  hbo: "hbo-max",
  "tod tv": "tod",
  tod: "tod",
  "d-smart": "dsmart-go",
  dsmart: "dsmart-go",
};

function extractPlatformSlugs(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [keyword, slug] of Object.entries(PLATFORM_KEYWORDS)) {
    if (lower.includes(keyword)) found.add(slug);
  }
  return Array.from(found);
}

// ─── AI Validation ──────────────────────────────────────────────────────────
const SOURCE_WEIGHTS: Record<string, number> = {
  tmdb: 0.5,
  justwatch: 0.8,
  firecrawl: 0.3,
};

function validateSlugs(sources: Record<string, string[]>): string[] {
  const scores: Record<string, number> = {};
  for (const [source, slugs] of Object.entries(sources)) {
    const weight = SOURCE_WEIGHTS[source] || 0.2;
    for (const s of slugs) {
      if (!scores[s]) scores[s] = 0;
      scores[s] += weight;
    }
  }
  return Object.entries(scores)
    .filter(([_, score]) => score >= 0.3)
    .sort((a, b) => b[1] - a[1])
    .map(([slug]) => slug);
}

// ─── Seed categories ────────────────────────────────────────────────────────
const SEED_QUERIES = {
  turkish_tv: {
    url: "/discover/tv?with_origin_country=TR&sort_by=popularity.desc&language=tr-TR&page=",
    type: "dizi" as const,
    origin: "yerli" as const,
    pages: 2,
  },
  turkish_movies: {
    url: "/discover/movie?region=TR&with_origin_country=TR&sort_by=popularity.desc&language=tr-TR&page=",
    type: "film" as const,
    origin: "yerli" as const,
    pages: 2,
  },
  international_tv: {
    url: "/discover/tv?sort_by=popularity.desc&language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&page=",
    type: "dizi" as const,
    origin: "yabanci" as const,
    pages: 2,
  },
  international_movies: {
    url: "/discover/movie?sort_by=popularity.desc&language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&page=",
    type: "film" as const,
    origin: "yabanci" as const,
    pages: 2,
  },
  documentaries: {
    url: "/discover/movie?with_genres=99&sort_by=popularity.desc&language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&page=",
    type: "belgesel" as const,
    origin: "yabanci" as const,
    pages: 1,
  },
  turkish_docs: {
    url: "/discover/movie?with_genres=99&with_origin_country=TR&sort_by=popularity.desc&language=tr-TR&page=",
    type: "belgesel" as const,
    origin: "yerli" as const,
    pages: 1,
  },
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const TMDB_API_KEY = Deno.env.get("TMDB_API_TOKEN");
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!TMDB_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // 1. Load existing platforms
    const { data: platforms } = await sb.from("platforms").select("id, slug, name");
    const platformBySlug = new Map(platforms?.map((p) => [p.slug, p]) || []);

    // 2. Clear existing data
    await sb.from("content_platforms").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    await sb.from("contents").delete().neq("id", "00000000-0000-0000-0000-000000000000");

    let totalInserted = 0;
    let totalSkipped = 0;
    let fallbackUsed = 0;
    const MAX_FALLBACK = 10; // JustWatch/Firecrawl çağrı limiti (timeout önlemi)
    const seenTitles = new Set<string>();

    for (const [category, config] of Object.entries(SEED_QUERIES)) {
      console.log(`[seed] Kategori: ${category}`);

      for (let page = 1; page <= config.pages; page++) {
        const discoverRes = await fetch(
          `${TMDB_BASE}${config.url}${page}&api_key=${TMDB_API_KEY}`
        );
        const discoverData = await discoverRes.json();
        const items = discoverData.results || [];

        for (const item of items) {
          const title = item.title || item.name;
          if (!title || seenTitles.has(title)) {
            totalSkipped++;
            continue;
          }

          const mediaType = config.type === "film" || config.type === "belgesel" ? "movie" : "tv";
          const id = item.id;

          // ─── Source: TMDB providers ───────────────────────────────────
          let providerData: any = {};
          try {
            const providerRes = await fetch(
              `${TMDB_BASE}/${mediaType}/${id}/watch/providers?api_key=${TMDB_API_KEY}`
            );
            providerData = await providerRes.json();
          } catch { /* continue */ }

          const trProviders = providerData.results?.TR || {};
          const tmdbSlugs: string[] = [];
          for (const p of [...(trProviders.flatrate || []), ...(trProviders.free || [])]) {
            const slug = TMDB_PROVIDER_SLUG[p.provider_id];
            if (slug) tmdbSlugs.push(slug);
          }

          // ─── Source: JustWatch (sadece TMDB boşsa) ──────────────────
          const jwSlugs: string[] = [];
          if (tmdbSlugs.length === 0 && fallbackUsed < MAX_FALLBACK) {
            fallbackUsed++;
            try {
              const jwRes = await fetch("https://apis.justwatch.com/content/titles/tr_TR/popular", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  query: title,
                  page_size: 1,
                  page: 1,
                  content_types: mediaType === "movie" ? ["movie"] : ["show"],
                }),
              });
              const jwData = await jwRes.json();
              if (jwData.items && jwData.items.length > 0) {
                const offers = jwData.items[0].offers || [];
                const seen = new Set<string>();
                for (const o of offers) {
                  if (o.monetization_type === "flatrate") {
                    const slug = JW_PROVIDER_SLUG[o.provider_id];
                    if (slug && !seen.has(slug)) {
                      seen.add(slug);
                      jwSlugs.push(slug);
                    }
                  }
                }
              }
            } catch (err) {
              console.error(`JustWatch hatası (${title}):`, err);
            }
          }

          // ─── Source: Firecrawl (TMDB + JW ikisi de boşsa) ─────────────
          const fcSlugs: string[] = [];
          if (tmdbSlugs.length === 0 && jwSlugs.length === 0 && FIRECRAWL_API_KEY) {
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
                fcSlugs.push(...extractPlatformSlugs(text));
              }
            } catch (err) {
              console.error(`Firecrawl hatası (${title}):`, err);
            }
          }

          // ─── AI Validation ────────────────────────────────────────────
          const validatedSlugs = validateSlugs({
            tmdb: [...new Set(tmdbSlugs)],
            justwatch: jwSlugs,
            firecrawl: [...new Set(fcSlugs)],
          });

          // Resolve to DB platform IDs
          const matchedPlatforms = validatedSlugs
            .map((slug) => platformBySlug.get(slug))
            .filter(Boolean) as { id: string; slug: string; name: string }[];

          if (matchedPlatforms.length === 0) {
            totalSkipped++;
            continue;
          }

          seenTitles.add(title);

          // ─── Get details ──────────────────────────────────────────────
          let genres: string[] = [];
          let overview = item.overview || null;
          let releaseYear: number | null = null;
          let endYear: number | null = null;
          let detectedOrigin = config.origin;

          try {
            const detailRes = await fetch(
              `${TMDB_BASE}/${mediaType}/${id}?api_key=${TMDB_API_KEY}&language=tr-TR`
            );
            const detail = await detailRes.json();
            genres = (detail.genres || []).map((g: any) => g.name);
            overview = detail.overview || overview;

            const releaseDate = detail.release_date || detail.first_air_date;
            if (releaseDate) releaseYear = new Date(releaseDate).getFullYear();

            if (mediaType === "tv" && detail.status === "Ended" && detail.last_air_date) {
              endYear = new Date(detail.last_air_date).getFullYear();
            }

            const originCountries = detail.origin_country || detail.production_countries?.map((c: any) => c.iso_3166_1) || [];
            if (originCountries.includes("TR")) detectedOrigin = "yerli";
          } catch { /* use basic info */ }

          const posterUrl = item.poster_path
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : null;

          let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
          if (mediaType === "tv" && endYear) status = "bitti";

          const primaryPlatform = matchedPlatforms[0];

          // ─── Insert content ───────────────────────────────────────────
          const { data: inserted, error: insertError } = await sb
            .from("contents")
            .insert({
              title,
              description: overview,
              poster_url: posterUrl,
              content_type: config.type,
              status,
              origin: detectedOrigin,
              genre: genres,
              release_year: releaseYear,
              end_year: endYear,
              platform_id: primaryPlatform.id,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error(`Insert error for "${title}":`, insertError.message);
            totalSkipped++;
            continue;
          }

          // Add additional platforms to junction table
          if (matchedPlatforms.length > 1) {
            const junctionRows = matchedPlatforms.slice(1).map((p) => ({
              content_id: inserted.id,
              platform_id: p.id,
            }));
            await sb.from("content_platforms").insert(junctionRows);
          }

          totalInserted++;
        }

        // Rate limit delay
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: totalInserted,
        skipped: totalSkipped,
        message: `${totalInserted} içerik eklendi, ${totalSkipped} atlandı.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Seed error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
