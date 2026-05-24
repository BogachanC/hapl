// Multilingual title & franchise aliases — hand-curated, extensible.
//
// Two distinct group types now, used by both search-time lookups and
// Meili indexing to put canonical equivalences ahead of franchise siblings:
//
//   EXACT_GROUPS      — same content, different languages/spellings.
//                       Example: "Money Heist" ↔ "La Casa de Papel".
//                       At index time, members get each other in `exact_aliases`.
//
//   FRANCHISE_GROUPS  — same franchise/series with multiple entries, possibly
//                       cross-language. Example: "Fast and Furious" ↔
//                       "Hızlı ve Öfkeli". Anything whose title CONTAINS a
//                       member gets the variants in `franchise_aliases`.
//
// Lookups are bidirectional and case/diacritic-insensitive.

import { normalizeTitle } from "./normalize.ts";

const EXACT_GROUPS: string[][] = [
  ["Money Heist", "La Casa de Papel", "La Casa De Papel"],
  ["Spirited Away", "Ruhların Kaçışı", "Sen to Chihiro no Kamikakushi"],
  ["The Office", "Ofis"],
  ["Friends", "Sıkı Dostlar"],
  ["Game of Thrones", "Taht Oyunları"],
  ["Squid Game", "Kalamar Oyunu"],
  ["Dark", "Karanlık"],
  ["The Crown", "Taç"],
  ["The Dark Knight", "Kara Şövalye"],
  ["Iron Man", "Demir Adam"],
];

const FRANCHISE_GROUPS: string[][] = [
  ["Şrek", "Shrek"],
  ["Buz Devri", "Ice Age"],
  ["Behzat", "Behzat Ç"],
  ["Yüzüklerin Efendisi", "The Lord of the Rings", "Lord of the Rings"],
  ["Hobbit", "The Hobbit"],
  ["Harry Potter"],
  ["Açlık Oyunları", "The Hunger Games"],
  ["Karayip Korsanları", "Pirates of the Caribbean"],
  ["Yıldız Savaşları", "Star Wars"],
  ["Örümcek Adam", "Spider-Man", "Spiderman"],
  ["Hızlı ve Öfkeli", "Fast and Furious", "Fast & Furious", "The Fast and the Furious"],
  ["Görevimiz Tehlike", "Mission Impossible", "Mission: Impossible"],
];

const ALL_GROUPS = [...EXACT_GROUPS, ...FRANCHISE_GROUPS];

// Build normalized → array<original alternates> index once (combined, for
// backward-compatible getAliases).
const INDEX: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const group of ALL_GROUPS) {
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

const GROUP_MEMBERS: Map<string, Set<string>> = (() => {
  const m = new Map<string, Set<string>>();
  for (const group of ALL_GROUPS) {
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

export function getAliases(query: string): string[] {
  const key = normalizeTitle(query);
  return INDEX.get(key) || [];
}

export function getAliasGroupMembers(query: string): Set<string> | null {
  const key = normalizeTitle(query);
  return GROUP_MEMBERS.get(key) || null;
}

// ─── New: categorized alias lookups for indexing ─────────────────────────

/**
 * Exact equivalents for a given title. Used when the title is a 1:1 match
 * to a member of an EXACT_GROUP.
 */
export function getExactAliasesForTitle(title: string): string[] {
  const key = normalizeTitle(title);
  if (!key) return [];
  for (const group of EXACT_GROUPS) {
    const norms = group.map(normalizeTitle);
    if (norms.includes(key)) {
      return group.filter((m) => normalizeTitle(m) !== key);
    }
  }
  return [];
}

/**
 * Franchise variants whose normalized form is contained in the title's
 * normalized form. Returns all OTHER members of the matched franchise group.
 *
 * Example: title "Ice Age: The Meltdown" matches the "ice age" franchise key
 * and returns ["Buz Devri"]. Title "Buz Devri 3" matches the "buz devri" key
 * and returns ["Ice Age"].
 */
export function getFranchiseAliasesForTitle(title: string): {
  variants: string[];
  franchiseKey: string;
} | null {
  const norm = normalizeTitle(title);
  if (!norm) return null;
  const tokens = new Set(norm.split(/\s+/).filter(Boolean));
  for (const group of FRANCHISE_GROUPS) {
    for (const member of group) {
      const memberNorm = normalizeTitle(member);
      if (!memberNorm) continue;
      // Match if title starts with member key, contains it as a whole-phrase
      // substring (with word boundaries via space delimiters), or the member
      // is a single token contained in the title's tokens.
      const memberTokens = memberNorm.split(/\s+/);
      const isPhrase =
        norm === memberNorm ||
        norm.startsWith(memberNorm + " ") ||
        norm.endsWith(" " + memberNorm) ||
        norm.includes(" " + memberNorm + " ") ||
        norm.includes(memberNorm + ":") ||
        norm.includes(memberNorm + " ");
      const isTokenMatch =
        memberTokens.length === 1 && tokens.has(memberNorm);
      if (isPhrase || isTokenMatch) {
        const variants = group
          .filter((m) => normalizeTitle(m) !== memberNorm)
          .filter((m) => !!normalizeTitle(m));
        return { variants, franchiseKey: normalizeTitle(group[0]) };
      }
    }
  }
  return null;
}
