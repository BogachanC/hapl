// hapl-seed-catalog: admin-triggered TMDB catalog discovery + seed.
//
// Resumable / chunked. The caller drives a multi-step run:
//   1. POST { pages_primary, pages_secondary, pages_docs, vote_floor }
//      → returns { done, next_cursor, plan_total, processed_jobs, stats, sources }
//   2. Subsequent calls: POST { cursor: <next_cursor> } (other params ignored
//      because the plan is encoded in the cursor).
//   3. Loop until done=true.
//
// Each call processes jobs until SOFT_TIME_BUDGET_MS, then returns early
// with the next cursor so the next call resumes where this one stopped.
//
// Idempotent: relies on UNIQUE constraints. Re-running a chunk is safe.
//
// Auth: admin JWT (has_role 'admin') OR HAPL_SYNC_TOKEN. Frontend uses JWT only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

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

// Soft time budget per chunk. 150s is the hard edge-runtime idle limit;
// we return well before that so the response can flush.
const SOFT_TIME_BUDGET_MS = 75_000;

// ─── Configuration ────────────────────────────────────────────────────────
const TMDB_PROVIDERS_TR: Array<{ slug: string; tmdb_id: number; priority: "primary" | "secondary" }> = [
  { slug: "netflix",            tmdb_id: 8,    priority: "primary" },
  { slug: "amazon-prime-video", tmdb_id: 119,  priority: "primary" },
  { slug: "max",                tmdb_id: 1899, priority: "primary" },
  { slug: "disney-plus",        tmdb_id: 337,  priority: "primary" },
  { slug: "mubi",               tmdb_id: 11,   priority: "primary" },
  { slug: "puhutv",             tmdb_id: 341,  priority: "primary" },
  { slug: "tabii",              tmdb_id: 1879, priority: "primary" },
  { slug: "gain",               tmdb_id: 583,  priority: "primary" },
  { slug: "tv-plus",            tmdb_id: 1796, priority: "secondary" },
  { slug: "exxen",              tmdb_id: 1837, priority: "secondary" },
  { slug: "tod-tv",             tmdb_id: 2061, priority: "secondary" },
  { slug: "bein-connect",       tmdb_id: 217,  priority: "secondary" },
];

const DEFAULT_PAGES_PRIMARY = 1;
const DEFAULT_PAGES_SECONDARY = 1;
const DEFAULT_DOC_PAGES = 1;
const DEFAULT_VOTE_FLOOR = 20;

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
  availability_rows: number;
  aliases_added: number;
  aliases_skipped_cached: number;
  errors: number;
  skipped_no_poster: number;
  skipped_no_tr_availability: number;
  kind_counts: Record<string, number>;
}

interface SourceStats {
  source: string;
  discovered: number;
  titles_upserted: number;
  availability_rows: number;
  aliases_added: number;
  aliases_skipped_cached: number;
}

// A single unit of work: one TMDB discover page for one (provider|docs, type, strategy).
interface Job {
  source: string;             // provider slug or "documentary-genre-99" or "deep:<strategy>:<provider>"
  type: "movie" | "tv";
  page: number;
  tmdb_provider_id?: number;  // present for provider jobs
  with_genres?: number[];     // present for doc jobs
  strategy?: string;          // popularity | vote_average | vote_count | recent
  sort_by?: string;
  vote_average_gte?: number;
  vote_count_gte?: number;
  release_date_gte?: string;
  release_date_lte?: string;
  with_original_language?: string;
}

interface Cursor {
  v: 1;
  jobs: Job[];
  job_index: number;          // next job to process
  vote_floor: number;
  stats: SeedStats;
  sources: Record<string, SourceStats>;
}

function buildPlan(
  pagesPrimary: number,
  pagesSecondary: number,
  pagesDocs: number,
  providersFilter: string[] | null,
): Job[] {
  const jobs: Job[] = [];
  for (const p of TMDB_PROVIDERS_TR) {
    if (providersFilter && !providersFilter.includes(p.slug)) continue;
    const pages = p.priority === "primary" ? pagesPrimary : pagesSecondary;
    for (const type of ["movie", "tv"] as const) {
      for (let page = 1; page <= pages; page++) {
        jobs.push({ source: p.slug, type, page, tmdb_provider_id: p.tmdb_id, strategy: "popularity", sort_by: "popularity.desc" });
      }
    }
  }
  if (pagesDocs > 0 && !providersFilter) {
    for (const type of ["movie", "tv"] as const) {
      for (let page = 1; page <= pagesDocs; page++) {
        jobs.push({ source: "documentary-genre-99", type, page, with_genres: [99], strategy: "popularity", sort_by: "popularity.desc" });
      }
    }
  }
  return jobs;
}

