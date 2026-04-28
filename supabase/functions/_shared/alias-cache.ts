// Scalable alias cache backed by `content_title_aliases`.
//
// Two roles:
//   1) READ  — query expansion: given a user query, return canonical titles
//              from the cache so search-content can probe TMDB with them.
//   2) WRITE — lazy hydration: when we successfully detail a title, fetch
//              alt_titles + translations from TMDB and persist normalized
//              aliases. Throttled per-call so we never hammer TMDB during a
//              single search.

import { normalizeTitle } from "./normalize.ts";
import {
  tmdbAlternativeTitles,
  tmdbTranslations,
  type TmdbAliasRaw,
  type TmdbDetail,
} from "./tmdb.ts";

const HYDRATE_TTL_DAYS = 30; // re-hydrate aliases at most this often per title

export interface AliasRow {
  alias: string;
  normalized_alias: string;
  source: string;
  language: string | null;
  country: string | null;
}

/**
 * Look up canonical / alternate titles for a user query via the alias cache.
 * Returns DEDUPED original-spelling alternates (not the query itself).
 *
 * Used as TMDB query-expansion fuel — caller probes TMDB with each result.
 */
export async function getAliasExpansions(sb: any, query: string): Promise<string[]> {
  const norm = normalizeTitle(query);
  if (!norm) return [];

  // 1) Find which titles this query maps to
  const { data: hits } = await sb
    .from("content_title_aliases")
    .select("tmdb_id, tmdb_type")
    .eq("normalized_alias", norm)
    .limit(20);

  if (!hits || hits.length === 0) return [];

  // 2) Pull all aliases for those titles
  const ids = Array.from(new Set(hits.map((h: any) => `${h.tmdb_type}:${h.tmdb_id}`)));
  // Postgrest can't OR-filter cleanly across composite keys; fetch per-type.
  const movieIds = hits.filter((h: any) => h.tmdb_type === "movie").map((h: any) => h.tmdb_id);
  const tvIds = hits.filter((h: any) => h.tmdb_type === "tv").map((h: any) => h.tmdb_id);

  const tasks: Promise<any>[] = [];
  if (movieIds.length > 0) {
    tasks.push(
      sb.from("content_title_aliases")
        .select("alias, normalized_alias")
        .eq("tmdb_type", "movie")
        .in("tmdb_id", movieIds),
    );
  }
  if (tvIds.length > 0) {
    tasks.push(
      sb.from("content_title_aliases")
        .select("alias, normalized_alias")
        .eq("tmdb_type", "tv")
        .in("tmdb_id", tvIds),
    );
  }
  const results = await Promise.all(tasks);

  const seen = new Set<string>([norm]);
  const out: string[] = [];
  for (const r of results) {
    for (const row of r.data || []) {
      const k = row.normalized_alias;
      if (!k || seen.has(k)) continue;
      seen.add(k);
      out.push(row.alias);
    }
  }
  return out.slice(0, 8); // cap expansions per query
}

/**
 * Decide whether a title needs (re-)hydration. Cheap probe: just checks
 * the most recent updated_at on any alias row for this tmdb_id+type.
 */
export async function needsHydration(
  sb: any,
  tmdbId: number,
  tmdbType: "movie" | "tv",
): Promise<boolean> {
  const { data } = await sb
    .from("content_title_aliases")
    .select("updated_at")
    .eq("tmdb_id", tmdbId)
    .eq("tmdb_type", tmdbType)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return true;
  const last = new Date(data.updated_at).getTime();
  const ttlMs = HYDRATE_TTL_DAYS * 24 * 3600 * 1000;
  return Date.now() - last > ttlMs;
}

/**
 * Hydrate aliases for a title from TMDB (alt_titles + translations) plus
 * the canonical + original strings already known. Idempotent: relies on
 * the table's UNIQUE constraint to dedupe.
 *
 * Soft-fails: any error is logged and swallowed. Never throws.
 */
export async function hydrateAliases(
  sb: any,
  tmdbId: number,
  tmdbType: "movie" | "tv",
  detail: TmdbDetail,
): Promise<number> {
  try {
    // Fetch both endpoints in parallel
    const [alts, trans] = await Promise.all([
      tmdbAlternativeTitles(tmdbType, tmdbId).catch(() => [] as TmdbAliasRaw[]),
      tmdbTranslations(tmdbType, tmdbId).catch(() => [] as TmdbAliasRaw[]),
    ]);

    const rows: AliasRow[] = [];
    const pushUnique = (
      alias: string,
      source: string,
      language: string | null,
      country: string | null,
    ) => {
      const normalized = normalizeTitle(alias);
      if (!normalized) return;
      rows.push({ alias: alias.trim(), normalized_alias: normalized, source, language, country });
    };

    // canonical (TR-localized title we already have)
    if (detail.title) pushUnique(detail.title, "tmdb_canonical", "tr", "TR");
    // original
    if (detail.original_title && detail.original_title !== detail.title) {
      pushUnique(detail.original_title, "tmdb_original", null, null);
    }
    // alt_titles (TR / US)
    for (const a of alts) pushUnique(a.alias, a.source, a.language, a.country);
    // translations (tr / en)
    for (const t of trans) pushUnique(t.alias, t.source, t.language, t.country);

    if (rows.length === 0) return 0;

    // Dedupe within this batch by composite (normalized_alias, source) so a
    // single upsert call doesn't conflict with itself. The DB UNIQUE on
    // (tmdb_id, tmdb_type, normalized_alias, source) guards across calls.
    const seen = new Set<string>();
    const uniq = rows.filter((r) => {
      const k = `${r.normalized_alias}::${r.source}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    const payload = uniq.map((r) => ({
      tmdb_id: tmdbId,
      tmdb_type: tmdbType,
      alias: r.alias,
      normalized_alias: r.normalized_alias,
      source: r.source,
      language: r.language,
      country: r.country,
    }));

    const { error } = await sb
      .from("content_title_aliases")
      .upsert(payload, { onConflict: "tmdb_id,tmdb_type,normalized_alias,source" });

    if (error) {
      console.error("[alias-cache] upsert error:", error.message);
      return 0;
    }
    return payload.length;
  } catch (err) {
    console.error("[alias-cache] hydrate exception:", (err as Error).message);
    return 0;
  }
}
