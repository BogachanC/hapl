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

// Soft time budget per chunk. Keep well below the 150s hard idle limit so
// the response can flush and we can persist progress to DB before timeout.
const SOFT_TIME_BUDGET_MS = 45_000;

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
  titles_processed: number;        // total titles we touched (new + existing)
  titles_new: number;              // first-time inserts
  titles_existing: number;         // already existed, refreshed
  titles_upserted: number;         // back-compat: == titles_processed
  availability_rows: number;       // total rows written (new + updated)
  availability_new: number;
  availability_existing: number;
  aliases_added: number;
  aliases_skipped_cached: number;
  errors: number;
  skipped_no_poster: number;
  skipped_no_tr_availability: number;
  skipped_provider_unverified: number;
  kind_counts: Record<string, number>;
  provider_counts: Record<string, number>;
}

interface Baseline {
  target_slug: string | null;
  target_provider_id: string | null;
  titles_total_before: number;
  target_avail_before: number;
  target_available_titles_before: number;
}

interface CoverageDelta {
  target_slug: string;
  titles_total_before: number;
  titles_total_after: number;
  titles_total_delta: number;
  target_avail_before: number;
  target_avail_after: number;
  target_avail_delta: number;
  target_available_titles_before: number;
  target_available_titles_after: number;
  target_available_titles_delta: number;
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
  // Provider-targeted sweep: require this TMDB provider_id to appear in
  // the title's TR /watch/providers result. If not, skip availability write.
  verify_tmdb_provider_id?: number;
}

