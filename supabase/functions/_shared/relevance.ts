// Relevance scoring & filtering for search results.
// Goal: queries like "Friends" should NOT return "Thomas & Friends",
// "Best Friends Whenever", random docs that merely contain the word.

import { normalizeTitle, tokenize, tokenSetSimilarity, similarityRatio } from "./normalize.ts";

export interface ScoredCandidate {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title: string;
  popularity: number;
  vote_count: number;
  release_year: number | null;
  raw: any;
  score: number;
}

interface RawTmdbResult {
  id: number;
  media_type: string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  popularity?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
}

/**
 * Score a single candidate vs a query.
 * Combines: exact-match boost, token-set jaccard, edit-distance,
 * popularity / vote_count signals.
 */
export function scoreCandidate(query: string, r: RawTmdbResult): number {
  const q = normalizeTitle(query);
  const title = normalizeTitle(r.title || r.name || "");
  const orig = normalizeTitle(r.original_title || r.original_name || "");
  if (!title && !orig) return 0;

  const qTokens = tokenize(query);
  const titleTokens = tokenize(r.title || r.name || "");
  const origTokens = tokenize(r.original_title || r.original_name || "");

  // Exact normalized match → strong
  if (title === q || orig === q) return 1.0;

  // Single-token query (e.g. "friends", "dark", "you") → much stricter.
  // Only EXACT-title match (1 token) or 2-token title scores high.
  // Anything longer ("Thomas & Friends") is heavily penalised so it sinks/drops.
  if (qTokens.length === 1) {
    const qTok = qTokens[0];
    const titleExact = titleTokens.length === 1 && titleTokens[0] === qTok;
    const origExact = origTokens.length === 1 && origTokens[0] === qTok;
    if (titleExact || origExact) {
      const pop = Math.min(0.1, (r.popularity ?? 0) / 1000);
      const votes = Math.min(0.05, (r.vote_count ?? 0) / 10000);
      return 0.9 + pop + votes;
    }
    // 2-token title where one is the query (e.g. "Dark Matter", "Thomas & Friends")
    // — moderate-low. Must NOT compete with the exact match.
    const titleTwo = titleTokens.length === 2 && titleTokens.includes(qTok);
    const origTwo = origTokens.length === 2 && origTokens.includes(qTok);
    if (titleTwo || origTwo) {
      const pop = Math.min(0.05, (r.popularity ?? 0) / 2000);
      return 0.4 + pop;
    }
    // Token appears but title is long → very low (Thomas & Friends, Best Friends Whenever…)
    if (titleTokens.includes(qTok) || origTokens.includes(qTok)) {
      // Penalty grows with extra tokens
      const extra = Math.max(titleTokens.length, origTokens.length) - 1;
      return Math.max(0.05, 0.3 - extra * 0.05);
    }
    return 0.05;
  }

  // Multi-token query — combine signals
  const jacT = tokenSetSimilarity(q, title);
  const jacO = tokenSetSimilarity(q, orig);
  const ratT = similarityRatio(q, title);
  const ratO = similarityRatio(q, orig);
  const base = Math.max(jacT, jacO) * 0.6 + Math.max(ratT, ratO) * 0.4;

  const pop = Math.min(0.05, (r.popularity ?? 0) / 1000);
  const votes = Math.min(0.05, (r.vote_count ?? 0) / 10000);
  return Math.min(1, base + pop + votes);
}

/**
 * Filter + rank TMDB multi-search results.
 * - Drops media_type other than movie/tv
 * - Drops zero-vote noise
 * - Drops low-relevance items (precision over recall)
 * - Sorts by score desc
 */
export function rankTmdbResults(query: string, raw: any[]): ScoredCandidate[] {
  const qTokens = tokenize(query);
  const isShortQuery = qTokens.length === 1;
  const out: ScoredCandidate[] = [];
  for (const r of raw) {
    if (r.media_type !== "movie" && r.media_type !== "tv") continue;
    const title = r.title || r.name || "";
    const original = r.original_title || r.original_name || "";
    if (!title) continue;
    const score = scoreCandidate(query, r);
    // Stricter floor for single-token queries (Friends, Dark, You)
    const floor = isShortQuery ? 0.5 : 0.3;
    if (score < floor) continue;
    if ((r.vote_count ?? 0) === 0 && score < 0.85) continue;

    const date = r.release_date || r.first_air_date || "";
    out.push({
      id: r.id,
      media_type: r.media_type,
      title,
      original_title: original,
      popularity: r.popularity ?? 0,
      vote_count: r.vote_count ?? 0,
      release_year: date ? new Date(date).getFullYear() : null,
      raw: r,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}
