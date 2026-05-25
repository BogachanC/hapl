// Display Title Policy v2 — generic, catalog-wide rules.
//
// Goals:
//   • Asian (non-Latin) content shouldn't render Hiragana / Hangul / Han
//     / Cyrillic / Arabic on the card. Use the English / international
//     Latin title instead.
//   • Turkish productions keep their Turkish title.
//   • All other foreign content shows the canonical Latin title
//     (English preferred, then any Latin original).
//   • Türkçe translations stay searchable as hidden aliases — they are
//     never the visible card title.
//
// This module is the single source of truth used by Meili sync, db-search
// and home-feed so the policy is consistent everywhere.

import { normalizeTitle } from "./normalize.ts";

export interface AliasMeta {
  alias: string;
  source?: string | null;       // tmdb_alt_title | tmdb_translation | tmdb_canonical | tmdb_original | seed | ...
  language?: string | null;     // ISO 639-1 (en, tr, ...)
  country?: string | null;      // ISO 3166-1 (US, TR, ...)
}

// Unicode-range based check: returns true if the string is dominantly Latin
// script (letters in Basic Latin + Latin-1 + Latin Extended). Allows
// diacritics, digits, punctuation and spaces. Empty strings → false.
export function isMostlyLatin(s: string): boolean {
  if (!s) return false;
  // Non-Latin script blocks we explicitly reject when in majority:
  //   CJK Unified Ideographs, Hiragana, Katakana, Hangul,
  //   Arabic, Hebrew, Cyrillic, Devanagari, Thai, Greek
  const NON_LATIN = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\u0600-\u06ff\u0590-\u05ff\u0400-\u04ff\u0900-\u097f\u0e00-\u0e7f\u0370-\u03ff]/;
  if (!NON_LATIN.test(s)) return true;
  // Mixed script — require Latin letters to clearly outnumber non-Latin.
  let latin = 0, nonLatin = 0;
  for (const ch of s) {
    if (/[A-Za-zÀ-ÖØ-öø-ÿĀ-žƀ-ɏ]/.test(ch)) latin++;
    else if (NON_LATIN.test(ch)) nonLatin++;
  }
  if (latin === 0) return false;
  return latin >= nonLatin * 2; // Latin must be ≥2× non-Latin to qualify
}

// Turkish productions detected without relying on metadata (which is sparse).
// Strong signals:
//   • Title carries Turkish-only diacritics (ç, ş, ğ, ı, İ) — these never
//     appear in pure English / international Latin titles.
//   • original_language === "tr" or origin_country includes "TR" (when known).
export function isTurkishProduction(
  title: string | null | undefined,
  originalTitle: string | null | undefined,
  meta?: { original_language?: string | null; origin_country?: string[] | null; production_countries?: any },
): boolean {
  const olang = (meta?.original_language || "").toLowerCase();
  if (olang === "tr") return true;
  const oc = meta?.origin_country;
  if (Array.isArray(oc) && oc.some((c) => String(c).toUpperCase() === "TR")) return true;
  const pc = meta?.production_countries;
  if (Array.isArray(pc)) {
    for (const c of pc) {
      const code = (typeof c === "string" ? c : c?.iso_3166_1) || "";
      if (String(code).toUpperCase() === "TR") return true;
    }
  }
  // No reliable metadata — use diacritic heuristic on the ORIGINAL title.
  // (DB `title` is the tr-TR translation for foreign content, so its
  // diacritics are not a Turkish-production signal.)
  const ot = originalTitle || "";
  const t = title || "";
  if (/[çğıİşÇĞİŞ]/.test(ot)) return true;
  // Fallback: title equals original_title AND original contains diacritics
  // unique to Turkish — also Turkish production.
  if (
    ot &&
    normalizeTitle(ot) === normalizeTitle(t) &&
    /[çğıİşÇĞİŞ]/.test(t)
  ) return true;
  return false;
}

export interface DisplayTitleResult {
  display: string;
  english: string | null;            // best Latin English candidate
  localized_tr: string | null;       // Turkish translated form
  original_script: string | null;    // original_title when non-Latin (e.g. Japanese)
  is_turkish: boolean;
}

/**
 * Pick display title per policy v2.
 *
 *  • Turkish production            → DB `title` (Turkish).
 *  • Foreign + Latin original_title → original_title.
 *  • Foreign + non-Latin original   → best English/Latin alias, then DB title
 *                                     if Latin, then any Latin alias.
 *
 * Türkçe localized title is always returned in `localized_tr` (hidden alias).
 * Original non-Latin script (if any) is returned in `original_script`.
 */
export function pickDisplayTitle(
  dbTitle: string,
  originalTitle: string | null,
  aliases: AliasMeta[] = [],
  meta?: { original_language?: string | null; origin_country?: string[] | null; production_countries?: any },
): DisplayTitleResult {
  const rawDb = (dbTitle || "").trim();
  const rawOriginal = (originalTitle || "").trim();
  const isTurkish = isTurkishProduction(rawDb, rawOriginal, meta);

  // Best English candidate from alias list.
  const englishCandidates: string[] = [];
  for (const a of aliases) {
    if (!a?.alias) continue;
    const lang = (a.language || "").toLowerCase();
    const country = (a.country || "").toUpperCase();
    const src = (a.source || "").toLowerCase();
    if (src === "tmdb_translation" && lang === "en") englishCandidates.push(a.alias);
    else if (src === "tmdb_alt_title" && country === "US") englishCandidates.push(a.alias);
  }
  // Pick first Latin English candidate.
  const english = englishCandidates.find((c) => isMostlyLatin(c)) || null;

  // Localized TR: prefer DB title when content is foreign (in tr-TR locale
  // the DB title is the translation). If DB title equals original_title or
  // the content is Turkish, fall back to explicit tr-TR alias.
  let localizedTr: string | null = null;
  if (!isTurkish && rawDb && normalizeTitle(rawDb) !== normalizeTitle(rawOriginal)) {
    localizedTr = rawDb;
  } else {
    const trAlias = aliases.find(
      (a) => (a.language || "").toLowerCase() === "tr" && (a.source || "").toLowerCase() === "tmdb_translation",
    );
    if (trAlias?.alias) localizedTr = trAlias.alias;
  }

  // Original script when original_title is non-Latin.
  const originalScript =
    rawOriginal && !isMostlyLatin(rawOriginal) ? rawOriginal : null;

  let display = "";
  if (isTurkish) {
    display = rawDb || rawOriginal;
  } else {
    // Foreign content: pick best Latin candidate.
    if (rawOriginal && isMostlyLatin(rawOriginal)) {
      display = rawOriginal;
    } else if (english) {
      display = english;
    } else if (rawDb && isMostlyLatin(rawDb)) {
      display = rawDb;
    } else {
      // Last resort: any Latin alias from the list.
      const latinAlias = aliases.find((a) => a?.alias && isMostlyLatin(a.alias))?.alias;
      display = latinAlias || rawDb || rawOriginal || "";
    }
  }

  return {
    display: display || rawDb || rawOriginal,
    english,
    localized_tr: localizedTr,
    original_script: originalScript,
    is_turkish: isTurkish,
  };
}

// English leading-article stripping. "The White Lotus" → "white lotus".
// Returns null if nothing was stripped (so callers can ignore it).
export function stripLeadingArticle(s: string): string | null {
  if (!s) return null;
  const m = s.match(/^\s*(the|a|an)\s+(.+)$/i);
  if (!m) return null;
  const rest = m[2].trim();
  return rest.length > 0 ? rest : null;
}
