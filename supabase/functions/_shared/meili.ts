// Meilisearch helper for Hapl Search v3 POC.
//
// Stage 1: only sync/setup is wired. search-content stays unchanged until
// MEILI_ENABLED=true and Stage 2 ships. All functions are defensive — if
// Meili isn't configured, calls throw a clear error so the caller can fall
// back to the existing DB-first / TMDB path without breaking the response.

import { normalizeTitle } from "./normalize.ts";
import {
  getExactAliasesForTitle,
  getFranchiseAliasesForTitle,
} from "./aliases.ts";
import {
  pickDisplayTitle,
  stripLeadingArticle,
  type AliasMeta,
} from "./display-title.ts";

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

// Meilisearch document IDs only accept [a-zA-Z0-9_-]. Build a canonical id
// from tmdb_type + tmdb_id and strip anything else to be safe.
export function sanitizeMeiliId(type: string, tmdbId: number | string): string {
  const t = String(type || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const i = String(tmdbId ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  return `${t}_${i}`;
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
// Attribute order is the ranking priority for the "attribute" ranking rule:
// matches in earlier-listed attributes beat matches in later ones.
//
//   title              — canonical/original title (display title)
//   exact_aliases      — same content in another language (Money Heist ↔ La Casa de Papel)
//                        + Türkçe localized title of THIS document (collision-safe:
//                        document-specific, not a global synonym)
//   localized_title_tr — Türkçe ad (also surfaced as alias, separate field for clarity)
//   original_title     — TMDB original-language title (often same as title now)
//   normalized_title   — diacritic-stripped form (yan yana / yanyana)
//   franchise_aliases  — franchise siblings; only fires if user actually queried the franchise
//   loose_aliases      — DB-collected aliases (countries, regional spellings)
const SEARCHABLE_ATTRIBUTES = [
  "title",
  "exact_aliases",
  "localized_title_tr",
  "original_title",
  "normalized_title",
  "franchise_aliases",
  "loose_aliases",
];


const FILTERABLE_ATTRIBUTES = [
  "type",
  "content_kind",
  "providers",
  "available_in_tr",
  "origin",
  "genres",
  "year",
  "franchise_key",
  "is_franchise_main",
  "is_spin_off",
  "is_special",
];

// search_rank: lower = more canonical. Used as a tie-breaker BEFORE
// vote_count so a low-vote main entry still outranks a popular spin-off
// when both are equally relevant on words/typo/proximity.
const SORTABLE_ATTRIBUTES = [
  "search_rank",
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
  "search_rank:asc",
  "proximity",
  "attribute",
  "sort",
  "exactness",
  "vote_count:desc",
];

// Very conservative phrase-level synonyms: only cross-language equivalents
// that are unambiguous. Alias fields do most of the work; synonyms here are
// safety net for short queries where attribute priority alone may not fire.
const SYNONYMS: Record<string, string[]> = {
  "money heist": ["la casa de papel"],
  "la casa de papel": ["money heist"],
  "ice age": ["buz devri"],
  "buz devri": ["ice age"],
  "shrek": ["şrek"],
  "şrek": ["shrek"],
  "lord of the rings": ["yüzüklerin efendisi"],
  "yüzüklerin efendisi": ["lord of the rings"],
  "fast and furious": ["hızlı ve öfkeli"],
  "hızlı ve öfkeli": ["fast and furious"],
};


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
      synonyms: SYNONYMS,
    }),
    cfg,
  });

  return { ok: true, indexName: cfg.indexName };
}

// ─── Document shape ──────────────────────────────────────────────────────

export interface MeiliDoc {
  id: string;
  tmdb_id: number;
  type: "movie" | "tv";
  content_kind: string | null;
  // Canonical / display title — original_title || title. This is what
  // ContentCard renders. Türkçe localized form lives in localized_title_tr
  // and exact_aliases (document-specific), never as a global synonym.
  title: string;
  original_title: string | null;
  localized_title_tr: string | null;
  normalized_title: string;
  // Categorized alias buckets — see SEARCHABLE_ATTRIBUTES for priority.
  exact_aliases: string[];
  franchise_aliases: string[];
  loose_aliases: string[];
  // Kept for back-compat / debugging; not in searchableAttributes anymore.
  aliases: string[];
  year: number | null;
  poster: string | null;
  backdrop: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genres: string[];
  origin: "yerli" | "yabanci" | "bilinmiyor";
  providers: string[];
  provider_names: string[];
  available_in_tr: boolean;
  confidence: number;
  updated_at: number;
  // Franchise / ranking helpers
  franchise_key: string | null;
  is_franchise_main: boolean;
  is_spin_off: boolean;
  is_special: boolean;
  search_rank: number; // lower = more canonical
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

