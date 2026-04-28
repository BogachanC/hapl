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
    // 2-token title where one is the query (e.g. "Dark Matter", "Thomas & Friends",
    // "Şrek 2", "Shrek 2") — moderate. Must NOT compete with the exact match.
    // Vote-aware bands so genuinely popular sequels (e.g. "Şrek 2", 13K votes)
    // clear the short-query floor (0.5), while obscure same-shape titles do not.
    const titleTwo = titleTokens.length === 2 && titleTokens.includes(qTok);
    const origTwo = origTokens.length === 2 && origTokens.includes(qTok);
    if (titleTwo || origTwo) {
      const votesN = r.vote_count ?? 0;
      if (votesN < 200) {
        // weak sibling — collapses to long-title penalty band
        return Math.max(0.08, 0.25 + Math.min(0.05, votesN / 4000));
      }
      // Popular established sibling (e.g. "Şrek 2" 13K, "Star Trek 2" etc.):
      // lift base so it survives the short-query floor. Cap stays well below
      // the exact-match band (0.9) so the canonical title still ranks first.
      const isPopularSibling = votesN >= 1000;
      const base = isPopularSibling ? 0.55 : 0.4;
      const pop = Math.min(0.05, (r.popularity ?? 0) / 2000);
      const voteB = Math.min(0.1, votesN / 8000);
      return Math.min(0.78, base + pop + voteB);
    }
    // Leading-token match: query is the FIRST meaningful token of the title.
    // Examples we want to lift here:
    //   "Behzat" → "Behzat Ç. Bir Ankara Polisiyesi"
    //   "Behzat" → "Çekiç ve Gül: Bir Behzat Ç. Hikayesi" (title leads with Çekiç,
    //              but original/Turkish lead might differ — handled by includes branch)
    // Guard against pollution (e.g. "Friends" → "Friends with Benefits"):
    // require a meaningful vote_count so only established titles get the lift.
    const titleLeads = titleTokens.length > 0 && titleTokens[0] === qTok;
    const origLeads = origTokens.length > 0 && origTokens[0] === qTok;
    const votesL = r.vote_count ?? 0;
    if ((titleLeads || origLeads) && votesL >= 200) {
      // Lift to a band that survives the 0.5 floor and clears the firecrawl
      // gate (0.7) for popular titles, but stays below exact-match (0.9).
      const pop = Math.min(0.05, (r.popularity ?? 0) / 2000);
      const voteB = Math.min(0.1, votesL / 4000);
      return Math.min(0.85, 0.6 + pop + voteB);
    }
    // Token appears but title is long → very low (Thomas & Friends, Best Friends Whenever…)
    if (titleTokens.includes(qTok) || origTokens.includes(qTok)) {
      // Penalty grows with extra tokens (slightly steeper than before)
      const extra = Math.max(titleTokens.length, origTokens.length) - 1;
      return Math.max(0.04, 0.28 - extra * 0.06);
    }
    return 0.04;
  }

  // Multi-token query — combine signals
  const jacT = tokenSetSimilarity(q, title);
  const jacO = tokenSetSimilarity(q, orig);
  const ratT = similarityRatio(q, title);
  const ratO = similarityRatio(q, orig);
  const base = Math.max(jacT, jacO) * 0.6 + Math.max(ratT, ratO) * 0.4;

  // Subset bonus: if every query token is contained in the title (or original),
  // it's a clear match (e.g. "Stranger Things" ⊂ "Stranger Things 2"). This protects
  // legitimate long-form titles when token order/extras differ.
  const titleSet = new Set(titleTokens);
  const origSet = new Set(origTokens);
  const subsetOfTitle = qTokens.every((t) => titleSet.has(t));
  const subsetOfOrig = qTokens.every((t) => origSet.has(t));
  const subsetBonus = subsetOfTitle || subsetOfOrig ? 0.1 : 0;

  // Tiny / zero-vote multi-token siblings: dampen even if jaccard is decent.
  const votesN = r.vote_count ?? 0;
  const weakDamp = votesN < 100 ? 0.85 : 1.0;

  const pop = Math.min(0.05, (r.popularity ?? 0) / 1000);
  const votes = Math.min(0.05, votesN / 10000);
  return Math.min(1, (base * weakDamp) + subsetBonus + pop + votes);
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
  const qNorm = normalizeTitle(query);

  // PASS 1: detect a "dominant" sibling so we can gate weak subset matches.
  // Dominant = exact-title match (normalized equals query) AND popular (votes ≥ 1000).
  // When present, low-vote subset entries (e.g. obscure 2013 "Stranger Things"
  // film with 71 votes) get pruned. When absent (e.g. "Karadayı", "İnci Taneleri"
  // — only one low-vote entry exists), we keep the entry so the user still sees
  // their result.
  let hasDominantSibling = false;
  for (const r of raw) {
    if (r.media_type !== "movie" && r.media_type !== "tv") continue;
    const tNorm = normalizeTitle(r.title || r.name || "");
    const oNorm = normalizeTitle(r.original_title || r.original_name || "");
    if ((tNorm === qNorm || oNorm === qNorm) && (r.vote_count ?? 0) >= 1000) {
      hasDominantSibling = true;
      break;
    }
  }

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

    // Vote-aware sibling pruning for single-token queries:
    // an "exact title match" entry exists in this same result list →
    // demand at least 100 votes for any non-exact sibling to remain visible.
    // Exact-match entries (score ≥ 0.9) are always kept.
    if (isShortQuery && score < 0.9) {
      const tNorm = normalizeTitle(title);
      const oNorm = normalizeTitle(original);
      const isExactTitle = tNorm === qNorm || oNorm === qNorm;
      if (!isExactTitle && (r.vote_count ?? 0) < 100) continue;
    }

    // Multi-token: when a popular dominant sibling exists, prune low-vote
    // entries — including same-normalized-title duplicates (e.g. obscure 2013
    // "Stranger Things" film with 71 votes). The dominant entry itself is
    // protected by its own vote_count ≥ 1000; everything below 100 votes goes.
    if (!isShortQuery && hasDominantSibling && (r.vote_count ?? 0) < 100) {
      continue;
    }

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
