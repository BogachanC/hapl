// Provider mapping & matching logic backed by streaming_providers table.
// - mapTmdbProviderToSlug: TMDB provider name → our slug (uses tmdb_names)
// - extractProvidersFromText: scan text for provider mentions (Firecrawl fallback)
// - applies firecrawl_enabled flag from DB

export interface ProviderRow {
  id: string;
  slug: string;
  display_name: string;
  tmdb_names: string[];
  domains: string[];
  firecrawl_enabled: boolean;
  is_active: boolean;
}

let cache: { rows: ProviderRow[]; at: number } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function loadProviders(sb: any): Promise<ProviderRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  const { data, error } = await sb
    .from("streaming_providers")
    .select("id, slug, display_name, tmdb_names, domains, firecrawl_enabled, is_active")
    .eq("is_active", true);
  if (error) {
    console.error("loadProviders error:", error);
    return cache?.rows || [];
  }
  cache = { rows: data || [], at: Date.now() };
  return cache.rows;
}

/** Match a TMDB provider_name against streaming_providers.tmdb_names. */
export function matchTmdbProvider(
  tmdbName: string,
  providers: ProviderRow[],
): ProviderRow | null {
  const lower = tmdbName.toLowerCase().trim();
  for (const p of providers) {
    for (const alias of p.tmdb_names) {
      if (alias.toLowerCase().trim() === lower) return p;
    }
    if (p.display_name.toLowerCase() === lower) return p;
  }
  return null;
}

// Provider names that are short/ambiguous → require stronger evidence
const AMBIGUOUS_SLUGS = new Set(["max", "gain", "tv-plus", "tabii", "tod-tv"]);

// TMDB-primary global providers. TMDB watch/providers is the authoritative
// source for these — if TMDB didn't list them, a free-text Firecrawl mention
// (e.g. "watch The Wire on Netflix"-style listicle, IMDb sidebar, or stale
// global "available on …" snippet) is almost always noise. We require
// domain-level evidence AND co-occurrence with the title to accept a
// firecrawl-only signal for these slugs. This kills the false-positive
// pattern that was producing source_url=null, raw_payload={} rows
// (e.g. The Wire wrongly tagged Netflix + Disney+).
const TMDB_PRIMARY_SLUGS = new Set([
  "netflix",
  "disney-plus",
  "max",
  "amazon-prime-video",
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countWordOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  // Word boundary on both sides; case-insensitive
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegex(needle.toLowerCase())}([^a-z0-9]|$)`, "g");
  const matches = haystack.match(re);
  return matches ? matches.length : 0;
}

function countDomainOccurrences(haystack: string, domain: string): number {
  if (!domain) return 0;
  const re = new RegExp(escapeRegex(domain.toLowerCase()), "g");
  const matches = haystack.match(re);
  return matches ? matches.length : 0;
}

export interface ExtractedProvider {
  provider: ProviderRow;
  confidence: number; // 0..1
  evidence: string[];
}

/**
 * Extract provider mentions from free-form text (Firecrawl fallback).
 * Stricter than naive includes():
 * - Word-boundary match (no "max" inside "maximum")
 * - Domains weigh higher than display names
 * - Co-occurrence with TR streaming context boosts confidence
 * - Ambiguous short names (Max, GAIN) require domain OR strong context
 * - Optional `title` parameter: provider mentioned near the title is stronger
 */
export function extractProvidersFromText(
  text: string,
  providers: ProviderRow[],
  title?: string,
): ExtractedProvider[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const hasStreamContext =
    /\b(izle|stream|yayin|yayın|platform|abonelik|katalog|izleyebilir|watch)\b/.test(t);
  const hasTitleContext = title ? t.includes(title.toLowerCase()) : false;

  const out: ExtractedProvider[] = [];
  for (const p of providers) {
    if (!p.firecrawl_enabled) continue;

    const evidence: string[] = [];
    let nameHits = 0;
    let domainHits = 0;

    // Display name
    if (p.display_name && p.display_name.length >= 3) {
      const c = countWordOccurrences(t, p.display_name);
      if (c > 0) {
        nameHits += c;
        evidence.push(`name:${p.display_name}(${c})`);
      }
    }
    // TMDB aliases
    for (const alias of p.tmdb_names) {
      if (!alias || alias.length < 3) continue;
      const c = countWordOccurrences(t, alias);
      if (c > 0) {
        nameHits += c;
        evidence.push(`alias:${alias}(${c})`);
      }
    }
    // Domains (strong signal)
    for (const dom of p.domains) {
      if (!dom || dom.length < 4) continue;
      const c = countDomainOccurrences(t, dom);
      if (c > 0) {
        domainHits += c;
        evidence.push(`domain:${dom}(${c})`);
      }
    }

    if (nameHits === 0 && domainHits === 0) continue;

    // Confidence model
    let conf = 0;
    if (domainHits > 0) conf += 0.55;          // domain is best evidence
    if (nameHits >= 2) conf += 0.25;            // multiple name hits
    else if (nameHits === 1) conf += 0.15;
    if (hasStreamContext) conf += 0.15;
    if (hasTitleContext) conf += 0.15;
    conf = Math.min(1, conf);

    // Ambiguous-name guard: "Max", "GAIN" need domain OR strong context+title
    if (AMBIGUOUS_SLUGS.has(p.slug)) {
      const ok = domainHits > 0 || (hasStreamContext && hasTitleContext && nameHits >= 1);
      if (!ok) continue;
      conf = Math.max(conf, 0.55);
    }

    // TMDB-primary global providers: Firecrawl is only allowed to add them
    // when there is hard evidence — a domain hit AND co-occurrence with the
    // title in stream context. Otherwise drop (TMDB already covers them).
    if (TMDB_PRIMARY_SLUGS.has(p.slug)) {
      const hardEvidence =
        domainHits > 0 && hasStreamContext && hasTitleContext;
      if (!hardEvidence) continue;
    }

    // Drop low-confidence noise
    if (conf < 0.5) continue;

    out.push({ provider: p, confidence: conf, evidence });
  }
  return out;
}
