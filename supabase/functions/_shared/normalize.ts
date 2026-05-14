// Title & query normalization utilities — Türkçe duyarlı
// Lowercase, diacritics/punctuation arınmış, çok-boşluk daraltılmış.

const TR_MAP: Record<string, string> = {
  ı: "i", İ: "i", ş: "s", Ş: "s", ğ: "g", Ğ: "g",
  ü: "u", Ü: "u", ö: "o", Ö: "o", ç: "c", Ç: "c",
};

export function normalizeTitle(s: string): string {
  if (!s) return "";
  let out = "";
  for (const ch of s) out += TR_MAP[ch] ?? ch;
  return out
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(s: string): string[] {
  return normalizeTitle(s).split(" ").filter(Boolean);
}

// Stopwords (EN + TR) — these tokens never produce candidates on their own
// and contribute zero relevance signal. Normalized to ASCII lowercase to
// match normalizeTitle output (ş→s, ı→i, etc.).
const STOPWORDS = new Set<string>([
  // EN
  "and", "or", "the", "a", "an", "of", "in", "on", "to", "for",
  "with", "is", "it", "be", "at", "by", "as",
  // TR (after normalizeTitle: ş→s, ı→i, ü→u, etc.)
  "ve", "ile", "bir", "bu", "su", "o", "de", "da", "ya", "ki",
  "mi", "mu", "mı", "mü",
]);

export function isStopword(tok: string): boolean {
  return STOPWORDS.has(tok);
}

/**
 * Tokens that should drive search candidacy and scoring. Filters out:
 * - stopwords (and, ve, the, ile, ...)
 * - tokens shorter than 2 chars
 * Preserves order, deduped.
 */
export function meaningfulTokens(s: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokenize(s)) {
    if (t.length < 2) continue;
    if (STOPWORDS.has(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

// Token-set Jaccard similarity (0..1)
export function tokenSetSimilarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union;
}

// Levenshtein distance
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // prev row = edit distance from a[0..0] (empty) to b[0..j]
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// Normalized similarity (0..1) based on Levenshtein distance
export function similarityRatio(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x && !y) return 1;
  if (!x || !y) return 0;
  if (x === y) return 1;
  const maxLen = Math.max(x.length, y.length);
  if (maxLen === 0) return 1;
  const dist = levenshtein(x, y);
  return 1 - dist / maxLen;
}

export function cacheKey(query: string): string {
  return `hapl:${normalizeTitle(query)}`;
}
