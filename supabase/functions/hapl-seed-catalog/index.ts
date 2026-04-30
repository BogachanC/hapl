// hapl-seed-catalog: admin-triggered TMDB catalog discovery + seed.
//
// Strategy:
//   - Iterate a curated list of TR streaming providers (TMDB watch_provider_ids)
//   - For each provider × media_type (movie, tv): fetch N pages of /discover
//   - Optionally include a documentary pass (genre 99) without provider filter
//   - For each discovered title:
//       • tmdbDetail()           → canonical metadata
//       • tmdbWatchProvidersTR() → real availability (don't trust discover scoping)
//       • upsert content_titles (with vote_count/popularity in metadata)
//       • upsert content_availability (only if real TR providers found)
//       • hydrateAliases() (lazy: only if needsHydration)
//
// Auth: requires `Authorization: Bearer <HAPL_SYNC_TOKEN>` (admin-only).
// Same shape as hapl-refresh — admin UI calls it via supabase.functions.invoke.
//
// Idempotent: relies on UNIQUE constraints on content_titles
// (tmdb_id, tmdb_type) and content_availability (title_id, provider_id, region, availability_type).

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

import { normalizeTitle } from "../_shared/normalize.ts";
import {
  tmdbDiscover,
  tmdbDetail,
  tmdbWatchProvidersTR,
  type TmdbDiscoverItem,
} from "../_shared/tmdb.ts";
import { needsHydration, hydrateAliases } from "../_shared/alias-cache.ts";
import {
  loadProviders,
  matchTmdbProvider,
  type ProviderRow,
} from "../_shared/providers.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ─── Configuration ────────────────────────────────────────────────────────
// TMDB provider_id mapping for Türkiye region. Stable IDs from /watch/providers.
// Order matters → priority for the seed loop.
const TMDB_PROVIDERS_TR: Array<{ slug: string; tmdb_id: number; priority: "primary" | "secondary" }> = [
  { slug: "netflix",            tmdb_id: 8,    priority: "primary" },
  { slug: "amazon-prime-video", tmdb_id: 119,  priority: "primary" },
  { slug: "max",                tmdb_id: 1899, priority: "primary" },
  { slug: "disney-plus",        tmdb_id: 337,  priority: "primary" },
  { slug: "mubi",               tmdb_id: 11,   priority: "primary" },
  { slug: "puhutv",             tmdb_id: 341,  priority: "primary" },
  { slug: "tabii",              tmdb_id: 1879, priority: "primary" },
  { slug: "gain",               tmdb_id: 583,  priority: "primary" },
  // Fragile / spotty TMDB coverage — included but lower priority
  { slug: "tv-plus",            tmdb_id: 1796, priority: "secondary" },
  { slug: "exxen",              tmdb_id: 1837, priority: "secondary" },
  { slug: "tod-tv",             tmdb_id: 2061, priority: "secondary" },
  { slug: "bein-connect",       tmdb_id: 217,  priority: "secondary" },
];

// Default scope per run. Overridable via request body.
const DEFAULT_PAGES_PRIMARY = 1;     // 20 items per page
const DEFAULT_PAGES_SECONDARY = 1;
const DEFAULT_DOC_PAGES = 1;         // documentary pass (genre 99)
const DEFAULT_VOTE_FLOOR = 20;       // skip ultra-low-signal titles

// Confidence mirrors hapl-refresh
function tmdbConfidenceFor(availType: string): number {
  switch (availType) {
    case "stream": return 0.92;
    case "free":
    case "ads":    return 0.88;
    case "rent":
    case "buy":    return 0.86;
    default:       return 0.85;
  }
}

function deriveContentKind(
  mediaType: "movie" | "tv",
  genres: { id: number; name: string }[],
): string {
  const gnames = (genres || []).map((g) => (g.name || "").toLowerCase());
  const isDoc = gnames.some((g) => g.includes("belgesel") || g.includes("documentary"));
  const isReality =
    gnames.some((g) => g.includes("reality") || g.includes("realite")) ||
    gnames.some((g) => g.includes("yarışma") || g.includes("yarisma"));
  if (isDoc) return "documentary";
  if (mediaType === "tv" && isReality) return "reality";
  if (mediaType === "movie") return "movie";
  return "series";
}

interface SeedStats {
  discovered: number;
  titles_upserted: number;
  titles_skipped_existing_fresh: number;
  availability_rows: number;
  aliases_added: number;
  errors: number;
}

interface SourceStats {
  source: string;
  discovered: number;
  titles_upserted: number;
  availability_rows: number;
  aliases_added: number;
}

