// Multilingual title aliases — small, hand-curated, extensible.
// Goal: when a user searches in one language and TMDB's tr-TR multi-search
// returns weak/empty results, we re-query with a known equivalent title.
//
// Keep this list intentionally small. It is NOT a translation dictionary;
// it is a fallback safety net for high-value titles where TMDB's localized
// index misses cross-language hits. Add entries only with strong justification.

import { normalizeTitle } from "./normalize.ts";

// Each group is a set of equivalent titles across languages.
// Lookups are bidirectional: any member maps to all the others.
const ALIAS_GROUPS: string[][] = [
  ["Money Heist", "La Casa de Papel", "La Casa De Papel"],
  ["Spirited Away", "Ruhların Kaçışı", "Sen to Chihiro no Kamikakushi"],
  ["The Office", "Ofis"],
  ["Friends", "Sıkı Dostlar"],
  ["Game of Thrones", "Taht Oyunları"],
  ["Squid Game", "Kalamar Oyunu"],
  ["Breaking Bad", "Kötü Adamlar"], // weak alias; only used when primary is empty
  ["Dark", "Karanlık"],
  ["The Crown", "Taç"],
];

// Build normalized → array<original alternates> index once.
const INDEX: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of ALIAS_GROUPS) {
    for (const member of group) {
      const key = normalizeTitle(member);
      if (!key) continue;
      const others = group.filter((x) => normalizeTitle(x) !== key);
      if (others.length === 0) continue;
      m.set(key, others);
    }
  }
  return m;
})();

/**
 * Return alternate titles for a query, or [] if none known.
 * Matching is normalized (case/diacritic-insensitive).
 */
export function getAliases(query: string): string[] {
  const key = normalizeTitle(query);
  return INDEX.get(key) || [];
}
