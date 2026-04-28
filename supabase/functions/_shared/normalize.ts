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

// Levenshtein-lite ratio (0..1)
export function similarityRatio(a: string, b: string): number {
  const x = normalizeTitle(a);
  const y = normalizeTitle(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const longer = x.length >= y.length ? x : y;
  const shorter = x.length >= y.length ? y : x;
  if (longer.length === 0) return 1;
  // Cheap distance
  const dp = new Array(shorter.length + 1).fill(0).map((_, i) => i);
  for (let i = 1; i <= longer.length; i++) {
    let prev = i;
    for (let j = 1; j <= shorter.length; j++) {
      const tmp = dp[j];
      dp[j] = longer[i - 1] === shorter[j - 1]
        ? dp[j - 1]
        : 1 + Math.min(dp[j - 1], dp[j], prev);
      prev = tmp;
    }
    dp[0] = i;
  }
  const dist = dp[shorter.length];
  return 1 - dist / longer.length;
}

export function cacheKey(query: string): string {
  return `hapl:${normalizeTitle(query)}`;
}
