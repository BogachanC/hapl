// Meilisearch helper for Hapl Search v3 POC.
//
// Stage 1: only sync/setup is wired. search-content stays unchanged until
// MEILI_ENABLED=true and Stage 2 ships. All functions are defensive — if
// Meili isn't configured, calls throw a clear error so the caller can fall
// back to the existing DB-first / TMDB path without breaking the response.

import { normalizeTitle } from "./normalize.ts";

export interface MeiliConfig {
  host: string;
  masterKey: string;
  indexName: string;
  enabled: boolean;
}

export function getMeiliConfig(): MeiliConfig {
  const host = (Deno.env.get("MEILI_HOST") || "").replace(/\/+$/, "");
  const masterKey = Deno.env.get("MEILI_MASTER_KEY") || "";
  const indexName = Deno.env.get("MEILI_INDEX_NAME") || "hapl_content_v1";
  const enabledRaw = (Deno.env.get("MEILI_ENABLED") || "").toLowerCase();
  const enabled = enabledRaw === "true" || enabledRaw === "1" || enabledRaw === "yes";
  return { host, masterKey, indexName, enabled };
}

export function isMeiliConfigured(cfg: MeiliConfig = getMeiliConfig()): boolean {
  return Boolean(cfg.host && cfg.masterKey);
}

async function meiliRequest<T = any>(
  path: string,
  init: RequestInit & { cfg?: MeiliConfig } = {},
): Promise<T> {
  const cfg = init.cfg || getMeiliConfig();
  if (!isMeiliConfigured(cfg)) {
    throw new Error("Meilisearch not configured (MEILI_HOST / MEILI_MASTER_KEY missing)");
  }
  const url = `${cfg.host}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Authorization": `Bearer ${cfg.masterKey}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* keep raw */ }
  if (!res.ok) {
    const detail = parsed?.message || text || `${res.status}`;
    throw new Error(`Meili ${init.method || "GET"} ${path} → ${res.status}: ${detail}`);
  }
  return parsed as T;
}

// ─── Index settings ──────────────────────────────────────────────────────
const SEARCHABLE_ATTRIBUTES = [
  "title",
  "aliases",
  "original_title",
  "normalized_title",
];

const FILTERABLE_ATTRIBUTES = [
  "type",
  "content_kind",
  "providers",
  "available_in_tr",
  "origin",
  "genres",
  "year",
];

const SORTABLE_ATTRIBUTES = [
  "vote_count",
  "vote_average",
  "popularity",
  "year",
  "updated_at",
];

const STOP_WORDS = [
  // EN
  "and", "or", "the", "a", "an", "of", "in", "on", "to", "for",
  "with", "is", "it", "be", "at", "by", "as",
  // TR (normalized: ş→s, ı→i, ü→u, etc. — but Meili sees raw too, keep both)
  "ve", "ile", "bir", "bu", "şu", "su", "o", "de", "da", "ya", "ki",
  "mi", "mı", "mu", "mü",
];

const RANKING_RULES = [
  "words",
  "typo",
  "proximity",
  "attribute",
  "sort",
  "exactness",
  "vote_count:desc",
];

/**
 * Create the index (idempotent) and push settings. Safe to call repeatedly.
 */
export async function ensureIndexSettings(cfg: MeiliConfig = getMeiliConfig()) {
  if (!isMeiliConfigured(cfg)) throw new Error("Meilisearch not configured");

  // 1) Create index (200 if exists, 202 if newly created)
  try {
    await meiliRequest("/indexes", {
      method: "POST",
      body: JSON.stringify({ uid: cfg.indexName, primaryKey: "id" }),
      cfg,
    });
  } catch (e: any) {
    // index_already_exists is fine
    if (!String(e?.message || "").includes("index_already_exists")) {
      // Meili returns 4xx for duplicate; ignore that specific case, rethrow others
      if (!String(e?.message || "").includes("already exists")) {
        // Best-effort: keep going to apply settings even if create returned weirdly
        console.warn("[meili] create index warning:", e?.message);
      }
    }
  }

  // 2) Apply settings in one call (Meili supports the /settings endpoint)
  await meiliRequest(`/indexes/${cfg.indexName}/settings`, {
    method: "PATCH",
    body: JSON.stringify({
      searchableAttributes: SEARCHABLE_ATTRIBUTES,
      filterableAttributes: FILTERABLE_ATTRIBUTES,
      sortableAttributes: SORTABLE_ATTRIBUTES,
      stopWords: STOP_WORDS,
      rankingRules: RANKING_RULES,
      // synonyms intentionally minimal — alias coverage lives in document.aliases[]
      synonyms: {},
    }),
    cfg,
  });

  return { ok: true, indexName: cfg.indexName };
}

// ─── Document shape ──────────────────────────────────────────────────────

export interface MeiliDoc {
  id: string;           // `${tmdb_type}:${tmdb_id}` — primary key
  tmdb_id: number;
  type: "movie" | "tv";
  content_kind: string | null;
  title: string;
  original_title: string | null;
  normalized_title: string;
  aliases: string[];
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genres: string[];
  origin: "yerli" | "yabanci" | "bilinmiyor";
  providers: string[];        // slug list
  provider_names: string[];   // display names
  available_in_tr: boolean;
  confidence: number;
  updated_at: number;         // unix seconds (sortable)
}

interface RawTitle {
  id: string;
  tmdb_id: number;
  tmdb_type: "movie" | "tv";
  title: string;
  original_title: string | null;
  normalized_title: string | null;
  release_year: number | null;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: string[] | null;
  content_kind: string | null;
  metadata: any;
  updated_at: string;
}

