// DB-first search layer for Hapl.
//
// Queries content_titles + content_title_aliases + content_availability
// directly. Returns results in the SAME ContentResultOut shape that
// search-content/index.ts already returns to the frontend, so callers can
// drop these straight into the response.
//
// Strong-result rule: if the top hit has score >= 0.85 AND at least 3
// providered results exist, the caller skips TMDB / Firecrawl entirely.

import { normalizeTitle, meaningfulTokens } from "./normalize.ts";
import { getAliasGroupMembers } from "./aliases.ts";
import { tmdbImage } from "./tmdb.ts";

export interface DbPlatformOut {
  id?: number;
  name: string;
  logo: string | null;
  type: "subscription" | "rent" | "free";
  link: string | null;
  source?: "tmdb" | "firecrawl";
  slug?: string;
}

export interface DbContentResultOut {
  id: number;
  type: "movie" | "tv";
  title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  imdb_rating: number | null;
  vote_count: number;
  genres: string[];
  platforms: DbPlatformOut[];
  tmdb_url: string;
  available_in_tr: boolean;
  confidence: number;
  origin?: "yerli" | "yabanci" | "bilinmiyor";
  /** Internal — used by caller for ranking, stripped before response if desired. */
  _score?: number;
}

export interface DbSearchOptions {
  /** Filter to titles available on this provider slug; rozet listesi yine tüm sağlayıcılar. */
  providerSlug?: string | null;
  /** all | movie | series | documentary  → maps to content_kind. */
  category?: string | null;
  /** Drop providerless rows from output (default true). */
  requireAvailable?: boolean;
  /** Hard cap. */
  limit?: number;
}

export interface DbSearchResult {
  results: DbContentResultOut[];
  topScore: number;
}

const AVAIL_TYPES_STREAM = new Set(["stream", "free", "ads"]);

function platformTypeFor(availType: string): "subscription" | "rent" | "free" {
  if (availType === "free" || availType === "ads") return "free";
  if (availType === "rent" || availType === "buy") return "rent";
  return "subscription";
}

function deriveOriginFromMeta(meta: any, originalLang: string | null): "yerli" | "yabanci" | "bilinmiyor" {
  const countries = new Set<string>();
  const pc = meta?.production_countries;
  if (Array.isArray(pc)) {
    for (const c of pc) {
      const code = (typeof c === "string" ? c : c?.iso_3166_1) || "";
      if (code) countries.add(String(code).toUpperCase());
    }
  }
  const oc = meta?.origin_country;
  if (Array.isArray(oc)) for (const c of oc) countries.add(String(c).toUpperCase());
  const lang = (originalLang || meta?.original_language || "").toLowerCase();
  if (countries.has("TR") || lang === "tr") return "yerli";
  if (countries.size > 0 || lang) return "yabanci";
  return "bilinmiyor";
}

/**
 * Map a category filter to content_kind values.
 * - all / null → no filter
 * - series → 'series'
 * - movie  → 'movie'
 * - documentary → 'documentary'
 */
function kindsForCategory(cat: string | null | undefined): string[] | null {
  if (!cat || cat === "all") return null;
  if (cat === "series" || cat === "tv") return ["series", "reality"];
  if (cat === "movie") return ["movie"];
  if (cat === "documentary") return ["documentary"];
  return null;
}

/**
 * Resolve which (tmdb_id, tmdb_type) pairs the query refers to via:
 * - exact normalized title
 * - exact normalized alias
 * - prefix on title
 * - trigram similarity on title + alias
 *
 * Returns a Map keyed by `${type}:${tmdb_id}` → match metadata for scoring.
 */
