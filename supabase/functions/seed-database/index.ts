import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

// ─── JustWatch provider ID → platform slug ──────────────────────────────────
const JW_PROVIDER_SLUG: Record<number, string> = {
  8: "netflix", 9: "prime-video", 119: "prime-video",
  337: "disney-plus",
  384: "hbo-max", 341: "hbo-max",
  356: "exxen", 1796: "exxen",
  350: "tv-plus", 1871: "tv-plus",
  11: "mubi", 618: "mubi",
  123: "puhutv", 1870: "puhutv",
  567: "gain", 456: "gain",
  789: "bein-connect", 542: "bein-connect",
  321: "hbo-max", 384: "hbo-max",
  654: "tod", 1898: "tod",
  987: "dsmart-go",
  111: "tabii", 2077: "tabii",
};

// ─── TMDB provider ID → platform slug (fallback) ───────────────────────────
const TMDB_PROVIDER_SLUG: Record<number, string> = {
  8: "netflix", 337: "disney-plus", 119: "prime-video", 9: "prime-video",
  341: "blutv", 1899: "blutv",
  1796: "exxen", 356: "exxen",
  567: "gain", 456: "gain",
  618: "mubi", 11: "mubi",
  350: "tv-plus", 1871: "tv-plus",
  542: "bein-connect", 789: "bein-connect",
  1870: "puhutv", 123: "puhutv",
  2077: "tabii", 111: "tabii",
  1898: "tod", 654: "tod",
  987: "dsmart-go", 384: "hbo-max",
};

// ─── Firecrawl text extraction ──────────────────────────────────────────────
const PLATFORM_KEYWORDS: Record<string, string> = {
  netflix: "netflix", blutv: "blutv", "blu tv": "blutv",
  disney: "disney-plus", "amazon prime": "prime-video", "prime video": "prime-video",
  "apple tv": "tv-plus", "tv+": "tv-plus", mubi: "mubi",
  gain: "gain", puhutv: "puhutv", puhu: "puhutv",
  exxen: "exxen", tabii: "tabii",
  "bein connect": "bein-connect", bein: "bein-connect",
  "hbo max": "hbo-max", hbo: "hbo-max",
  "tod tv": "tod", tod: "tod",
  "d-smart": "dsmart-go", dsmart: "dsmart-go",
};

function extractPlatformSlugs(text: string): string[] {
  const lower = text.toLowerCase();
  const found = new Set<string>();
  for (const [keyword, slug] of Object.entries(PLATFORM_KEYWORDS)) {
    if (lower.includes(keyword)) found.add(slug);
  }
  return Array.from(found);
}

