// hapl-resolve-title: resolve a TMDB (id, type) pair to a content_titles UUID.
// If the title doesn't exist yet, fetches TMDB detail and seeds it.
// Auth: any authenticated user (not admin-only).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { normalizeTitle } from "../_shared/normalize.ts";
import { tmdbDetail } from "../_shared/tmdb.ts";
import { deriveContentKind } from "../_shared/content-kind.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── Auth: require authenticated user ───────────────────────────────────
  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ── Input ──────────────────────────────────────────────────────────────
  let body: any = {};
  try { body = await req.json(); } catch { /* empty */ }

  const tmdbId = Number(body.tmdb_id);
  const tmdbType = body.tmdb_type;
  if (!tmdbId || !Number.isFinite(tmdbId) || (tmdbType !== "movie" && tmdbType !== "tv")) {
    return new Response(
      JSON.stringify({ error: "tmdb_id (number) and tmdb_type ('movie'|'tv') required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  // ── Check existing ─────────────────────────────────────────────────────
  const { data: existing } = await sb
    .from("content_titles")
    .select("id")
    .eq("tmdb_id", tmdbId)
    .eq("tmdb_type", tmdbType)
    .maybeSingle();

  if (existing?.id) {
    return new Response(
      JSON.stringify({ title_id: existing.id }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  // ── Seed from TMDB ─────────────────────────────────────────────────────
  const detail = await tmdbDetail(tmdbType, tmdbId);
  if (!detail) {
    return new Response(
      JSON.stringify({ error: "TMDB title not found" }),
      { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const now = new Date().toISOString();
  const { data: titleData, error: titleErr } = await sb
    .from("content_titles")
    .upsert(
      {
        tmdb_id: detail.id,
        tmdb_type: tmdbType,
        title: detail.title,
        original_title: detail.original_title || null,
        normalized_title: normalizeTitle(detail.title),
        release_year: detail.release_date
          ? new Date(detail.release_date).getFullYear()
          : null,
        first_release_date: detail.release_date || null,
        poster_path: detail.poster_path,
        backdrop_path: detail.backdrop_path,
        overview: detail.overview,
        genres: (detail.genres || []).map((g: any) => g.name),
        content_kind: deriveContentKind(tmdbType, detail.genres || []),
        last_tmdb_sync_at: now,
      },
      { onConflict: "tmdb_id,tmdb_type" },
    )
    .select("id")
    .maybeSingle();

  if (titleErr || !titleData?.id) {
    console.error("[hapl-resolve-title] upsert failed:", titleErr?.message);
    return new Response(
      JSON.stringify({ error: "Failed to create title" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ title_id: titleData.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