async function resolveCandidates(
  sb: any,
  q: string,
): Promise<Map<string, { kind: "exact_title" | "exact_alias" | "prefix" | "trgm"; sim: number; matched: number }>> {
  const norm = q;
  const candidates = new Map<string, { kind: "exact_title" | "exact_alias" | "prefix" | "trgm"; sim: number; matched: number }>();

  const upgrade = (
    key: string,
    kind: "exact_title" | "exact_alias" | "prefix" | "trgm",
    sim: number,
    matched: number,
  ) => {
    const rank = { exact_title: 4, exact_alias: 3, prefix: 2, trgm: 1 };
    const prev = candidates.get(key);
    if (!prev || rank[kind] > rank[prev.kind] || (rank[kind] === rank[prev.kind] && sim > prev.sim)) {
      candidates.set(key, { kind, sim, matched: Math.max(matched, prev?.matched ?? 0) });
    } else if (prev) {
      prev.matched = Math.max(prev.matched, matched);
    }
  };

  const queryMeaningful = meaningfulTokens(norm);
  const queryMeaningfulSet = new Set(queryMeaningful);
  const requireMulti = queryMeaningful.length >= 2;

  // 1) exact normalized title
  {
    const { data } = await sb
      .from("content_titles")
      .select("tmdb_id, tmdb_type")
      .eq("normalized_title", norm)
      .limit(20);
    for (const r of data || []) upgrade(`${r.tmdb_type}:${r.tmdb_id}`, "exact_title", 1, queryMeaningful.length);
  }

  // 2) exact alias
  {
    const { data } = await sb
      .from("content_title_aliases")
      .select("tmdb_id, tmdb_type")
      .eq("normalized_alias", norm)
      .limit(50);
    for (const r of data || []) upgrade(`${r.tmdb_type}:${r.tmdb_id}`, "exact_alias", 0.95, queryMeaningful.length);
  }

  // 3) prefix on title (only for queries >= 3 chars)
  if (norm.length >= 3) {
    const { data } = await sb
      .from("content_titles")
      .select("tmdb_id, tmdb_type")
      .like("normalized_title", `${norm}%`)
      .limit(40);
    for (const r of data || []) upgrade(`${r.tmdb_type}:${r.tmdb_id}`, "prefix", 0.85, queryMeaningful.length);
  }

  // 4) trigram on title — only meaningful tokens (skip stopwords like "and", "ve")
  if (norm.length >= 3 && queryMeaningful.length > 0) {
    const tokens = queryMeaningful.filter((t) => t.length >= 3).slice(0, 4);
    // Title trgm: count meaningful matches, gate single-token-only candidates if multi-token query.
    const titleHits = new Map<string, { sim: number; matched: Set<string> }>();
    for (const tok of tokens) {
      const { data } = await sb
        .from("content_titles")
        .select("tmdb_id, tmdb_type, normalized_title")
        .ilike("normalized_title", `%${tok}%`)
        .limit(40);
      for (const r of data || []) {
        const key = `${r.tmdb_type}:${r.tmdb_id}`;
        const candTokens = new Set(String(r.normalized_title || "").split(" "));
        let inter = 0;
        const matchedSet = new Set<string>();
        for (const t of queryMeaningfulSet) if (candTokens.has(t)) { inter++; matchedSet.add(t); }
        const sim = inter / Math.max(queryMeaningful.length, candTokens.size);
        const prev = titleHits.get(key);
        if (!prev) titleHits.set(key, { sim, matched: matchedSet });
        else {
          for (const m of matchedSet) prev.matched.add(m);
          if (sim > prev.sim) prev.sim = sim;
        }
      }
    }
    for (const [key, hit] of titleHits) {
      if (requireMulti && hit.matched.size < 2) continue; // skip "Harry Potter and ..." matched only on stopword
      const [t, idStr] = key.split(":");
      upgrade(key, "trgm", Math.max(0.3, hit.sim), hit.matched.size);
    }

    // Alias trgm: same multi-token gate. Aggregate matched tokens across alias rows per title.
    const aliasHits = new Map<string, Set<string>>();
    for (const tok of tokens) {
      const { data } = await sb
        .from("content_title_aliases")
        .select("tmdb_id, tmdb_type, normalized_alias")
        .ilike("normalized_alias", `%${tok}%`)
        .limit(60);
      for (const r of data || []) {
        const key = `${r.tmdb_type}:${r.tmdb_id}`;
        const aliasTokens = new Set(String(r.normalized_alias || "").split(" "));
        const matched = aliasHits.get(key) ?? new Set<string>();
        for (const t of queryMeaningfulSet) if (aliasTokens.has(t)) matched.add(t);
        aliasHits.set(key, matched);
      }
    }
    for (const [key, matched] of aliasHits) {
      if (requireMulti && matched.size < 2) continue;
      if (matched.size === 0) continue;
      const sim = matched.size / queryMeaningful.length;
      upgrade(key, "trgm", Math.max(0.3, sim), matched.size);
    }
  }

  return candidates;
}

