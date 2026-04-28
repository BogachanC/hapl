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

/** Extract provider mentions from free-form text (Firecrawl fallback). */
export function extractProvidersFromText(
  text: string,
  providers: ProviderRow[],
): ProviderRow[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const found = new Map<string, ProviderRow>();
  for (const p of providers) {
    if (!p.firecrawl_enabled) continue; // respect DB flag
    // Try display_name + each tmdb alias + each domain
    const needles = [
      p.display_name,
      ...p.tmdb_names,
      ...p.domains,
    ].map((s) => s.toLowerCase()).filter(Boolean);
    for (const n of needles) {
      if (n.length >= 3 && t.includes(n)) {
        found.set(p.slug, p);
        break;
      }
    }
  }
  return Array.from(found.values());
}
