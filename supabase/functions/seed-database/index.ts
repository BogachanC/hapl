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
  9: "prime-video",
  341: "blutv",
  1899: "blutv",
  384: "hbo-max",
  1796: "exxen",
  356: "exxen",
  567: "gain",
  618: "mubi",
  11: "mubi",
  350: "tv-plus",
  1871: "tv-plus",
  542: "bein-connect",
  1870: "puhutv",
  123: "puhutv",
  2077: "tabii",
  111: "tabii",
  1898: "tod",
  188: "youtube-premium",
  987: "dsmart-go",
};

// ─── JustWatch provider ID → platform slug ──────────────────────────────────
const JW_PROVIDER_SLUG: Record<number, string> = {
  8: "netflix",
  9: "prime-video",
  119: "prime-video",
  337: "disney-plus",
  384: "blutv",
  341: "blutv",
  356: "exxen",
  1796: "exxen",
  350: "tv-plus",
  1871: "tv-plus",
  11: "mubi",
  618: "mubi",
  123: "puhutv",
  1870: "puhutv",
  567: "gain",
  456: "gain",
  789: "bein-connect",
  542: "bein-connect",
  321: "hbo-max",
  654: "tod",
  1898: "tod",
  987: "dsmart-go",
  111: "tabii",
  2077: "tabii",
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

// ─── Weighted validation ────────────────────────────────────────────────────
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

  // Parse params: startPage, endPage, mediaType, clearFirst
  let params: any = {};
  try { params = await req.json(); } catch { /* defaults */ }

  const startPage = params.startPage || 1;
  const endPage = params.endPage || 3;
  const mediaType = params.mediaType || "both"; // "movie", "tv", "both"
  const clearFirst = params.clearFirst === true;
  const maxFirecrawl = params.maxFirecrawl || 5;

  try {
    // Load existing platforms
    const { data: platforms } = await sb.from("platforms").select("id, slug, name");
    const platformBySlug = new Map(platforms?.map((p) => [p.slug, p]) || []);

    // Optionally clear
    if (clearFirst) {
      await sb.from("content_platforms").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await sb.from("contents").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    }

    // Load existing titles to skip duplicates
    const { data: existing } = await sb.from("contents").select("title");
    const existingTitles = new Set(existing?.map(e => e.title) || []);

    let totalInserted = 0;
    let totalSkipped = 0;
    let fcUsed = 0;

    const types = mediaType === "both" ? ["movie", "tv"] : [mediaType];

    for (const type of types) {
      for (let page = startPage; page <= endPage; page++) {
        console.log(`[seed] ${type} page ${page}`);

        const discoverRes = await fetch(
          `${TMDB_BASE}/${type}/popular?api_key=${TMDB_API_KEY}&language=tr-TR&page=${page}`
        );
        const discoverData = await discoverRes.json();
        const items = discoverData.results || [];

        for (const item of items) {
          const title = item.title || item.name;
          if (!title || existingTitles.has(title)) {
            totalSkipped++;
            continue;
          }

          const id = item.id;

          // ─── Source 1: TMDB providers ─────────────────────────────────
          let tmdbSlugs: string[] = [];
          try {
            const providerRes = await fetch(
              `${TMDB_BASE}/${type}/${id}/watch/providers?api_key=${TMDB_API_KEY}`
            );
            const providerData = await providerRes.json();
            const trProviders = providerData.results?.TR || {};
            for (const p of [...(trProviders.flatrate || []), ...(trProviders.free || [])]) {
              const slug = TMDB_PROVIDER_SLUG[p.provider_id];
              if (slug) tmdbSlugs.push(slug);
            }
            tmdbSlugs = [...new Set(tmdbSlugs)];
          } catch { /* continue */ }

          // ─── Source 2: JustWatch (if TMDB empty) ──────────────────────
          let jwSlugs: string[] = [];
          if (tmdbSlugs.length === 0) {
            try {
              const jwRes = await fetch("https://apis.justwatch.com/content/titles/tr_TR/popular", {
                method: "POST",
                headers: { "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                  query: title,
                  page_size: 1,
                  page: 1,
                  content_types: type === "movie" ? ["movie"] : ["show"],
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
                        if (slug && !seen.has(slug)) {
                          seen.add(slug);
                          jwSlugs.push(slug);
                        }
                      }
                    }
                  }
                } catch { /* non-JSON */ }
              }
            } catch { /* continue */ }
          }

          // ─── Source 3: Firecrawl (if both empty, limited) ─────────────
          let fcSlugs: string[] = [];
          if (tmdbSlugs.length === 0 && jwSlugs.length === 0 && FIRECRAWL_API_KEY && fcUsed < maxFirecrawl) {
            fcUsed++;
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
              fcSlugs = [...new Set(fcSlugs)];
            } catch { /* continue */ }
          }

          // ─── Validate ─────────────────────────────────────────────────
          const validatedSlugs = validateSlugs({
            tmdb: tmdbSlugs,
            justwatch: jwSlugs,
            firecrawl: fcSlugs,
          });

          const matchedPlatforms = validatedSlugs
            .map((slug) => platformBySlug.get(slug))
            .filter(Boolean) as { id: string; slug: string; name: string }[];

          if (matchedPlatforms.length === 0) {
            totalSkipped++;
            continue;
          }

          // ─── Get details ──────────────────────────────────────────────
          let genres: string[] = [];
          let overview = item.overview || null;
          let releaseYear: number | null = null;
          let endYear: number | null = null;
          let detectedOrigin: "yerli" | "yabanci" = "yabanci";
          let contentType: "dizi" | "film" | "belgesel" = type === "tv" ? "dizi" : "film";

          try {
            const detailRes = await fetch(
              `${TMDB_BASE}/${type}/${id}?api_key=${TMDB_API_KEY}&language=tr-TR`
            );
            const detail = await detailRes.json();
            genres = (detail.genres || []).map((g: any) => g.name);
            overview = detail.overview || overview;

            const releaseDate = detail.release_date || detail.first_air_date;
            if (releaseDate) releaseYear = new Date(releaseDate).getFullYear();

            if (type === "tv" && detail.status === "Ended" && detail.last_air_date) {
              endYear = new Date(detail.last_air_date).getFullYear();
            }

            const originCountries = detail.origin_country || detail.production_countries?.map((c: any) => c.iso_3166_1) || [];
            if (originCountries.includes("TR")) detectedOrigin = "yerli";

            // Check if documentary
            const genreIds = (detail.genres || []).map((g: any) => g.id);
            if (genreIds.includes(99)) contentType = "belgesel";
          } catch { /* use basic info */ }

          const posterUrl = item.poster_path
            ? `https://image.tmdb.org/t/p/w500${item.poster_path}`
            : null;

          let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
          if (type === "tv" && endYear) status = "bitti";

          const primaryPlatform = matchedPlatforms[0];
          existingTitles.add(title);

          // ─── Insert ───────────────────────────────────────────────────
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

          // Junction table for additional platforms
          if (matchedPlatforms.length > 1) {
            const junctionRows = matchedPlatforms.slice(1).map((p) => ({
              content_id: inserted.id,
              platform_id: p.id,
            }));
            await sb.from("content_platforms").insert(junctionRows);
          }

          totalInserted++;
        }

        // Rate limit
        await new Promise((r) => setTimeout(r, 80));
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: totalInserted,
        skipped: totalSkipped,
        pages: `${startPage}-${endPage}`,
        types,
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