export async function searchTitlesInDb(
  sb: any,
  rawQuery: string,
  opts: DbSearchOptions = {},
): Promise<DbSearchResult> {
  const norm = normalizeTitle(rawQuery);
  if (!norm) return { results: [], topScore: 0 };

  const candidates = await resolveCandidates(sb, norm);
  if (candidates.size === 0) return { results: [], topScore: 0 };

  const movieIds: number[] = [];
  const tvIds: number[] = [];
  for (const k of candidates.keys()) {
    const [t, idStr] = k.split(":");
    const id = Number(idStr);
    if (!Number.isFinite(id)) continue;
    if (t === "movie") movieIds.push(id);
    else if (t === "tv") tvIds.push(id);
  }

  const titleQueries: Promise<any>[] = [];
  const baseSelect =
    "id, tmdb_id, tmdb_type, title, original_title, normalized_title, release_year, poster_path, backdrop_path, overview, genres, content_kind, metadata";
  if (movieIds.length > 0) {
    titleQueries.push(
      sb.from("content_titles").select(baseSelect).eq("tmdb_type", "movie").in("tmdb_id", movieIds),
    );
  }
  if (tvIds.length > 0) {
    titleQueries.push(
      sb.from("content_titles").select(baseSelect).eq("tmdb_type", "tv").in("tmdb_id", tvIds),
    );
  }
  const titleResults = await Promise.all(titleQueries);
  const titles: any[] = [];
  for (const r of titleResults) for (const row of r.data || []) titles.push(row);
  if (titles.length === 0) return { results: [], topScore: 0 };

  const kinds = kindsForCategory(opts.category);
  const filteredTitles = kinds
    ? titles.filter((t) => kinds.includes(t.content_kind))
    : titles;
  if (filteredTitles.length === 0) return { results: [], topScore: 0 };

  const titleUuids = filteredTitles.map((t) => t.id);
  const { data: availRows } = await sb
    .from("content_availability")
    .select(
      "title_id, provider_id, region, availability_type, status, source, source_url, confidence",
    )
    .in("title_id", titleUuids)
    .eq("region", "TR")
    .eq("status", "available");

  const providerIds = Array.from(new Set((availRows || []).map((a: any) => a.provider_id)));
  let providerMap = new Map<string, any>();
  if (providerIds.length > 0) {
    const { data: provs } = await sb
      .from("streaming_providers")
      .select("id, slug, display_name")
      .in("id", providerIds);
    for (const p of provs || []) providerMap.set(p.id, p);
  }

  const availByTitle = new Map<string, any[]>();
  for (const a of availRows || []) {
    const arr = availByTitle.get(a.title_id) || [];
    arr.push(a);
    availByTitle.set(a.title_id, arr);
  }

  const aliasGroup = getAliasGroupMembers(rawQuery);
  const requireAvailable = opts.requireAvailable !== false;

  const results: DbContentResultOut[] = [];
  for (const t of filteredTitles) {
    const cand = candidates.get(`${t.tmdb_type}:${t.tmdb_id}`);
    if (!cand) continue;

    const avails = availByTitle.get(t.id) || [];
    if (opts.providerSlug) {
      const eligible = avails.some((a) => {
        const p = providerMap.get(a.provider_id);
        return p?.slug === opts.providerSlug;
      });
      if (!eligible) continue;
    }

    const seenSlugs = new Set<string>();
    const platforms: DbPlatformOut[] = [];
    for (const a of avails) {
      const p = providerMap.get(a.provider_id);
      if (!p || seenSlugs.has(p.slug)) continue;
      seenSlugs.add(p.slug);
      platforms.push({
        name: p.display_name,
        logo: null,
        type: platformTypeFor(a.availability_type),
        link: a.source_url || null,
        source: a.source === "firecrawl" ? "firecrawl" : "tmdb",
        slug: p.slug,
      });
    }

    if (requireAvailable && platforms.length === 0) continue;

    let score = 0;
    switch (cand.kind) {
      case "exact_title": score = 1.0; break;
      case "exact_alias": score = 0.95; break;
      case "prefix":      score = 0.85; break;
      case "trgm":        score = 0.40 + Math.min(0.4, cand.sim * 0.5); break;
    }

    const titleNorm = normalizeTitle(t.title || "");
    const origNorm = normalizeTitle(t.original_title || "");
    const isCanonical = !!aliasGroup && (
      (titleNorm && aliasGroup.has(titleNorm)) || (origNorm && aliasGroup.has(origNorm))
    );

    // Boost gating: weak base (trgm with poor coverage) should NOT be lifted
    // into "strong DB hit" territory by provider/popularity boosts.
    const baseStrong = score >= 0.5;
    if (isCanonical) score += t.tmdb_type === "tv" ? 0.20 : 0.08;
    if (baseStrong) {
      score += Math.min(0.10, platforms.length * 0.04);
      if (t.poster_path) score += 0.03;
      const metaPre = t.metadata || {};
      const vc = Number(metaPre.vote_count) || 0;
      if (vc >= 500) score += 0.04;
      else if (vc >= 100) score += 0.02;
    }
    // Hard cap for trgm: even with boosts, never exceed 0.84 unless canonical.
    if (cand.kind === "trgm" && !isCanonical) score = Math.min(score, 0.84);

    score = Math.min(1.5, score);
    const meta = t.metadata || {};
    const voteCount = Number(meta.vote_count) || 0;
    const origin = deriveOriginFromMeta(meta, meta.original_language || null);

    results.push({
      id: Number(t.tmdb_id),
      type: t.tmdb_type as "movie" | "tv",
      title: t.title,
      year: t.release_year ?? null,
      overview: t.overview || "",
      poster: tmdbImage(t.poster_path, "w500"),
      backdrop: tmdbImage(t.backdrop_path, "w780"),
      imdb_rating: meta.vote_average ? Math.round(Number(meta.vote_average) * 10) / 10 : null,
      vote_count: voteCount,
      genres: Array.isArray(t.genres) ? t.genres : [],
      platforms,
      tmdb_url: `https://www.themoviedb.org/${t.tmdb_type}/${t.tmdb_id}`,
      available_in_tr: platforms.length > 0,
      confidence: Math.round(Math.min(1, 0.6 + score * 0.3) * 100),
      origin,
      _score: score,
    });
  }

  results.sort((a, b) => (b._score ?? 0) - (a._score ?? 0));
  const limited = results.slice(0, opts.limit ?? 20);
  return {
    results: limited,
    topScore: limited[0]?._score ?? 0,
  };
}