// ─── Discover presets ───────────────────────────────────────────────────────
const DISCOVER_PRESETS: Record<string, { path: string; extra: string; mediaType: string }> = {
  tr_movie: {
    path: "/discover/movie",
    extra: "region=TR&sort_by=popularity.desc&language=tr-TR",
    mediaType: "movie",
  },
  tr_tv: {
    path: "/discover/tv",
    extra: "region=TR&sort_by=popularity.desc&language=tr-TR",
    mediaType: "tv",
  },
  tr_tv_doc: {
    path: "/discover/tv",
    extra: "region=TR&with_genres=99&sort_by=popularity.desc&language=tr-TR",
    mediaType: "tv",
  },
  tr_tv_reality: {
    path: "/discover/tv",
    extra: "region=TR&with_genres=10764&sort_by=popularity.desc&language=tr-TR",
    mediaType: "tv",
  },
  tr_origin_movie: {
    path: "/discover/movie",
    extra: "with_origin_country=TR&sort_by=popularity.desc&language=tr-TR",
    mediaType: "movie",
  },
  tr_origin_tv: {
    path: "/discover/tv",
    extra: "with_origin_country=TR&sort_by=popularity.desc&language=tr-TR",
    mediaType: "tv",
  },
  tr_stream_movie: {
    path: "/discover/movie",
    extra: "watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=tr-TR",
    mediaType: "movie",
  },
  tr_stream_tv: {
    path: "/discover/tv",
    extra: "watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&language=tr-TR",
    mediaType: "tv",
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
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let params: any = {};
  try { params = await req.json(); } catch { /* defaults */ }

  const startPage = params.startPage || 1;
  const endPage = params.endPage || 2;
  const preset = params.preset || "tr_movie";
  const clearFirst = params.clearFirst === true;
  const maxFirecrawl = params.maxFirecrawl || 3;
  // source: "justwatch" (JW primary), "tmdb" (TMDB providers primary), "both"
  const source = params.source || "justwatch";

  const config = DISCOVER_PRESETS[preset];
  if (!config) {
    return new Response(JSON.stringify({ error: `Unknown preset: ${preset}` }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { data: platforms } = await sb.from("platforms").select("id, slug, name");
    const platformBySlug = new Map(platforms?.map((p) => [p.slug, p]) || []);

    if (clearFirst) {
      await sb.from("content_platforms").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await sb.from("contents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    const { data: existing } = await sb.from("contents").select("title");
    const existingTitles = new Set(existing?.map(e => e.title) || []);

    let totalInserted = 0;
    let totalSkipped = 0;
    let fcUsed = 0;

    for (let page = startPage; page <= endPage; page++) {
      const url = `${TMDB_BASE}${config.path}?api_key=${TMDB_API_KEY}&${config.extra}&page=${page}`;
      console.log(`[seed] ${preset} page ${page}`);

      const discoverRes = await fetch(url);
      const discoverData = await discoverRes.json();
      const items = discoverData.results || [];
      if (items.length === 0) break;

      for (const item of items) {
        const title = item.title || item.name;
        if (!title || existingTitles.has(title)) { totalSkipped++; continue; }

        const id = item.id;
        let allSlugs: string[] = [];

        // ─── Source 1: JustWatch (primary when source=justwatch) ─────
        if (source === "justwatch" || source === "both") {
          try {
            const jwRes = await fetch("https://apis.justwatch.com/content/titles/tr_TR/popular", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Accept": "application/json" },
              body: JSON.stringify({
                query: title,
                page_size: 1,
                page: 1,
                content_types: config.mediaType === "movie" ? ["movie"] : ["show"],
              }),
            });
            if (jwRes.ok) {
              const text = await jwRes.text();
              try {
                const jwData = JSON.parse(text);
                if (jwData.items?.length) {
                  const offers = jwData.items[0].offers || [];
                  const seen = new Set<string>();
                  for (const o of offers) {
                    if (o.monetization_type === "flatrate") {
                      const slug = JW_PROVIDER_SLUG[o.provider_id];
                      if (slug && !seen.has(slug)) { seen.add(slug); allSlugs.push(slug); }
                    }
                  }
                }
              } catch { /* non-JSON */ }
            }
          } catch { /* JW error, continue */ }
        }

        // ─── Source 2: TMDB providers (fallback or when source=tmdb) ──
        if ((source === "tmdb" || source === "both") || allSlugs.length === 0) {
          try {
            const providerRes = await fetch(
              `${TMDB_BASE}/${config.mediaType}/${id}/watch/providers?api_key=${TMDB_API_KEY}`
            );
            const providerData = await providerRes.json();
            const trProviders = providerData.results?.TR || {};
            for (const p of [...(trProviders.flatrate || []), ...(trProviders.free || []), ...(trProviders.ads || [])]) {
              const slug = TMDB_PROVIDER_SLUG[p.provider_id];
              if (slug && !allSlugs.includes(slug)) allSlugs.push(slug);
            }
          } catch { /* continue */ }
        }

        // ─── Source 3: Firecrawl (last resort) ──────────────────────────
        if (allSlugs.length === 0 && FIRECRAWL_API_KEY && fcUsed < maxFirecrawl) {
          fcUsed++;
          try {
            const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
              },
              body: JSON.stringify({
                query: `${title} Türkiye hangi platformda izlenir`,
                limit: 3,
              }),
            });
            const fcData = await fcRes.json();
            for (const result of fcData.data || []) {
              const text = result.markdown || result.description || "";
              for (const slug of extractPlatformSlugs(text)) {
                if (!allSlugs.includes(slug)) allSlugs.push(slug);
              }
            }
          } catch { /* continue */ }
        }

        // ─── Resolve to DB platforms ────────────────────────────────────
        const uniqueSlugs = [...new Set(allSlugs)];
        const matchedPlatforms = uniqueSlugs
          .map((slug) => platformBySlug.get(slug))
          .filter(Boolean) as { id: string; slug: string; name: string }[];

        if (matchedPlatforms.length === 0) { totalSkipped++; continue; }

        // ─── Get details ────────────────────────────────────────────────
        let genres: string[] = [];
        let overview = item.overview || null;
        let releaseYear: number | null = null;
        let endYear: number | null = null;
        let detectedOrigin: "yerli" | "yabanci" = "yabanci";
        let contentType: "dizi" | "film" | "belgesel" = config.mediaType === "tv" ? "dizi" : "film";

        try {
          const detailRes = await fetch(
            `${TMDB_BASE}/${config.mediaType}/${id}?api_key=${TMDB_API_KEY}&language=tr-TR`
          );
          const detail = await detailRes.json();
          genres = (detail.genres || []).map((g: any) => g.name);
          overview = detail.overview || overview;
          const releaseDate = detail.release_date || detail.first_air_date;
          if (releaseDate) releaseYear = new Date(releaseDate).getFullYear();
          if (config.mediaType === "tv" && detail.status === "Ended" && detail.last_air_date) {
            endYear = new Date(detail.last_air_date).getFullYear();
          }
          const originCountries = detail.origin_country || detail.production_countries?.map((c: any) => c.iso_3166_1) || [];
          if (originCountries.includes("TR")) detectedOrigin = "yerli";
          const genreIds = (detail.genres || []).map((g: any) => g.id);
          if (genreIds.includes(99)) contentType = "belgesel";
        } catch { /* use basic */ }

        const posterUrl = item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : null;
        let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
        if (config.mediaType === "tv" && endYear) status = "bitti";

        existingTitles.add(title);
        const primaryPlatform = matchedPlatforms[0];

        // ─── Insert ─────────────────────────────────────────────────────
        const { data: inserted, error: insertError } = await sb
          .from("contents")
          .insert({
            title, description: overview, poster_url: posterUrl,
            content_type: contentType, status, origin: detectedOrigin,
            genre: genres, release_year: releaseYear, end_year: endYear,
            platform_id: primaryPlatform.id,
          })
          .select("id").single();

        if (insertError) {
          console.error(`Insert error "${title}":`, insertError.message);
          totalSkipped++; continue;
        }

        if (matchedPlatforms.length > 1) {
          const junctionRows = matchedPlatforms.slice(1).map((p) => ({
            content_id: inserted.id, platform_id: p.id,
          }));
          await sb.from("content_platforms").insert(junctionRows);
        }

        totalInserted++;
      }

      await new Promise((r) => setTimeout(r, 50));
    }

    return new Response(
      JSON.stringify({
        success: true, preset, source, inserted: totalInserted,
        skipped: totalSkipped, pages: `${startPage}-${endPage}`,
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
