import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Auth gate: requires a valid Supabase JWT AND an `admin` role in
 * public.user_roles. Returns null on success, or a Response on failure.
 */
async function requireAdmin(req: Request): Promise<Response | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  const supabase = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsErr } = await supabase.auth.getClaims(token);
  if (claimsErr || !claimsData?.claims?.sub) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const userId = claimsData.claims.sub as string;
  const { data: isAdmin, error: roleErr } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });

  if (roleErr || !isAdmin) {
    return jsonResponse({ error: "Forbidden: admin role required" }, 403);
  }

  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Admin-only endpoint
  const authFail = await requireAdmin(req);
  if (authFail) return authFail;

  const apiKey = Deno.env.get("TMDB_API_TOKEN");
  if (!apiKey) {
    return jsonResponse({ error: "TMDB_API_TOKEN not configured" }, 500);
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === "search") {
      const { query, content_type } = body;
      const type = content_type === "film" ? "movie" : "tv";
      const data = await tmdbFetch(`/search/${type}?query=${encodeURIComponent(query)}&language=tr-TR&page=1`, apiKey);

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
      const { tmdb_id, content_type } = body;
      const type = content_type === "film" ? "movie" : "tv";
      const item = await tmdbFetch(`/${type}/${tmdb_id}?language=tr-TR`, apiKey);

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

    // Paginated discover - returns one page at a time
    if (action === "discover_page") {
      const { media_type, page = 1, with_genres, with_watch_providers } = body;
      // media_type: "tv" or "movie"
      let path = `/discover/${media_type}?language=tr-TR&watch_region=TR&with_watch_monetization_types=flatrate&sort_by=popularity.desc&page=${page}`;
      if (with_genres) path += `&with_genres=${with_genres}`;
      if (with_watch_providers) path += `&with_watch_providers=${with_watch_providers}`;

      const data = await tmdbFetch(path, apiKey);

      const results = (data.results || []).map((item: any) => ({
        tmdb_id: item.id,
        title: media_type === "tv" ? (item.name || item.original_name) : (item.title || item.original_title),
        description: item.overview || null,
        poster_url: item.poster_path ? `${IMG_BASE}/w500${item.poster_path}` : null,
        release_year: media_type === "tv"
          ? (item.first_air_date?.split("-")[0] || null)
          : (item.release_date?.split("-")[0] || null),
        genre_ids: item.genre_ids || [],
        origin_country: item.origin_country || [],
      }));

      return new Response(JSON.stringify({
        page: data.page,
        total_pages: data.total_pages,
        total_results: data.total_results,
        results,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get watch providers for TR
    if (action === "providers") {
      const { media_type } = body; // "tv" or "movie"
      const data = await tmdbFetch(`/watch/providers/${media_type}?watch_region=TR&language=tr-TR`, apiKey);
      return new Response(JSON.stringify({ providers: data.results || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get genre list
    if (action === "genres") {
      const { media_type } = body;
      const data = await tmdbFetch(`/genre/${media_type}/list?language=tr-TR`, apiKey);
      return new Response(JSON.stringify({ genres: data.genres || [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get watch providers for a specific title
    if (action === "watch_providers") {
      const { tmdb_id, media_type } = body;
      const data = await tmdbFetch(`/${media_type}/${tmdb_id}/watch/providers`, apiKey);
      const tr = data.results?.TR;
      return new Response(JSON.stringify({ providers: tr || {} }), {
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