  // ── Display title policy ──────────────────────────────────────────────
  // `title` in Meili = canonical/original (original_title || db.title).
  // Türkçe localized version is kept as a document-specific alias only —
  // never promoted to a global Meili synonym (that would cause cross-doc
  // collisions like "goodfellas" matching Friends via the shared TR title
  // "Sıkı Dostlar").
  const rawDbTitle = (title.title || "").trim();
  const rawOriginal = (title.original_title || "").trim();
  const displayTitle = rawOriginal || rawDbTitle;
  const localizedTitleTr =
    rawDbTitle && normalizeTitle(rawDbTitle) !== normalizeTitle(displayTitle)
      ? rawDbTitle
      : null;
  const titleText = displayTitle;

  // ── Categorize aliases ────────────────────────────────────────────────
  // Manual exact aliases are looked up by the canonical title.
  const manualExact = getExactAliasesForTitle(titleText);
  // Document-specific TR localized title joins exact_aliases so users can
  // still find content by Türkçe ad. Deduped (case/diacritic insensitive).
  const exactAliasesSet = new Map<string, string>();
  for (const a of manualExact) exactAliasesSet.set(normalizeTitle(a), a);
  if (localizedTitleTr) {
    const k = normalizeTitle(localizedTitleTr);
    if (k && !exactAliasesSet.has(k)) exactAliasesSet.set(k, localizedTitleTr);
  }
  const exactAliases = Array.from(exactAliasesSet.values());

  const franchiseMatch = getFranchiseAliasesForTitle(titleText);
  const franchiseAliases = franchiseMatch?.variants ?? [];
  const franchiseKey = franchiseMatch?.franchiseKey ?? null;

  // Move any DB aliases that are also exact/franchise/localized variants OUT of loose.
  const promoted = new Set<string>(
    [...exactAliases, ...franchiseAliases].map((s) => normalizeTitle(s)),
  );
  const looseAliases = aliasList.filter((a) => !promoted.has(normalizeTitle(a)));


  // ── Franchise / spin-off detection ───────────────────────────────────
  const normT = normalizeTitle(titleText);
  const collection = meta?.belongs_to_collection || null;
  const collectionName: string = collection?.name || "";
  const normCollection = normalizeTitle(collectionName);

  const kind = (title.content_kind || "").toLowerCase();
  const runtime = Number(meta?.runtime) || 0;
  const isShortOrSpecial =
    kind.includes("special") ||
    kind.includes("short") ||
    (title.tmdb_type === "tv" && runtime > 0 && runtime < 30);

  // Spin-off heuristics: "Presents:" marker, explicit subtitle markers, or
  // belongs to a different collection than the franchise root.
  const hasPresents = /\bpresents\b\s*[:\-]/i.test(titleText);
  const subtitleAfterColon = /:\s*\S/.test(titleText);
  const isInFranchise = !!franchiseKey || !!collectionName;

  // Special/anniversary/reunion/documentary/behind-the-scenes/making-of markers.
  // Matches EN + TR (both diacritic and ASCII forms). Used to demote
  // reunion / anniversary / making-of style content in franchise queries.
  const SPECIAL_RE =
    /(\banniversary\b|\breunion\b|\bspecial\b|\bdocumentary\b|\bbehind\b|\bmaking[\s-]of\b|\breturn\s+to\b|\byıldönümü\b|\byildonumu\b|\bbuluşma\b|\bbulusma\b|\bözel\b|\bozel\b|\bbelgesel\b|\bkamera\s+arkası\b|\bkamera\s+arkasi\b|\bdönüş\b|\bdonus\b)/i;
  const haystack = `${titleText} ${title.original_title || ""}`;
  const genresLower = (title.genres || []).map((g) => String(g).toLowerCase());
  const isDocumentaryGenre = genresLower.some((g) => g.includes("documentary") || g.includes("belgesel"));
  const isSpecial = SPECIAL_RE.test(haystack) || isDocumentaryGenre;

