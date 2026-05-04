// Multilingual title & franchise aliases — small, hand-curated, extensible.
//
// Two use-cases:
// 1) Multilingual fallback for high-value cross-language titles where TMDB's
//    localized index misses hits (e.g. "Money Heist" ↔ "La Casa de Papel").
// 2) Franchise variant expansion: when a user types one spelling/language,
//    also probe the equivalent so series films come through (e.g. "Şrek" ↔ "Shrek",
//    "Buz Devri" ↔ "Ice Age", "Behzat" ↔ "Behzat Ç").
//
// This is NOT a translation dictionary. Add entries only with strong justification.

import { normalizeTitle } from "./normalize.ts";

// Each group is a set of equivalent titles / franchise spellings.
// Lookups are bidirectional: any member maps to all the others.
const ALIAS_GROUPS: string[][] = [
  // Cross-language full-title aliases
  ["Money Heist", "La Casa de Papel", "La Casa De Papel"],
  ["Spirited Away", "Ruhların Kaçışı", "Sen to Chihiro no Kamikakushi"],
  ["The Office", "Ofis"],
  ["Friends", "Sıkı Dostlar"],
  ["Game of Thrones", "Taht Oyunları"],
  ["Squid Game", "Kalamar Oyunu"],
  ["Dark", "Karanlık"],
  ["The Crown", "Taç"],

  // Franchise / spelling variants — each variant probes a different TMDB index
  // and surfaces the full series (e.g. Shrek 2, Buz Devri 3...).
  ["Şrek", "Shrek"],
  ["Buz Devri", "Ice Age"],
  ["Behzat", "Behzat Ç"],
  ["Yüzüklerin Efendisi", "The Lord of the Rings"],
  ["Hobbit", "The Hobbit"],
  ["Açlık Oyunları", "The Hunger Games"],
  ["Karayip Korsanları", "Pirates of the Caribbean"],
  ["Yıldız Savaşları", "Star Wars"],
  ["Örümcek Adam", "Spider-Man", "Spiderman"],
  ["Demir Adam", "Iron Man"],
  ["Kara Şövalye", "The Dark Knight"],
  ["Hızlı ve Öfkeli", "Fast and Furious", "The Fast and the Furious"],
  ["Görevimiz Tehlike", "Mission Impossible", "Mission: Impossible"],
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

// Normalized → full set of normalized members of the same group (incl. self).
// Used by search ranking to detect when a candidate's title belongs to the
// same alias/franchise group the user actually queried.
const GROUP_MEMBERS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const group of ALIAS_GROUPS) {
    const normSet = new Set<string>();
    for (const member of group) {
      const k = normalizeTitle(member);
      if (k) normSet.add(k);
    }
    if (normSet.size === 0) continue;
    for (const k of normSet) m.set(k, normSet);
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

/**
 * If `query` belongs to a known alias/franchise group, return the set of
 * ALL normalized member titles of that group (including the query itself).
 * Otherwise null.
 *
 * Lets the search ranker recognise when a candidate result is the canonical
 * group member (e.g. "La Casa de Papel") versus a same-name-but-unrelated
 * sibling (e.g. "Coin Heist" / "Darphane Soygunu") that only got pulled in
 * via token overlap on the alias variant query.
 */
export function getAliasGroupMembers(query: string): Set<string> | null {
  const key = normalizeTitle(query);
  return GROUP_MEMBERS.get(key) || null;
}
