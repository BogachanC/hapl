import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

async function authorize(req: Request): Promise<{ ok: boolean; reason: string; status?: number }> {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const expectedToken = Deno.env.get("HAPL_SYNC_TOKEN");

  if (expectedToken && bearer === expectedToken) {
    return { ok: true, reason: "sync-token" };
  }
  if (!bearer) return { ok: false, reason: "missing-credentials", status: 401 };

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) return { ok: false, reason: "server-misconfigured", status: 500 };

  const sbUser = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  const { data: claimsData, error: claimsErr } = await sbUser.auth.getClaims(bearer);
  if (claimsErr || !claimsData?.claims?.sub) {
    return { ok: false, reason: `invalid-jwt:${claimsErr?.message || "no-claims"}`, status: 401 };
  }
  const userId = claimsData.claims.sub as string;
  const { data: isAdmin, error: roleErr } = await sbUser.rpc("has_role", {
    _user_id: userId, _role: "admin",
  });
  if (roleErr) return { ok: false, reason: `role-check-error:${roleErr.message}`, status: 401 };
  if (!isAdmin) return { ok: false, reason: "not-admin", status: 403 };
  return { ok: true, reason: "admin-jwt" };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const authResult = await authorize(req);
  if (!authResult.ok) {
    console.warn("[hapl-manual-add] auth failed:", authResult.reason);
    return new Response(
      JSON.stringify({ error: authResult.status === 403 ? "forbidden: admin role required" : "unauthorized", reason: authResult.reason }),
      { status: authResult.status ?? 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  console.log("[hapl-manual-add] authorized via:", authResult.reason);

  let body: any = {};
  try { body = await req.json(); } catch {
    return new Response(
      JSON.stringify({ error: "invalid JSON body" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { title, contentType, overview, poster_url, release_year, genres, origin, status, provider_ids } = body;

  if (!title || typeof title !== "string" || !title.trim()) {
    return new Response(
      JSON.stringify({ error: "title is required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (contentType !== "dizi" && contentType !== "film") {
    return new Response(
      JSON.stringify({ error: "contentType must be 'dizi' or 'film'" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  if (!Array.isArray(provider_ids) || provider_ids.length === 0) {
    return new Response(
      JSON.stringify({ error: "provider_ids must be a non-empty array of provider UUIDs" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const tmdbType = contentType === "dizi" ? "tv" : "movie";
  const parsedYear = release_year != null ? parseInt(String(release_year), 10) : null;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: titleData, error: titleErr } = await sb
    .from("content_titles")
    .insert({
      tmdb_id: null,
      tmdb_type: tmdbType,
      title: title.trim(),
      source: "manual",
      overview: overview ?? null,
      poster_path: poster_url ?? null,
      release_year: Number.isFinite(parsedYear) ? parsedYear : null,
      genres: Array.isArray(genres) ? genres : [],
      metadata: { origin: origin ?? null, status: status ?? null, manual: true },
    })
    .select("id")
    .single();

  if (titleErr || !titleData?.id) {
    console.error("[hapl-manual-add] content_titles insert failed:", titleErr?.message);
    return new Response(
      JSON.stringify({ error: "content_titles insert failed", detail: titleErr?.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const titleId = titleData.id;

  const availRows = provider_ids.map((pid: string) => ({
    title_id: titleId,
    provider_id: pid,
    status: "available",
    source: "manual",
  }));

  const { error: availErr } = await sb
    .from("content_availability")
    .insert(availRows);

  if (availErr) {
    console.error("[hapl-manual-add] content_availability insert failed:", availErr.message);
    return new Response(
      JSON.stringify({ error: "content_availability insert failed", detail: availErr.message, title_id: titleId }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  console.log("[hapl-manual-add] created title", titleId, "with", provider_ids.length, "availability rows");
  return new Response(
    JSON.stringify({ ok: true, title_id: titleId }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