async function processOne(
  sb: any,
  item: TmdbDiscoverItem,
  providers: ProviderRow[],
  stats: SeedStats,
): Promise<void> {
  try {
    // 1) Detail + real TR watch providers (don't trust discover provider scoping)
    const [detail, watch] = await Promise.all([
      tmdbDetail(item.media_type, item.id),
      tmdbWatchProvidersTR(item.media_type, item.id),
    ]);
    if (!detail) {
      stats.errors++;
      return;
    }

    const now = new Date().toISOString();
    const titleRow = {
      tmdb_id: detail.id,
      tmdb_type: item.media_type,
      title: detail.title,
      original_title: detail.original_title || null,
      normalized_title: normalizeTitle(detail.title),
      release_year: detail.release_date ? new Date(detail.release_date).getFullYear() : null,
      first_release_date: detail.release_date || null,
      poster_path: detail.poster_path,
      backdrop_path: detail.backdrop_path,
      overview: detail.overview,
      genres: (detail.genres || []).map((g: any) => g.name),
      content_kind: deriveContentKind(item.media_type, detail.genres || []),
      metadata: {
        vote_average: detail.vote_average,
        vote_count: detail.vote_count,
        popularity: item.popularity,
        seeded_via: "hapl-seed-catalog",
      },
      last_tmdb_sync_at: now,
      last_full_sync_at: now,
    };

    const { data: titleData, error: titleErr } = await sb
      .from("content_titles")
      .upsert(titleRow, { onConflict: "tmdb_id,tmdb_type" })
      .select("id")
      .maybeSingle();
    if (titleErr || !titleData?.id) {
      console.error("[seed] title upsert failed:", titleErr?.message);
      stats.errors++;
      return;
    }
    stats.titles_upserted++;
    const titleId = titleData.id;

    // 2) Availability — translate TMDB watch providers → our streaming_providers rows
    const availRows: Array<{
      title_id: string;
      provider_id: string;
      region: string;
      availability_type: string;
      status: string;
      source: string;
      confidence: number;
      checked_at: string;
      last_seen_at: string;
      raw_payload: any;
    }> = [];

    const buckets: Array<{ type: string; list: any[] }> = [
      { type: "stream", list: watch.flatrate },
      { type: "free",   list: watch.free },
      { type: "ads",    list: watch.ads },
      { type: "rent",   list: watch.rent },
      { type: "buy",    list: watch.buy },
    ];

    const seenKey = new Set<string>();
    for (const bucket of buckets) {
      for (const wp of bucket.list || []) {
        const matched = matchTmdbProvider(wp.provider_name, providers);
        if (!matched) continue;
        const k = `${matched.id}::${bucket.type}`;
        if (seenKey.has(k)) continue;
        seenKey.add(k);
        availRows.push({
          title_id: titleId,
          provider_id: matched.id,
          region: "TR",
          availability_type: bucket.type,
          status: "available",
          source: "tmdb",
          confidence: tmdbConfidenceFor(bucket.type),
          checked_at: now,
          last_seen_at: now,
          raw_payload: { provider_id: wp.provider_id, provider_name: wp.provider_name },
        });
      }
    }

    if (availRows.length > 0) {
      const { error: availErr } = await sb
        .from("content_availability")
        .upsert(availRows, {
          onConflict: "title_id,provider_id,region,availability_type",
        });
      if (availErr) {
        console.error("[seed] availability upsert failed:", availErr.message);
        stats.errors++;
      } else {
        stats.availability_rows += availRows.length;
      }
    }

    // 3) Aliases (lazy: only if stale or missing)
    if (await needsHydration(sb, detail.id, item.media_type)) {
      const added = await hydrateAliases(sb, detail.id, item.media_type, detail);
      stats.aliases_added += added;
    }
  } catch (err) {
    console.error("[seed] processOne exception:", (err as Error).message);
    stats.errors++;
  }
}

async function discoverProvider(
  sb: any,
  providerSlug: string,
  tmdbProviderId: number,
  pages: number,
  voteFloor: number,
  providers: ProviderRow[],
  globalSeen: Set<string>,
  stats: SeedStats,
): Promise<SourceStats> {
  const local: SourceStats = {
    source: providerSlug,
    discovered: 0,
    titles_upserted: 0,
    availability_rows: 0,
    aliases_added: 0,
  };
  const baseTitles = stats.titles_upserted;
  const baseAvail = stats.availability_rows;
  const baseAlias = stats.aliases_added;

  for (const type of ["movie", "tv"] as const) {
    for (let page = 1; page <= pages; page++) {
      const { results } = await tmdbDiscover({
        type,
        page,
        withWatchProviders: [tmdbProviderId],
        watchRegion: "TR",
        voteCountGte: voteFloor,
        sortBy: "popularity.desc",
      });
      for (const item of results) {
        local.discovered++;
        stats.discovered++;
        const k = `${item.media_type}:${item.id}`;
        if (globalSeen.has(k)) continue;
        globalSeen.add(k);
        await processOne(sb, item, providers, stats);
      }
    }
  }

  local.titles_upserted = stats.titles_upserted - baseTitles;
  local.availability_rows = stats.availability_rows - baseAvail;
  local.aliases_added = stats.aliases_added - baseAlias;
  return local;
}

