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
  8: "netflix", 337: "disney-plus", 119: "prime-video", 9: "prime-video",
  341: "blutv", 1899: "blutv", 384: "hbo-max",
  1796: "exxen", 356: "exxen", 567: "gain", 456: "gain",
  618: "mubi", 11: "mubi", 350: "tv-plus", 1871: "tv-plus",
  542: "bein-connect", 789: "bein-connect",
  1870: "puhutv", 123: "puhutv",
  2077: "tabii", 111: "tabii", 1898: "tod", 654: "tod",
  987: "dsmart-go", 188: "youtube-premium",
};

// ─── Discover query presets ─────────────────────────────────────────────────
// mode: "tr_stream" = content on TR streaming platforms (any origin)
// mode: "tr_origin" = Turkish origin content
// mode: "tr_origin_tv" = Turkish origin TV
const DISCOVER_PRESETS: Record<string, { path: string; extra: string }> = {
  tr_stream_movie: {
    path: "/discover/movie",
    extra: "watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=tr-TR",
  },
  tr_stream_tv: {
    path: "/discover/tv",
    extra: "watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=tr-TR",
  },
  tr_origin_movie: {
    path: "/discover/movie",
    extra: "with_origin_country=TR&sort_by=popularity.desc&language=tr-TR",
  },
  tr_origin_tv: {
    path: "/discover/tv",
    extra: "with_origin_country=TR&sort_by=popularity.desc&language=tr-TR",
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let params: any = {};
  try { params = await req.json(); } catch { /* defaults */ }

  const startPage = params.startPage || 1;
  const endPage = params.endPage || 5;
  const preset = params.preset || "tr_stream_movie";
  const clearFirst = params.clearFirst === true;

  const config = DISCOVER_PRESETS[preset];
  if (!config) {
    return new Response(JSON.stringify({ error: `Unknown preset: ${preset}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const mediaType = preset.includes("_tv") ? "tv" : "movie";

  try {
    const { data: platforms } = await sb.from("platforms").select("id, slug, name");
    const platformBySlug = new Map(platforms?.map((p) => [p.slug, p]) || []);

    if (clearFirst) {
      await sb.from("content_platforms").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await sb.from("contents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    // Load existing titles
    const { data: existing } = await sb.from("contents").select("title");
    const existingTitles = new Set(existing?.map(e => e.title) || []);

    let totalInserted = 0;
    let totalSkipped = 0;

    for (let page = startPage; page <= endPage; page++) {
      const url = `${TMDB_BASE}${config.path}?api_key=${TMDB_API_KEY}&${config.extra}&page=${page}`;
      console.log(`[seed] ${preset} page ${page}`);

      const discoverRes = await fetch(url);
      const discoverData = await discoverRes.json();
      const items = discoverData.results || [];

      if (items.length === 0) {
        console.log(`[seed] No results on page ${page}, stopping.`);
        break;
      }

      for (const item of items) {
        const title = item.title || item.name;
        if (!title || existingTitles.has(title)) {
          totalSkipped++;
          continue;
        }

        const id = item.id;

        // ─── Get TR providers from TMDB ─────────────────────────────
        let matchedSlugs: string[] = [];
        try {
          const providerRes = await fetch(
            `${TMDB_BASE}/${mediaType}/${id}/watch/providers?api_key=${TMDB_API_KEY}`
          );
          const providerData = await providerRes.json();
          const trProviders = providerData.results?.TR || {};
          const allProviders = [
            ...(trProviders.flatrate || []),
            ...(trProviders.free || []),
            ...(trProviders.ads || []),
          ];
          const slugSet = new Set<string>();
          for (const p of allProviders) {
            const slug = TMDB_PROVIDER_SLUG[p.provider_id];
            if (slug) slugSet.add(slug);
          }
          matchedSlugs = Array.from(slugSet);
        } catch { /* continue */ }

        // Resolve to DB platforms
        const matchedPlatforms = matchedSlugs
          .map((slug) => platformBySlug.get(slug))
          .filter(Boolean) as { id: string; slug: string; name: string }[];

        // For tr_origin presets, allow content even without platform match
        if (matchedPlatforms.length === 0 && !preset.includes("tr_origin")) {
          totalSkipped++;
          continue;
        }

        // ─── Get details ────────────────────────────────────────────
        let genres: string[] = [];
        let overview = item.overview || null;
        let releaseYear: number | null = null;
        let endYear: number | null = null;
        let detectedOrigin: "yerli" | "yabanci" = "yabanci";
        let contentType: "dizi" | "film" | "belgesel" = mediaType === "tv" ? "dizi" : "film";

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

          const genreIds = (detail.genres || []).map((g: any) => g.id);
          if (genreIds.includes(99)) contentType = "belgesel";
        } catch { /* use basic info */ }

        // For tr_origin with no platform, skip if no platform found
        if (matchedPlatforms.length === 0) {
          totalSkipped++;
          continue;
        }

        const posterUrl = item.poster_path
          ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
          : null;

        let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
        if (mediaType === "tv" && endYear) status = "bitti";

        const primaryPlatform = matchedPlatforms[0];
        existingTitles.add(title);

        // ─── Insert ─────────────────────────────────────────────────
        const { data: inserted, error: insertError } = await sb
          .from("contents")
          .insert({
            title,
            description: overview,
            poster_url: posterUrl,
            content_type: contentType,
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
          console.error(`Insert error "${title}":`, insertError.message);
          totalSkipped++;
          continue;
        }

        // Junction for extra platforms
        if (matchedPlatforms.length > 1) {
          const junctionRows = matchedPlatforms.slice(1).map((p) => ({
            content_id: inserted.id,
            platform_id: p.id,
          }));
          await sb.from("content_platforms").insert(junctionRows);
        }

        totalInserted++;
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    return new Response(
      JSON.stringify({
        success: true,
        preset,
        inserted: totalInserted,
        skipped: totalSkipped,
        pages: `${startPage}-${endPage}`,
        message: `${totalInserted} içerik eklendi, ${totalSkipped} atlandı.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("Seed error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
