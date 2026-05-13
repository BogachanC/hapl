// Derive content origin (yerli / yabancı / bilinmiyor) from TMDB-ish metadata.
// Used in UI as a small etiquette badge — not a definitive legal signal.

export type Origin = 'yerli' | 'yabanci' | 'bilinmiyor';

export const originLabels: Record<Origin, string> = {
  yerli: 'Yerli',
  yabanci: 'Yabancı',
  bilinmiyor: 'Bilinmiyor',
};

export function deriveOrigin(input: {
  original_language?: string | null;
  production_countries?: Array<string | { iso_3166_1?: string }> | null;
  origin_country?: string[] | null;
}): Origin {
  const countries = new Set<string>();
  for (const c of input.production_countries || []) {
    if (typeof c === 'string') countries.add(c.toUpperCase());
    else if (c?.iso_3166_1) countries.add(c.iso_3166_1.toUpperCase());
  }
  for (const c of input.origin_country || []) countries.add(String(c).toUpperCase());

  if (countries.has('TR')) return 'yerli';
  if ((input.original_language || '').toLowerCase() === 'tr') return 'yerli';
  if (countries.size > 0 || input.original_language) return 'yabanci';
  return 'bilinmiyor';
}
