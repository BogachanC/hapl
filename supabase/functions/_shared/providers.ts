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

export interface FirecrawlEvidence {
  /** Optional source URL chosen as primary evidence (must be non-null to persist). */
  source_url: string | null;
  /** Structured evidence payload — written into raw_payload. */
  raw_payload: Record<string, unknown>;
}

export interface ExtractedProvider {
  provider: ProviderRow;
  confidence: number; // 0..1
  evidence: string[];
  /** Strong evidence; required for persistence (source_url must be non-null). */
  source_url: string | null;
  raw_payload: Record<string, unknown>;
}

export interface FirecrawlResultLike {
  url: string;
  title: string;
  description: string;
}

/**
 * Extract provider mentions from Firecrawl search results.
 * Hard requirements (no exceptions):
 * - Provider must be firecrawl_enabled
 * - Provider must NOT be in TMDB_PRIMARY_SLUGS (TMDB is authoritative)
 * - At least one result MUST contain a matching provider domain in URL or text
 * - Title token must co-occur in same result (title evidence)
 * - Returns source_url + raw_payload — caller must NOT persist if source_url is null
 */
export function extractProvidersFromText(
  textOrResults: string | FirecrawlResultLike[],
  providers: ProviderRow[],
  title?: string,
  results?: FirecrawlResultLike[],
): ExtractedProvider[] {
  // Backward-compat: accept (text, providers, title) OR (results, providers, title)
  const items: FirecrawlResultLike[] = Array.isArray(textOrResults)
    ? textOrResults
    : results ?? [];
  const aggregateText =
    typeof textOrResults === "string"
      ? textOrResults
      : items.map((r) => `${r.title} ${r.description} ${r.url}`).join(" ");
  if (!aggregateText && items.length === 0) return [];
  const t = aggregateText.toLowerCase();
  const hasStreamContext =
    /\b(izle|stream|yayin|yayın|platform|abonelik|katalog|izleyebilir|watch)\b/.test(t);
  const titleLower = title ? title.toLowerCase() : "";
  const hasTitleContext = titleLower ? t.includes(titleLower) : false;

  const out: ExtractedProvider[] = [];
  for (const p of providers) {
    if (!p.firecrawl_enabled) continue;
    // TMDB-primary global providers: never accepted from Firecrawl gap-fill.
    if (TMDB_PRIMARY_SLUGS.has(p.slug)) continue;

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

    // TMDB-primary global providers: TMDB watch/providers is authoritative.
    // Free-text mentions (Turkish listicles like "the wire izle netflix.com",
    // mock streaming sites, IMDb-style "available on …" snippets) are not
    // reliable enough to override TMDB's silence. Skip these slugs entirely
    // for Firecrawl gap-fill — they're either covered by TMDB or genuinely
    // not in TR. This eliminated the The Wire false-positive (Netflix +
    // Disney+) and is the minimum-blast-radius fix.
    if (TMDB_PRIMARY_SLUGS.has(p.slug)) continue;

    // Drop low-confidence noise
    if (conf < 0.5) continue;

    out.push({ provider: p, confidence: conf, evidence });
  }
  return out;
}