// ─── Deep expansion plan ────────────────────────────────────────────────
// Multi-strategy across primary providers + docs to surface beyond the
// popularity head. Each (provider, type, strategy) gets N pages.
interface DeepConfig {
  pages_per_strategy: number;       // pages each strategy iterates
  pages_docs_per_strategy: number;
  vote_count_floor: number;         // generic floor
  vote_average_floor: number;       // for vote_average.desc strategy
  strategies: Array<"popularity" | "vote_average" | "vote_count" | "recent">;
  recent_year_from?: number;        // YYYY for recent strategy
}

function buildDeepPlan(cfg: DeepConfig, providersFilter: string[] | null): Job[] {
  const jobs: Job[] = [];
  const recentGte = cfg.recent_year_from ? `${cfg.recent_year_from}-01-01` : "2022-01-01";

  for (const p of TMDB_PROVIDERS_TR) {
    if (providersFilter && !providersFilter.includes(p.slug)) continue;
    // Skip lowest-priority secondaries from deep expansion only if no titles match;
    // we still include them but with shorter strategy set.
    const stratList = p.priority === "primary"
      ? cfg.strategies
      : (cfg.strategies.includes("popularity") ? ["popularity" as const] : cfg.strategies.slice(0, 1));

    for (const type of ["movie", "tv"] as const) {
      for (const strat of stratList) {
        for (let page = 1; page <= cfg.pages_per_strategy; page++) {
          const job: Job = {
            source: `${p.slug}:${strat}`,
            type,
            page,
            tmdb_provider_id: p.tmdb_id,
            strategy: strat,
          };
          if (strat === "popularity") {
            job.sort_by = "popularity.desc";
            job.vote_count_gte = cfg.vote_count_floor;
          } else if (strat === "vote_average") {
            job.sort_by = "vote_average.desc";
            job.vote_count_gte = Math.max(cfg.vote_count_floor, 50);
            job.vote_average_gte = cfg.vote_average_floor;
          } else if (strat === "vote_count") {
            job.sort_by = "vote_count.desc";
            job.vote_count_gte = cfg.vote_count_floor;
          } else if (strat === "recent") {
            job.sort_by = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
            job.vote_count_gte = Math.max(5, Math.floor(cfg.vote_count_floor / 2));
            job.release_date_gte = recentGte;
          }
          jobs.push(job);
        }
      }
    }
  }

  if (!providersFilter) {
    for (const type of ["movie", "tv"] as const) {
      for (const strat of cfg.strategies) {
        for (let page = 1; page <= cfg.pages_docs_per_strategy; page++) {
          const job: Job = {
            source: `documentary-genre-99:${strat}`,
            type,
            page,
            with_genres: [99],
            strategy: strat,
          };
          if (strat === "popularity") {
            job.sort_by = "popularity.desc";
            job.vote_count_gte = cfg.vote_count_floor;
          } else if (strat === "vote_average") {
            job.sort_by = "vote_average.desc";
            job.vote_count_gte = Math.max(cfg.vote_count_floor, 30);
            job.vote_average_gte = cfg.vote_average_floor;
          } else if (strat === "vote_count") {
            job.sort_by = "vote_count.desc";
            job.vote_count_gte = cfg.vote_count_floor;
          } else if (strat === "recent") {
            job.sort_by = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
            job.vote_count_gte = Math.max(5, Math.floor(cfg.vote_count_floor / 2));
            job.release_date_gte = recentGte;
          }
          jobs.push(job);
        }
      }
    }
  }

  return jobs;
}

function emptySource(name: string): SourceStats {
  return {
    source: name,
    discovered: 0,
    titles_upserted: 0,
    availability_rows: 0,
    aliases_added: 0,
    aliases_skipped_cached: 0,
  };
}

async function processOne(
  sb: any,
  item: TmdbDiscoverItem,
  providers: ProviderRow[],
  stats: SeedStats,
  src: SourceStats,
): Promise<void> {
  try {
    const [detail, watch] = await Promise.all([
      tmdbDetail(item.media_type, item.id),
      tmdbWatchProvidersTR(item.media_type, item.id),
    ]);
    if (!detail) {
      stats.errors++;
      return;
    }
    // Quality guard: poster required
    if (!detail.poster_path) {
      stats.skipped_no_poster++;
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
    src.titles_upserted++;
    const kind = titleRow.content_kind || "unknown";
    stats.kind_counts[kind] = (stats.kind_counts[kind] || 0) + 1;
    const titleId = titleData.id;

    const availRows: any[] = [];
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
        .upsert(availRows, { onConflict: "title_id,provider_id,region,availability_type" });
      if (availErr) {
        console.error("[seed] availability upsert failed:", availErr.message);
        stats.errors++;
      } else {
        stats.availability_rows += availRows.length;
        src.availability_rows += availRows.length;
      }
    }

    if (await needsHydration(sb, detail.id, item.media_type)) {
      const added = await hydrateAliases(sb, detail.id, item.media_type, detail);
      stats.aliases_added += added;
      src.aliases_added += added;
    } else {
      stats.aliases_skipped_cached++;
      src.aliases_skipped_cached++;
    }
  } catch (err) {
    console.error("[seed] processOne exception:", (err as Error).message);
    stats.errors++;
  }
}