interface Cursor {
  v: 1;
  jobs: Job[];
  job_index: number;          // next job to process
  vote_floor: number;
  stats: SeedStats;
  sources: Record<string, SourceStats>;
  baseline?: Baseline;
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

// ─── Provider-targeted sweep ───────────────────────────────────────────
// For a fixed allow-list of TR providers, run multi-strategy discover and
// require TMDB /watch/providers TR to actually contain the provider before
// writing availability rows. Title-only upsert still happens for unverified.
const PROVIDER_TARGETED_ALLOWED = new Set([
  "netflix", "amazon-prime-video", "max", "disney-plus", "mubi", "tv-plus",
]);

interface ProviderTargetedConfig {
  pages_per_strategy: number;
  vote_count_floor: number;
  vote_average_floor: number;
  strategies: Array<"popularity" | "vote_average" | "vote_count" | "recent">;
  recent_year_from: number;
  providers?: string[]; // optional sub-filter
}

function buildProviderTargetedPlan(cfg: ProviderTargetedConfig): Job[] {
  const jobs: Job[] = [];
  const recentGte = `${cfg.recent_year_from}-01-01`;
  const filter = cfg.providers && cfg.providers.length > 0
    ? new Set(cfg.providers.filter((s) => PROVIDER_TARGETED_ALLOWED.has(s)))
    : PROVIDER_TARGETED_ALLOWED;

  for (const p of TMDB_PROVIDERS_TR) {
    if (!filter.has(p.slug)) continue;
    for (const type of ["movie", "tv"] as const) {
      for (const strat of cfg.strategies) {
        for (let page = 1; page <= cfg.pages_per_strategy; page++) {
          const job: Job = {
            source: `pt:${p.slug}:${strat}`,
            type,
            page,
            tmdb_provider_id: p.tmdb_id,
            verify_tmdb_provider_id: p.tmdb_id,
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
  verifyTmdbProviderId?: number,
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

    // Provider-targeted verification: ensure target provider truly appears
    // in TR watch/providers (any bucket). If not, skip availability write
    // entirely — but still upsert the title (it's a valid TR-visible title).
    let providerVerified = true;
    if (typeof verifyTmdbProviderId === "number") {
      const allBuckets = [
        ...(watch.flatrate || []),
        ...(watch.free || []),
        ...(watch.ads || []),
        ...(watch.rent || []),
        ...(watch.buy || []),
      ];
      providerVerified = allBuckets.some((wp: any) => wp.provider_id === verifyTmdbProviderId);
      if (!providerVerified) {
        stats.skipped_provider_unverified++;
      }
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

    // Detect new vs existing for accurate metrics
    const { data: existingTitle } = await sb
      .from("content_titles")
      .select("id")
      .eq("tmdb_id", detail.id)
      .eq("tmdb_type", item.media_type)
      .maybeSingle();
    const wasNewTitle = !existingTitle;

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
    stats.titles_processed++;
    stats.titles_upserted++;
    if (wasNewTitle) stats.titles_new++; else stats.titles_existing++;
    src.titles_upserted++;
    const kind = titleRow.content_kind || "unknown";
    stats.kind_counts[kind] = (stats.kind_counts[kind] || 0) + 1;
    const titleId = titleData.id;

    if (providerVerified) {
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
          stats.provider_counts[matched.slug] = (stats.provider_counts[matched.slug] || 0) + 1;
        }
      }
      if (availRows.length > 0) {
        // Detect existing rows for new vs updated metric
        const { data: existingAvail } = await sb
          .from("content_availability")
          .select("provider_id, availability_type")
          .eq("title_id", titleId)
          .eq("region", "TR")
          .in("provider_id", Array.from(new Set(availRows.map((r) => r.provider_id))));
        const existingKeys = new Set(
          (existingAvail || []).map((r: any) => `${r.provider_id}::${r.availability_type}`),
        );
        const newCount = availRows.filter((r) => !existingKeys.has(`${r.provider_id}::${r.availability_type}`)).length;
        const existingCount = availRows.length - newCount;

        const { error: availErr } = await sb
          .from("content_availability")
          .upsert(availRows, { onConflict: "title_id,provider_id,region,availability_type" });
        if (availErr) {
          console.error("[seed] availability upsert failed:", availErr.message);
          stats.errors++;
        } else {
          stats.availability_rows += availRows.length;
          stats.availability_new += newCount;
          stats.availability_existing += existingCount;
          src.availability_rows += availRows.length;
        }
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
    voteCountGte: job.vote_count_gte ?? voteFloor,
    voteAverageGte: job.vote_average_gte,
    releaseDateGte: job.release_date_gte,
    releaseDateLte: job.release_date_lte,
    withOriginalLanguage: job.with_original_language,
    sortBy: job.sort_by ?? "popularity.desc",
  });
  for (const item of results) {
    stats.discovered++;
    src.discovered++;
    // Quality guard: require poster up front to skip detail fetch entirely
    if (!item.poster_path) {
      stats.skipped_no_poster++;
      continue;
    }
    await processOne(sb, item, providers, stats, src, job.verify_tmdb_provider_id);
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

  // ─── Job persistence helpers ───────────────────────────────────────────
  async function persistJob(jobId: string, patch: Record<string, any>) {
    try {
      await sb.from("catalog_seed_jobs").update({
        ...patch,
        last_heartbeat_at: new Date().toISOString(),
      }).eq("id", jobId);
    } catch (e) {
      console.warn("[seed] persistJob failed:", (e as Error).message);
    }
  }

  // ─── Resume / restart / load existing job ─────────────────────────────
  let cursor: Cursor;
  let jobId: string | null = typeof body.job_id === "string" ? body.job_id : null;
  const isResume = !!body.resume && !!jobId;

  if (isResume) {
    const { data: jobRow, error: jobErr } = await sb
      .from("catalog_seed_jobs").select("*").eq("id", jobId).maybeSingle();
    if (jobErr || !jobRow) {
      return new Response(JSON.stringify({ error: "job not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (jobRow.status === "completed") {
      return new Response(JSON.stringify({
        ok: true, done: true, job_id: jobId, status: "completed",
        next_cursor: null, plan_total: jobRow.plan_total,
        processed_jobs: jobRow.processed_jobs, jobs_done_this_chunk: 0,
        stats: jobRow.stats, sources: jobRow.sources ?? [],
        coverage_delta: jobRow.coverage_delta ?? null, elapsed_ms: 0,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!jobRow.cursor) {
      return new Response(JSON.stringify({ error: "job has no cursor" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    cursor = jobRow.cursor as Cursor;
    await persistJob(jobId!, { status: "running", last_error: null });
  } else if (body.cursor && typeof body.cursor === "object" && Array.isArray(body.cursor.jobs)) {
    cursor = body.cursor as Cursor;
    if (!cursor.stats.kind_counts) cursor.stats.kind_counts = {};
    if (!cursor.stats.provider_counts) cursor.stats.provider_counts = {};
    if (typeof cursor.stats.skipped_no_poster !== "number") cursor.stats.skipped_no_poster = 0;
    if (typeof cursor.stats.skipped_no_tr_availability !== "number") cursor.stats.skipped_no_tr_availability = 0;
    if (typeof cursor.stats.skipped_provider_unverified !== "number") cursor.stats.skipped_provider_unverified = 0;
    if (typeof cursor.stats.titles_processed !== "number") cursor.stats.titles_processed = cursor.stats.titles_upserted ?? 0;
    if (typeof cursor.stats.titles_new !== "number") cursor.stats.titles_new = 0;
    if (typeof cursor.stats.titles_existing !== "number") cursor.stats.titles_existing = 0;
    if (typeof cursor.stats.availability_new !== "number") cursor.stats.availability_new = 0;
    if (typeof cursor.stats.availability_existing !== "number") cursor.stats.availability_existing = 0;
  } else {
    const voteFloor = Math.max(0, body.vote_floor ?? DEFAULT_VOTE_FLOOR);
    const providersFilter: string[] | null = Array.isArray(body.providers) && body.providers.length > 0
      ? body.providers : null;

    let jobs: Job[];
    if (body.mode === "deep") {
      const cfg: DeepConfig = {
        pages_per_strategy: Math.max(1, Math.min(20, body.pages_per_strategy ?? 5)),
        pages_docs_per_strategy: Math.max(0, Math.min(20, body.pages_docs_per_strategy ?? 3)),
        vote_count_floor: Math.max(0, body.vote_count_floor ?? 15),
        vote_average_floor: Math.max(0, body.vote_average_floor ?? 7.0),
        strategies: Array.isArray(body.strategies) && body.strategies.length > 0
          ? body.strategies
          : ["popularity", "vote_count", "vote_average", "recent"],
        recent_year_from: body.recent_year_from ?? 2022,
      };
      jobs = buildDeepPlan(cfg, providersFilter);
    } else if (body.mode === "provider-targeted") {
      const cfg: ProviderTargetedConfig = {
        pages_per_strategy: Math.max(1, Math.min(20, body.pages_per_strategy ?? 5)),
        vote_count_floor: Math.max(0, body.vote_count_floor ?? 10),
        vote_average_floor: Math.max(0, body.vote_average_floor ?? 6.5),
        strategies: Array.isArray(body.strategies) && body.strategies.length > 0
          ? body.strategies
          : ["popularity", "vote_count", "vote_average", "recent"],
        recent_year_from: body.recent_year_from ?? 2022,
        providers: providersFilter ?? undefined,
      };
      jobs = buildProviderTargetedPlan(cfg);
    } else if (body.mode === "provider-full") {
      const slug: string | undefined = (Array.isArray(providersFilter) && providersFilter.length === 1)
        ? providersFilter[0]
        : (typeof body.provider === "string" ? body.provider : undefined);
      const target = TMDB_PROVIDERS_TR.find((p) => p.slug === slug);
      if (!target || !PROVIDER_TARGETED_ALLOWED.has(target.slug)) {
        return new Response(JSON.stringify({ error: "provider-full requires a single supported provider" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const cfg = {
        vote_count_floor: Math.max(0, body.vote_count_floor ?? 10),
        vote_average_floor: Math.max(0, body.vote_average_floor ?? 6.5),
        strategies: (Array.isArray(body.strategies) && body.strategies.length > 0
          ? body.strategies
          : ["popularity", "vote_count", "vote_average", "recent"]) as Array<"popularity"|"vote_count"|"vote_average"|"recent">,
        recent_year_from: body.recent_year_from ?? 2022,
        max_pages_per_strategy: Math.max(1, Math.min(500, body.max_pages_per_strategy ?? 500)),
      };
      const recentGte = `${cfg.recent_year_from}-01-01`;
      jobs = [];
      for (const type of ["movie", "tv"] as const) {
        for (const strat of cfg.strategies) {
          const probeOpts: any = {
            type, page: 1, withWatchProviders: [target.tmdb_id], watchRegion: "TR",
          };
          if (strat === "popularity") {
            probeOpts.sortBy = "popularity.desc"; probeOpts.voteCountGte = cfg.vote_count_floor;
          } else if (strat === "vote_average") {
            probeOpts.sortBy = "vote_average.desc";
            probeOpts.voteCountGte = Math.max(cfg.vote_count_floor, 50);
            probeOpts.voteAverageGte = cfg.vote_average_floor;
          } else if (strat === "vote_count") {
            probeOpts.sortBy = "vote_count.desc"; probeOpts.voteCountGte = cfg.vote_count_floor;
          } else if (strat === "recent") {
            probeOpts.sortBy = type === "movie" ? "primary_release_date.desc" : "first_air_date.desc";
            probeOpts.voteCountGte = Math.max(5, Math.floor(cfg.vote_count_floor / 2));
            probeOpts.releaseDateGte = recentGte;
          }
          const probe = await tmdbDiscover(probeOpts);
          const totalPages = Math.min(probe.total_pages || 1, cfg.max_pages_per_strategy);
          for (let page = 1; page <= totalPages; page++) {
            jobs.push({
              source: `pf:${target.slug}:${strat}`,
              type, page,
              tmdb_provider_id: target.tmdb_id,
              verify_tmdb_provider_id: target.tmdb_id,
              strategy: strat,
              sort_by: probeOpts.sortBy,
              vote_count_gte: probeOpts.voteCountGte,
              vote_average_gte: probeOpts.voteAverageGte,
              release_date_gte: probeOpts.releaseDateGte,
            });
          }
        }
      }
    } else {
      const pagesPrimary = Math.max(0, Math.min(20, body.pages_primary ?? DEFAULT_PAGES_PRIMARY));
      const pagesSecondary = Math.max(0, Math.min(20, body.pages_secondary ?? DEFAULT_PAGES_SECONDARY));
      const pagesDocs = Math.max(0, Math.min(20, body.pages_docs ?? DEFAULT_DOC_PAGES));
      jobs = buildPlan(pagesPrimary, pagesSecondary, pagesDocs, providersFilter);
    }

    cursor = {
      v: 1, jobs, job_index: 0, vote_floor: voteFloor,
      stats: {
        discovered: 0,
        titles_processed: 0, titles_new: 0, titles_existing: 0,
        titles_upserted: 0,
        availability_rows: 0, availability_new: 0, availability_existing: 0,
        aliases_added: 0, aliases_skipped_cached: 0, errors: 0,
        skipped_no_poster: 0, skipped_no_tr_availability: 0,
        skipped_provider_unverified: 0,
        kind_counts: {}, provider_counts: {},
      },
      sources: {},
    };

    let baselineSlug: string | null = null;
    if ((body.mode === "provider-full" || body.mode === "provider-targeted")
        && providersFilter && providersFilter.length === 1) {
      baselineSlug = providersFilter[0];
    }
    const baseline: Baseline = {
      target_slug: baselineSlug, target_provider_id: null,
      titles_total_before: 0, target_avail_before: 0, target_available_titles_before: 0,
    };
    try {
      const totalQ = await sb.from("content_titles").select("id", { count: "exact", head: true });
      baseline.titles_total_before = totalQ.count ?? 0;
      if (baselineSlug) {
        const prov = providers.find((p) => p.slug === baselineSlug);
        if (prov) {
          baseline.target_provider_id = prov.id;
          const availQ = await sb
            .from("content_availability")
            .select("title_id", { count: "exact", head: true })
            .eq("provider_id", prov.id).eq("region", "TR").eq("status", "available");
          baseline.target_avail_before = availQ.count ?? 0;
          baseline.target_available_titles_before = availQ.count ?? 0;
        }
      }
    } catch (e) {
      console.warn("[seed] baseline capture failed:", (e as Error).message);
    }
    cursor.baseline = baseline;

    // Create persistent job row
    const { data: jobIns, error: jobInsErr } = await sb
      .from("catalog_seed_jobs")
      .insert({
        status: "running",
        mode: body.mode || "small",
        params: body,
        cursor,
        plan_total: cursor.jobs.length,
        processed_jobs: 0,
        stats: cursor.stats,
        sources: [],
        baseline,
      })
      .select("id")
      .maybeSingle();
    if (jobInsErr) console.warn("[seed] job insert failed:", jobInsErr.message);
    jobId = jobIns?.id ?? null;
  }

  const t0 = Date.now();
  const planTotal = cursor.jobs.length;
  const startIndex = cursor.job_index;
  let jobsDoneThisChunk = 0;
  let chunkError: string | null = null;

  try {
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
  } catch (err) {
    chunkError = (err as Error).message || "unknown chunk error";
    console.error("[seed] chunk fatal:", chunkError);
  }

  const done = !chunkError && cursor.job_index >= cursor.jobs.length;
  const elapsed_ms = Date.now() - t0;

  let coverage_delta: CoverageDelta | null = null;
  if (done && cursor.baseline) {
    try {
      const b = cursor.baseline;
      const totalAfterQ = await sb.from("content_titles").select("id", { count: "exact", head: true });
      const titlesTotalAfter = totalAfterQ.count ?? 0;
      let availAfter = b.target_avail_before;
      if (b.target_provider_id) {
        const aQ = await sb
          .from("content_availability")
          .select("title_id", { count: "exact", head: true })
          .eq("provider_id", b.target_provider_id).eq("region", "TR").eq("status", "available");
        availAfter = aQ.count ?? 0;
      }
      coverage_delta = {
        target_slug: b.target_slug ?? "all",
        titles_total_before: b.titles_total_before,
        titles_total_after: titlesTotalAfter,
        titles_total_delta: titlesTotalAfter - b.titles_total_before,
        target_avail_before: b.target_avail_before,
        target_avail_after: availAfter,
        target_avail_delta: availAfter - b.target_avail_before,
        target_available_titles_before: b.target_available_titles_before,
        target_available_titles_after: availAfter,
        target_available_titles_delta: availAfter - b.target_available_titles_before,
      };
    } catch (e) {
      console.warn("[seed] coverage delta failed:", (e as Error).message);
    }
  }

  if (jobId) {
    const idx = Math.min(cursor.job_index, cursor.jobs.length - 1);
    const currentJob = cursor.jobs[idx];
    const status = chunkError ? "failed" : (done ? "completed" : "partial");
    await persistJob(jobId, {
      status,
      cursor: done ? null : cursor,
      processed_jobs: cursor.job_index,
      plan_total: planTotal,
      stats: cursor.stats,
      sources: Object.values(cursor.sources),
      coverage_delta,
      last_error: chunkError,
      current_provider: currentJob?.source ?? null,
      current_strategy: currentJob?.strategy ?? null,
      current_type: currentJob?.type ?? null,
      current_page: currentJob?.page ?? null,
      completed_at: done ? new Date().toISOString() : null,
    });
  }

  return new Response(
    JSON.stringify({
      ok: !chunkError,
      done,
      status: chunkError ? "failed" : (done ? "completed" : "partial"),
      job_id: jobId,
      next_cursor: done || chunkError ? null : cursor,
      plan_total: planTotal,
      processed_jobs: cursor.job_index,
      jobs_done_this_chunk: jobsDoneThisChunk,
      job_index_start: startIndex,
      stats: cursor.stats,
      sources: Object.values(cursor.sources),
      coverage_delta,
      error: chunkError,
      elapsed_ms,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
