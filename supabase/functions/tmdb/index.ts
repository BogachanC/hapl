import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const token = Deno.env.get("TMDB_API_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "TMDB_API_TOKEN not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { action, query, tmdb_id, content_type } = await req.json();
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };

    if (action === "search") {
      const type = content_type === "film" ? "movie" : "tv";
      const url = `${TMDB_BASE}/search/${type}?query=${encodeURIComponent(query)}&language=tr-TR&page=1`;
      const res = await fetch(url, { headers });
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
      const url = `${TMDB_BASE}/${type}/${tmdb_id}?language=tr-TR`;
      const res = await fetch(url, { headers });
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