async function discoverDocumentaries(
  sb: any,
  pages: number,
  voteFloor: number,
  providers: ProviderRow[],
  globalSeen: Set<string>,
  stats: SeedStats,
): Promise<SourceStats> {
  const local: SourceStats = {
    source: "documentary-genre-99",
    discovered: 0,
    titles_upserted: 0,
    availability_rows: 0,
    aliases_added: 0,
  };
  const baseTitles = stats.titles_upserted;
  const baseAvail = stats.availability_rows;
  const baseAlias = stats.aliases_added;

  for (const type of ["movie", "tv"] as const) {
    for (let page = 1; page <= pages; page++) {
      const { results } = await tmdbDiscover({
        type,
        page,
        withGenres: [99],
        watchRegion: "TR",
        voteCountGte: voteFloor,
        sortBy: "popularity.desc",
      });
      for (const item of results) {
        local.discovered++;
        stats.discovered++;
        const k = `${item.media_type}:${item.id}`;
        if (globalSeen.has(k)) continue;
        globalSeen.add(k);
        await processOne(sb, item, providers, stats);
      }
    }
  }

  local.titles_upserted = stats.titles_upserted - baseTitles;
  local.availability_rows = stats.availability_rows - baseAvail;
  local.aliases_added = stats.aliases_added - baseAlias;
  return local;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Admin auth — accepts EITHER:
  //   • Bearer <HAPL_SYNC_TOKEN>           (cron / curl path)
  //   • Bearer <user JWT> with admin role  (admin UI path)
  const auth = req.headers.get("authorization") || "";
  const expectedToken = Deno.env.get("HAPL_SYNC_TOKEN");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  let authorized = false;

  if (expectedToken && bearer === expectedToken) {
    authorized = true;
  } else if (bearer) {
    // Verify user JWT + admin role via service-role client
    const sbAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    try {
      const { data: claims } = await sbAuth.auth.getClaims(bearer);
      const uid = claims?.claims?.sub;
      if (uid) {
        const { data: roleRow } = await sbAuth
          .from("user_roles")
          .select("role")
          .eq("user_id", uid)
          .eq("role", "admin")
          .maybeSingle();
        if (roleRow) authorized = true;
      }
    } catch { /* fall through */ }
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const pagesPrimary = Math.max(0, Math.min(5, body.pages_primary ?? DEFAULT_PAGES_PRIMARY));
  const pagesSecondary = Math.max(0, Math.min(5, body.pages_secondary ?? DEFAULT_PAGES_SECONDARY));
  const pagesDocs = Math.max(0, Math.min(5, body.pages_docs ?? DEFAULT_DOC_PAGES));
  const voteFloor = Math.max(0, body.vote_floor ?? DEFAULT_VOTE_FLOOR);
  const providersFilter: string[] | null = Array.isArray(body.providers) && body.providers.length > 0
    ? body.providers
    : null;

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const providers = await loadProviders(sb);
  if (providers.length === 0) {
    return new Response(JSON.stringify({ error: "no providers configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const stats: SeedStats = {
    discovered: 0,
    titles_upserted: 0,
    titles_skipped_existing_fresh: 0,
    availability_rows: 0,
    aliases_added: 0,
    errors: 0,
  };
  const globalSeen = new Set<string>();
  const sources: SourceStats[] = [];

  const t0 = Date.now();

  for (const p of TMDB_PROVIDERS_TR) {
    if (providersFilter && !providersFilter.includes(p.slug)) continue;
    const pages = p.priority === "primary" ? pagesPrimary : pagesSecondary;
    if (pages <= 0) continue;
    try {
      const s = await discoverProvider(
        sb, p.slug, p.tmdb_id, pages, voteFloor, providers, globalSeen, stats,
      );
      sources.push(s);
    } catch (err) {
      console.error(`[seed] provider ${p.slug} failed:`, (err as Error).message);
      stats.errors++;
    }
  }

  if (pagesDocs > 0 && !providersFilter) {
    try {
      const s = await discoverDocumentaries(sb, pagesDocs, voteFloor, providers, globalSeen, stats);
      sources.push(s);
    } catch (err) {
      console.error("[seed] documentaries failed:", (err as Error).message);
      stats.errors++;
    }
  }

  const elapsed_ms = Date.now() - t0;

  return new Response(
    JSON.stringify({
      ok: true,
      params: { pagesPrimary, pagesSecondary, pagesDocs, voteFloor, providersFilter },
      stats,
      sources,
      elapsed_ms,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
