import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

// Platform configs: slug → search queries to find their content
const PLATFORM_QUERIES: Record<string, { queries: string[]; platformId: string }> = {
  blutv: {
    queries: [
      "BluTV dizileri tam liste 2024 2025",
      "BluTV filmleri listesi",
      "BluTV orijinal yapımlar diziler",
      "BluTV yeni eklenen diziler filmler",
    ],
    platformId: "",
  },
  exxen: {
    queries: [
      "Exxen dizileri tam liste 2024 2025",
      "Exxen filmleri listesi",
      "Exxen orijinal yapımlar diziler",
      "Exxen yeni içerikler",
    ],
    platformId: "",
  },
  gain: {
    queries: [
      "GAIN dizileri tam liste 2024 2025",
      "GAIN filmleri listesi",
      "GAIN orijinal yapımlar",
      "GAIN yeni eklenen içerikler",
    ],
    platformId: "",
  },
  puhutv: {
    queries: [
      "puhutv dizileri tam liste 2024 2025",
      "puhutv filmleri listesi",
      "puhutv orijinal yapımlar",
      "puhutv yeni içerikler",
    ],
    platformId: "",
  },
  tabii: {
    queries: [
      "tabii dizileri tam liste 2024 2025",
      "tabii filmleri listesi TRT",
      "tabii orijinal yapımlar",
      "tabii yeni eklenen dizi film",
    ],
    platformId: "",
  },
};

