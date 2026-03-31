import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

async function tmdbFetch(path: string, apiKey: string) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${TMDB_BASE}${path}${sep}api_key=${apiKey}`;
  const res = await fetch(url);
  return res.json();
}

async function fetchPages(path: string, apiKey: string, maxPages = 5) {
  const results: any[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const data = await tmdbFetch(`${path}${sep}page=${page}`, apiKey);
    results.push(...(data.results || []));
    if (page >= (data.total_pages || 1)) break;
  }
  return results;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("TMDB_API_TOKEN");
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "TMDB_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { action, query, tmdb_id, content_type } = await req.json();

    if (action === "search") {
      const type = content_type === "film" ? "movie" : "tv";
      const url = `${TMDB_BASE}/search/${type}?api_key=${apiKey}&query=${encodeURIComponent(query)}&language=tr-TR&page=1`;
      const res = await fetch(url);
      const data = await res.json();

      const results = (data.results || []).slice(0, 10).map((item: any) => ({
        tmdb_id: item.id,
        title: type === "tv" ? (item.name || item.original_name) : (item.title || item.original_title),
        original_title: type === "tv" ? item.original_name : item.original_title,
        overview: item.overview || null,
        poster_url: item.poster_path ? `${IMG_BASE}/w500${item.poster_path}` : null,
        release_year: type === "tv"
          ? item.first_air_date?.split("-")[0] || null
          : item.release_date?.split("-")[0] || null,
        genre_ids: item.genre_ids || [],
      }));

      return new Response(JSON.stringify({ results }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "details") {
      const type = content_type === "film" ? "movie" : "tv";
      const url = `${TMDB_BASE}/${type}/${tmdb_id}?api_key=${apiKey}&language=tr-TR`;
      const res = await fetch(url);
      const item = await res.json();

      const detail = {
        tmdb_id: item.id,
        title: type === "tv" ? (item.name || item.original_name) : (item.title || item.original_title),
        original_title: type === "tv" ? item.original_name : item.original_title,
        overview: item.overview || null,
        poster_url: item.poster_path ? `${IMG_BASE}/w500${item.poster_path}` : null,
        backdrop_url: item.backdrop_path ? `${IMG_BASE}/w1280${item.backdrop_path}` : null,
        release_year: type === "tv"
          ? item.first_air_date?.split("-")[0] || null
          : item.release_date?.split("-")[0] || null,
        genres: (item.genres || []).map((g: any) => g.name),
        status: item.status,
        origin_country: item.origin_country || [],
      };

      return new Response(JSON.stringify(detail), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "discover") {
      // Fetch genre maps
      const [tvGenreData, movieGenreData] = await Promise.all([
        tmdbFetch("/genre/tv/list?language=tr-TR", apiKey),
        tmdbFetch("/genre/movie/list?language=tr-TR", apiKey),
      ]);
      const tvGenreMap: Record<number, string> = {};
      const movieGenreMap: Record<number, string> = {};
      for (const g of tvGenreData.genres || []) tvGenreMap[g.id] = g.name;
      for (const g of movieGenreData.genres || []) movieGenreMap[g.id] = g.name;

      const seen = new Set<string>();
      const allContent: any[] = [];

      function addItem(item: any, mediaType: "tv" | "movie", forceType?: string) {
        const title = mediaType === "tv"
          ? (item.name || item.original_name || "")
          : (item.title || item.original_title || "");
        if (!title || seen.has(title)) return;
        seen.add(title);

        const genreMap = mediaType === "tv" ? tvGenreMap : movieGenreMap;
        const genreIds: number[] = item.genre_ids || [];
        const genres = genreIds.map((id: number) => genreMap[id]).filter(Boolean);
        const isDoc = genreIds.includes(99);
        const originCountries: string[] = item.origin_country || [];
        const isTurkish = originCountries.includes("TR");

        let contentType = forceType || (isDoc ? "belgesel" : (mediaType === "tv" ? "dizi" : "film"));

        const dateField = mediaType === "tv" ? item.first_air_date : item.release_date;
        const releaseYear = dateField ? parseInt(dateField.split("-")[0]) : null;

        allContent.push({
          title,
          description: item.overview || null,
          poster_url: item.poster_path ? `${IMG_BASE}/w500${item.poster_path}` : null,
          content_type: contentType,
          release_year: releaseYear,
          origin: isTurkish ? "yerli" : "yabanci",
          genre: genres,
          status: "yayinda",
        });
      }

      // 1. Popular TV in Turkey (streaming)
      const tvPopular = await fetchPages("/discover/tv?language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc", apiKey, 5);
      for (const item of tvPopular) addItem(item, "tv");

      // 2. Popular movies in Turkey (streaming)
      const moviesPopular = await fetchPages("/discover/movie?language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc", apiKey, 5);
      for (const item of moviesPopular) addItem(item, "movie");

      // 3. Turkish TV shows
      const trTv = await fetchPages("/discover/tv?language=tr-TR&with_origin_country=TR&sort_by=popularity.desc", apiKey, 5);
      for (const item of trTv) addItem(item, "tv");

      // 4. Turkish movies
      const trMovies = await fetchPages("/discover/movie?language=tr-TR&with_origin_country=TR&sort_by=popularity.desc", apiKey, 3);
      for (const item of trMovies) addItem(item, "movie");

      // 5. Documentaries (TV) available in Turkey
      const docTv = await fetchPages("/discover/tv?language=tr-TR&with_genres=99&watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc", apiKey, 3);
      for (const item of docTv) addItem(item, "tv", "belgesel");

      // 6. Documentary movies available in Turkey
      const docMovies = await fetchPages("/discover/movie?language=tr-TR&with_genres=99&watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc", apiKey, 3);
      for (const item of docMovies) addItem(item, "movie", "belgesel");

      return new Response(JSON.stringify({
        total: allContent.length,
        content: allContent,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("TMDB error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