async function runJob(
  sb: any,
  job: Job,
  voteFloor: number,
  providers: ProviderRow[],
  stats: SeedStats,
  src: SourceStats,
): Promise<void> {
  const { results } = await tmdbDiscover({
    type: job.type,
    page: job.page,
    withWatchProviders: job.tmdb_provider_id ? [job.tmdb_provider_id] : undefined,
    withGenres: job.with_genres,
    watchRegion: "TR",
    voteCountGte: voteFloor,
    sortBy: "popularity.desc",
  });
  for (const item of results) {
    stats.discovered++;
    src.discovered++;
    await processOne(sb, item, providers, stats, src);
  }
}

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
    console.warn("[hapl-seed-catalog] auth failed:", authResult.reason);
    return new Response(
      JSON.stringify({ error: authResult.status === 403 ? "forbidden: admin role required" : "unauthorized", reason: authResult.reason }),
      { status: authResult.status ?? 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  console.log("[hapl-seed-catalog] authorized via:", authResult.reason);

  let body: any = {};
  try { body = await req.json(); } catch { /* allow empty */ }

  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const providers = await loadProviders(sb);
  if (providers.length === 0) {
    return new Response(JSON.stringify({ error: "no providers configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // ─── Cursor: either continue an existing run or start a new plan ──────
  let cursor: Cursor;
  if (body.cursor && typeof body.cursor === "object" && Array.isArray(body.cursor.jobs)) {
    cursor = body.cursor as Cursor;
    if (!cursor.stats.kind_counts) cursor.stats.kind_counts = {};
  } else {
    const pagesPrimary = Math.max(0, Math.min(20, body.pages_primary ?? DEFAULT_PAGES_PRIMARY));
    const pagesSecondary = Math.max(0, Math.min(20, body.pages_secondary ?? DEFAULT_PAGES_SECONDARY));
    const pagesDocs = Math.max(0, Math.min(20, body.pages_docs ?? DEFAULT_DOC_PAGES));
    const voteFloor = Math.max(0, body.vote_floor ?? DEFAULT_VOTE_FLOOR);
    const providersFilter: string[] | null = Array.isArray(body.providers) && body.providers.length > 0
      ? body.providers : null;
    const jobs = buildPlan(pagesPrimary, pagesSecondary, pagesDocs, providersFilter);
    cursor = {
      v: 1,
      jobs,
      job_index: 0,
      vote_floor: voteFloor,
      stats: {
        discovered: 0, titles_upserted: 0, availability_rows: 0,
        aliases_added: 0, aliases_skipped_cached: 0, errors: 0,
        kind_counts: {},
      },
      sources: {},
    };
  }

  const t0 = Date.now();
  const planTotal = cursor.jobs.length;
  const startIndex = cursor.job_index;
  let jobsDoneThisChunk = 0;

  while (cursor.job_index < cursor.jobs.length) {
    if (Date.now() - t0 > SOFT_TIME_BUDGET_MS) break;
    const job = cursor.jobs[cursor.job_index];
    if (!cursor.sources[job.source]) cursor.sources[job.source] = emptySource(job.source);
    try {
      await runJob(sb, job, cursor.vote_floor, providers, cursor.stats, cursor.sources[job.source]);
    } catch (err) {
      console.error(`[seed] job ${job.source}/${job.type}/p${job.page} failed:`, (err as Error).message);
      cursor.stats.errors++;
    }
    cursor.job_index++;
    jobsDoneThisChunk++;
  }

  const done = cursor.job_index >= cursor.jobs.length;
  const elapsed_ms = Date.now() - t0;

  return new Response(
    JSON.stringify({
      ok: true,
      done,
      next_cursor: done ? null : cursor,
      plan_total: planTotal,
      processed_jobs: cursor.job_index,
      jobs_done_this_chunk: jobsDoneThisChunk,
      job_index_start: startIndex,
      stats: cursor.stats,
      sources: Object.values(cursor.sources),
      elapsed_ms,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