// Extract Turkish titles from scraped text
function extractTitles(text: string): string[] {
  const titles = new Set<string>();
  
  // Match quoted titles
  const quotedPattern = /["'«»""]([A-ZÇĞİÖŞÜa-zçğıöşü][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s:!?\-–—'.&,]+?)["'«»""]/g;
  let match;
  while ((match = quotedPattern.exec(text)) !== null) {
    const t = match[1].trim();
    if (t.length >= 2 && t.length <= 80) titles.add(t);
  }
  
  // Match bullet/list items that look like titles
  const bulletPattern = /(?:^|\n)\s*[-•*]\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s:!?\-–—'.&,]{2,60})(?:\s*[-–—(]|\s*$)/gm;
  while ((match = bulletPattern.exec(text)) !== null) {
    const t = match[1].trim();
    if (t.length >= 2 && t.length <= 60 && !t.match(/^(Netflix|Amazon|Disney|Exxen|BluTV|GAIN|puhutv|tabii|MUBI|HBO|TOD|bein|Platform|İçerik|Dizi|Film|Belgesel|Türk|Yeni|En İyi|Liste)/i)) {
      titles.add(t);
    }
  }
  
  // Match numbered list items
  const numberedPattern = /(?:^|\n)\s*\d+[\.\)]\s+([A-ZÇĞİÖŞÜ][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s:!?\-–—'.&,]{2,60})(?:\s*[-–—(]|\s*$)/gm;
  while ((match = numberedPattern.exec(text)) !== null) {
    const t = match[1].trim();
    if (t.length >= 2 && t.length <= 60) titles.add(t);
  }
  
  // Match bold markdown titles
  const boldPattern = /\*\*([A-ZÇĞİÖŞÜa-zçğıöşü][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s:!?\-–—'.&,]{2,60})\*\*/g;
  while ((match = boldPattern.exec(text)) !== null) {
    const t = match[1].trim();
    if (t.length >= 2 && t.length <= 60) titles.add(t);
  }
  
  // Match heading patterns (## Title)
  const headingPattern = /#{1,3}\s+([A-ZÇĞİÖŞÜa-zçğıöşü][A-ZÇĞİÖŞÜa-zçğıöşü0-9\s:!?\-–—'.&,]{2,60})(?:\s*$)/gm;
  while ((match = headingPattern.exec(text)) !== null) {
    const t = match[1].trim();
    if (t.length >= 2 && t.length <= 60) titles.add(t);
  }

  return Array.from(titles);
}

// Search TMDB for a title and get metadata
async function searchTMDB(title: string, apiKey: string): Promise<any | null> {
  try {
    // Try movie first
    const movieRes = await fetch(
      `${TMDB_BASE}/search/movie?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=tr-TR&region=TR`
    );
    const movieData = await movieRes.json();
    if (movieData.results?.length) {
      const best = movieData.results[0];
      if (best.vote_count > 0 || best.popularity > 1) {
        return { ...best, mediaType: "movie" };
      }
    }

    // Try TV
    const tvRes = await fetch(
      `${TMDB_BASE}/search/tv?api_key=${apiKey}&query=${encodeURIComponent(title)}&language=tr-TR`
    );
    const tvData = await tvRes.json();
    if (tvData.results?.length) {
      const best = tvData.results[0];
      if (best.vote_count > 0 || best.popularity > 1) {
        return { ...best, mediaType: "tv" };
      }
    }
  } catch { /* continue */ }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const TMDB_API_KEY = Deno.env.get("TMDB_API_TOKEN");
  const FIRECRAWL_API_KEY = Deno.env.get("FIRECRAWL_API_KEY");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!TMDB_API_KEY || !FIRECRAWL_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let params: any = {};
  try { params = await req.json(); } catch { /* defaults */ }

  const targetPlatform = params.platform || "all"; // "blutv", "exxen", etc. or "all"
  const maxQueriesPerPlatform = params.maxQueries || 4;

  try {
    // Get platforms from DB
    const { data: platforms } = await sb.from("platforms").select("id, slug, name");
    const platformBySlug = new Map(platforms?.map((p) => [p.slug, p]) || []);

    // Get existing titles to avoid duplicates
    const { data: existing } = await sb.from("contents").select("title");
    const existingTitles = new Set(existing?.map((e) => e.title.toLowerCase()) || []);

    const targetSlugs = targetPlatform === "all"
      ? Object.keys(PLATFORM_QUERIES)
      : [targetPlatform];

    let totalInserted = 0;
    let totalSkipped = 0;
    const platformStats: Record<string, number> = {};

    for (const slug of targetSlugs) {
      const config = PLATFORM_QUERIES[slug];
      if (!config) continue;
      
      const dbPlatform = platformBySlug.get(slug);
      if (!dbPlatform) {
        console.log(`[scrape] Platform ${slug} not found in DB, skipping`);
        continue;
      }

      console.log(`[scrape] Processing platform: ${dbPlatform.name}`);
      let platformInserted = 0;
      const allTitles = new Set<string>();

      // Run search queries via Firecrawl
      const queries = config.queries.slice(0, maxQueriesPerPlatform);
      for (const query of queries) {
        console.log(`[scrape] Searching: ${query}`);
        try {
          const fcRes = await fetch("https://api.firecrawl.dev/v1/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${FIRECRAWL_API_KEY}`,
            },
            body: JSON.stringify({
              query,
              limit: 5,
              lang: "tr",
              country: "tr",
              scrapeOptions: { formats: ["markdown"] },
            }),
          });
          
          if (!fcRes.ok) {
            console.error(`[scrape] Firecrawl error: ${fcRes.status}`);
            continue;
          }

          const fcData = await fcRes.json();
          const results = fcData.data || [];
          
          for (const result of results) {
            const text = result.markdown || result.description || "";
            const extracted = extractTitles(text);
            console.log(`[scrape] Extracted ${extracted.length} titles from ${result.url || "unknown"}`);
            for (const t of extracted) allTitles.add(t);
          }
        } catch (err) {
          console.error(`[scrape] Search error:`, err);
        }

        // Rate limit
        await new Promise(r => setTimeout(r, 500));
      }

      console.log(`[scrape] ${dbPlatform.name}: ${allTitles.size} unique titles found`);

      // Look up each title on TMDB and insert
      for (const title of allTitles) {
        if (existingTitles.has(title.toLowerCase())) {
          totalSkipped++;
          continue;
        }

        const tmdbResult = await searchTMDB(title, TMDB_API_KEY);
        if (!tmdbResult) {
          totalSkipped++;
          continue;
        }

        const tmdbTitle = tmdbResult.title || tmdbResult.name;
        if (existingTitles.has(tmdbTitle.toLowerCase())) {
          totalSkipped++;
          continue;
        }

        // Get details
        try {
          const detailRes = await fetch(
            `${TMDB_BASE}/${tmdbResult.mediaType}/${tmdbResult.id}?api_key=${TMDB_API_KEY}&language=tr-TR`
          );
          const detail = await detailRes.json();

          const genres = (detail.genres || []).map((g: any) => g.name);
          const overview = detail.overview || tmdbResult.overview || null;
          const releaseDate = detail.release_date || detail.first_air_date;
          const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : null;
          let endYear: number | null = null;
          if (tmdbResult.mediaType === "tv" && detail.status === "Ended" && detail.last_air_date) {
            endYear = new Date(detail.last_air_date).getFullYear();
          }

          const originCountries = detail.origin_country || detail.production_countries?.map((c: any) => c.iso_3166_1) || [];
          const origin: "yerli" | "yabanci" = originCountries.includes("TR") ? "yerli" : "yabanci";
          
          const genreIds = (detail.genres || []).map((g: any) => g.id);
          let contentType: "dizi" | "film" | "belgesel" = tmdbResult.mediaType === "tv" ? "dizi" : "film";
          if (genreIds.includes(99)) contentType = "belgesel";

          const posterUrl = tmdbResult.poster_path
            ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}`
            : null;

          let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
          if (tmdbResult.mediaType === "tv" && endYear) status = "bitti";

          existingTitles.add(tmdbTitle.toLowerCase());

          const { data: inserted, error: insertError } = await sb
            .from("contents")
            .insert({
              title: tmdbTitle,
              description: overview,
              poster_url: posterUrl,
              content_type: contentType,
              status,
              origin,
              genre: genres,
              release_year: releaseYear,
              end_year: endYear,
              platform_id: dbPlatform.id,
            })
            .select("id")
            .single();

          if (insertError) {
            console.error(`[scrape] Insert error "${tmdbTitle}":`, insertError.message);
            totalSkipped++;
            continue;
          }

          platformInserted++;
          totalInserted++;
        } catch (err) {
          console.error(`[scrape] Detail error:`, err);
          totalSkipped++;
        }

        // Rate limit TMDB
        await new Promise(r => setTimeout(r, 100));
      }

      platformStats[dbPlatform.name] = platformInserted;
      console.log(`[scrape] ${dbPlatform.name}: ${platformInserted} inserted`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: totalInserted,
        skipped: totalSkipped,
        platformStats,
        message: `${totalInserted} içerik eklendi, ${totalSkipped} atlandı.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[scrape] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