  // Heuristic main-entry: title equals franchise/collection name, or title is
  // first numeric in franchise (e.g. "Buz Devri", "Ice Age", "Hızlı ve Öfkeli").
  const looksLikeMain =
    isInFranchise &&
    !hasPresents &&
    !isShortOrSpecial &&
    !isSpecial &&
    (
      // Exact match to franchise key
      (franchiseKey && normT === franchiseKey) ||
      // Title equals collection root name
      (normCollection && normT === normCollection) ||
      // Title starts with collection/franchise name + " " + a numeric ordinal
      (franchiseKey && new RegExp(`^${franchiseKey}\\s+\\d`).test(normT)) ||
      (normCollection && new RegExp(`^${normCollection}\\s+\\d`).test(normT))
    );

  const isSpinOff =
    hasPresents ||
    isShortOrSpecial ||
    isSpecial ||
    // Inside a franchise, but title doesn't look like a numbered main entry
    // and contains a non-trivial subtitle (Hobbs & Shaw, Egg-Scapade etc.).
    (isInFranchise && !looksLikeMain && subtitleAfterColon);

  // search_rank: lower = more canonical.
  //   pure franchise main:                          30
  //   numbered franchise sequel:                    50
  //   standalone (not in franchise):               100
  //   other in-franchise (not main, no spin-off):  120
  //   spin-off / special / reunion / anniversary / documentary: 300
  let searchRank = 100;
  const isPureMain =
    !!franchiseKey && normT === franchiseKey ||
    (!!normCollection && normT === normCollection);
  const isNumberedSequel =
    !isPureMain && (
      (!!franchiseKey && new RegExp(`^${franchiseKey}\\s+\\d`).test(normT)) ||
      (!!normCollection && new RegExp(`^${normCollection}\\s+\\d`).test(normT))
    );
  if (isInFranchise) searchRank = 120;
  if (isNumberedSequel) searchRank = 50;
  if (isPureMain) searchRank = 30;
  if (isSpinOff || isSpecial) searchRank = 300;

  return {
    id: sanitizeMeiliId(title.tmdb_type, title.tmdb_id),
    tmdb_id: Number(title.tmdb_id),
    type: title.tmdb_type,
    content_kind: title.content_kind,
    title: titleText,
    original_title: rawOriginal || null,
    localized_title_tr: localizedTitleTr,
    normalized_title: normalizeTitle(titleText),

    exact_aliases: exactAliases,
    franchise_aliases: franchiseAliases,
    loose_aliases: looseAliases,
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
    franchise_key: franchiseKey,
    is_franchise_main: looksLikeMain,
    is_spin_off: isSpinOff,
    is_special: isSpecial,
    search_rank: searchRank,
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

// Wait for a Meili task to finish. Returns { status, error } where status is
// one of: succeeded | failed | canceled | enqueued | processing (last two
// mean we timed out polling). Polls every `intervalMs` up to `timeoutMs`.
export async function waitForTask(
  taskUid: number | string,
  cfg: MeiliConfig = getMeiliConfig(),
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<{ status: string; error: any | null; raw: any }> {
  if (taskUid === -1 || taskUid === undefined || taskUid === null) {
    return { status: "succeeded", error: null, raw: null };
  }
  const timeoutMs = opts.timeoutMs ?? 15000;
  const intervalMs = opts.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    last = await meiliRequest<any>(`/tasks/${taskUid}`, { method: "GET", cfg });
    const s = last?.status;
    if (s === "succeeded" || s === "failed" || s === "canceled") {
      return { status: s, error: last?.error ?? null, raw: last };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return { status: last?.status || "processing", error: last?.error ?? null, raw: last };
}

export async function deleteIndex(
  cfg: MeiliConfig = getMeiliConfig(),
): Promise<{ taskUid: number | string }> {
  if (!isMeiliConfigured(cfg)) throw new Error("Meilisearch not configured");
  try {
    const out = await meiliRequest<any>(`/indexes/${cfg.indexName}`, {
      method: "DELETE",
      cfg,
    });
    return { taskUid: out?.taskUid ?? -1 };
  } catch (e: any) {
    if (String(e?.message || "").includes("index_not_found")) {
      return { taskUid: -1 };
    }
    throw e;
  }
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
