import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

// TMDB provider ID → our platform slug
const PROVIDER_SLUG_MAP: Record<number, string> = {
  8: "netflix",
  337: "disney-plus",
  119: "prime-video",
  // BluTV
  341: "blutv",
  1899: "blutv",
  // Gain
  567: "gain",
  // Mubi
  618: "mubi",
  // Apple TV+
  350: "apple-tv-plus",
  // HBO Max
  384: "hbo-max",
  // Exxen
  1796: "exxen",
  // beIN
  542: "bein-connect",
  // puhutv
  1870: "puhutv",
  // tabii (TRT)
  2077: "tabii",
  // TOD
  1898: "tod",
  // TV+
  1871: "tv-plus",
};

// Content lists to seed - Turkish popular + international popular on TR platforms
const SEED_QUERIES = {
  turkish_tv: {
    url: "/discover/tv?with_origin_country=TR&sort_by=popularity.desc&language=tr-TR&page=",
    type: "dizi" as const,
    origin: "yerli" as const,
    pages: 5,
  },
  turkish_movies: {
    url: "/discover/movie?region=TR&with_origin_country=TR&sort_by=popularity.desc&language=tr-TR&page=",
    type: "film" as const,
    origin: "yerli" as const,
    pages: 3,
  },
  international_tv: {
    url: "/discover/tv?sort_by=popularity.desc&language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&page=",
    type: "dizi" as const,
    origin: "yabanci" as const,
    pages: 5,
  },
  international_movies: {
    url: "/discover/movie?sort_by=popularity.desc&language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&page=",
    type: "film" as const,
    origin: "yabanci" as const,
    pages: 3,
  },
  documentaries: {
    url: "/discover/movie?with_genres=99&sort_by=popularity.desc&language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&page=",
    type: "belgesel" as const,
    origin: "yabanci" as const,
    pages: 2,
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
    const seenTitles = new Set<string>();

    for (const [category, config] of Object.entries(SEED_QUERIES)) {
      for (let page = 1; page <= config.pages; page++) {
        // Fetch discover page
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

          // Get TR watch providers
          let providerRes;
          try {
            providerRes = await fetch(
              `${TMDB_BASE}/${mediaType}/${id}/watch/providers?api_key=${TMDB_API_KEY}`
            );
          } catch {
            continue;
          }
          const providerData = await providerRes.json();
          const trProviders = providerData.results?.TR;

          // Collect all provider IDs (flatrate + free)
          const providerIds: number[] = [];
          for (const p of trProviders?.flatrate || []) providerIds.push(p.provider_id);
          for (const p of trProviders?.free || []) providerIds.push(p.provider_id);

          // Map to our platform slugs
          const matchedSlugs = [...new Set(
            providerIds
              .map((pid) => PROVIDER_SLUG_MAP[pid])
              .filter(Boolean)
          )];

          // Skip if no TR platform found
          if (matchedSlugs.length === 0) {
            totalSkipped++;
            continue;
          }

          // Resolve platform IDs
          const matchedPlatforms = matchedSlugs
            .map((slug) => platformBySlug.get(slug))
            .filter(Boolean) as { id: string; slug: string; name: string }[];

          if (matchedPlatforms.length === 0) {
            totalSkipped++;
            continue;
          }

          seenTitles.add(title);

          // Get details for genres
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

            // Detect origin from origin_country
            const originCountries = detail.origin_country || detail.production_countries?.map((c: any) => c.iso_3166_1) || [];
            if (originCountries.includes("TR")) {
              detectedOrigin = "yerli";
            }
          } catch {
            // Use basic info
          }

          const posterUrl = item.poster_path
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : null;

          // Determine status
          let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
          if (mediaType === "tv") {
            if (item.status === "Ended" || endYear) status = "bitti";
          }

          const primaryPlatform = matchedPlatforms[0];

          // Insert content
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

        // Small delay to avoid rate limiting
        await new Promise((r) => setTimeout(r, 250));
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