interface RawAlias { alias: string }

interface RawAvail {
  provider_id: string;
  status: string;
  source: string;
  confidence: number | null;
}

interface RawProvider {
  id: string;
  slug: string;
  display_name: string;
}

function tmdbImg(path: string | null, size: string): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

function deriveOrigin(meta: any): "yerli" | "yabanci" | "bilinmiyor" {
  const countries = new Set<string>();
  for (const c of (meta?.production_countries || [])) {
    const code = (typeof c === "string" ? c : c?.iso_3166_1) || "";
    if (code) countries.add(String(code).toUpperCase());
  }
  for (const c of (meta?.origin_country || [])) countries.add(String(c).toUpperCase());
  const lang = (meta?.original_language || "").toLowerCase();
  if (countries.has("TR") || lang === "tr") return "yerli";
  if (countries.size > 0 || lang) return "yabanci";
  return "bilinmiyor";
}

/**
 * Build a Meili document from a content_titles row plus the joined
 * aliases + availability + provider lookups.
 */
export function mapContentTitleToMeiliDocument(
  title: RawTitle,
  aliases: RawAlias[],
  avails: RawAvail[],
  providerById: Map<string, RawProvider>,
): MeiliDoc {
  const providerSlugs: string[] = [];
  const providerNames: string[] = [];
  const seen = new Set<string>();
  let maxConf = 0;
  for (const a of avails) {
    if (a.status !== "available") continue;
    const p = providerById.get(a.provider_id);
    if (!p || seen.has(p.slug)) continue;
    seen.add(p.slug);
    providerSlugs.push(p.slug);
    providerNames.push(p.display_name);
    if (typeof a.confidence === "number" && a.confidence > maxConf) maxConf = a.confidence;
  }

  const aliasList = Array.from(
    new Set(
      aliases
        .map((a) => (a.alias || "").trim())
        .filter((x) => x.length > 0),
    ),
  );

  const meta = title.metadata || {};
  const voteAvg = Number(meta.vote_average) || 0;
  const voteCnt = Number(meta.vote_count) || 0;
  const popularity = Number(meta.popularity) || 0;
  const updatedAtMs = title.updated_at ? new Date(title.updated_at).getTime() : Date.now();

  return {
    id: `${title.tmdb_type}:${title.tmdb_id}`,
    tmdb_id: Number(title.tmdb_id),
    type: title.tmdb_type,
    content_kind: title.content_kind,
    title: title.title || "",
    original_title: title.original_title || null,
    normalized_title: title.normalized_title || normalizeTitle(title.title || ""),
    aliases: aliasList,
    year: title.release_year,
    poster: tmdbImg(title.poster_path, "w500"),
    backdrop: tmdbImg(title.backdrop_path, "w780"),
    vote_average: voteAvg,
    vote_count: voteCnt,
    popularity,
    genres: title.genres || [],
    origin: deriveOrigin(meta),
    providers: providerSlugs,
    provider_names: providerNames,
    available_in_tr: providerSlugs.length > 0,
    confidence: Math.round(Math.max(maxConf, 0) * 100),
    updated_at: Math.floor(updatedAtMs / 1000),
  };
}

// ─── Document operations ─────────────────────────────────────────────────

export async function upsertDocuments(
  docs: MeiliDoc[],
  cfg: MeiliConfig = getMeiliConfig(),
): Promise<{ taskUid: number | string; count: number }> {
  if (!isMeiliConfigured(cfg)) throw new Error("Meilisearch not configured");
  if (docs.length === 0) return { taskUid: -1, count: 0 };
  const out = await meiliRequest<{ taskUid: number | string }>(
    `/indexes/${cfg.indexName}/documents`,
    { method: "POST", body: JSON.stringify(docs), cfg },
  );
  return { taskUid: out?.taskUid ?? -1, count: docs.length };
}

export async function deleteDocuments(
  ids: string[],
  cfg: MeiliConfig = getMeiliConfig(),
): Promise<{ taskUid: number | string; count: number }> {
  if (!isMeiliConfigured(cfg)) throw new Error("Meilisearch not configured");
  if (ids.length === 0) return { taskUid: -1, count: 0 };
  const out = await meiliRequest<{ taskUid: number | string }>(
    `/indexes/${cfg.indexName}/documents/delete-batch`,
    { method: "POST", body: JSON.stringify(ids), cfg },
  );
  return { taskUid: out?.taskUid ?? -1, count: ids.length };
}

// ─── Search (used by Stage 2; safe to ship now) ──────────────────────────

export interface MeiliSearchOpts {
  q: string;
  limit?: number;
  filter?: string;
  sort?: string[];
}

export async function searchMeili(
  opts: MeiliSearchOpts,
  cfg: MeiliConfig = getMeiliConfig(),
): Promise<{ hits: MeiliDoc[]; estimatedTotalHits: number; processingTimeMs: number }> {
  if (!isMeiliConfigured(cfg)) throw new Error("Meilisearch not configured");
  const body: Record<string, unknown> = {
    q: opts.q,
    limit: opts.limit ?? 20,
  };
  if (opts.filter) body.filter = opts.filter;
  if (opts.sort && opts.sort.length > 0) body.sort = opts.sort;
  const res = await meiliRequest<any>(`/indexes/${cfg.indexName}/search`, {
    method: "POST",
    body: JSON.stringify(body),
    cfg,
  });
  return {
    hits: (res?.hits || []) as MeiliDoc[],
    estimatedTotalHits: res?.estimatedTotalHits ?? res?.totalHits ?? 0,
    processingTimeMs: res?.processingTimeMs ?? 0,
  };
}
