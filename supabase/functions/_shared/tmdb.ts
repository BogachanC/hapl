// TMDB API helpers — multi search + detail + TR watch providers.

const TMDB_BASE = "https://api.themoviedb.org/3";

function getKey(): string {
  const k = Deno.env.get("TMDB_API_TOKEN");
  if (!k) throw new Error("TMDB_API_TOKEN not configured");
  return k;
}

export interface TmdbDetail {
  id: number;
  type: "movie" | "tv";
  title: string;
  original_title: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  vote_average: number;
  vote_count: number;
  genres: { id: number; name: string }[];
}

export interface TmdbWatchProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string | null;
  display_priority?: number;
}

export interface TmdbWatchProvidersTR {
  link: string | null;
  flatrate: TmdbWatchProvider[];
  rent: TmdbWatchProvider[];
  buy: TmdbWatchProvider[];
  free: TmdbWatchProvider[];
  ads: TmdbWatchProvider[];
}

export async function tmdbMultiSearch(
  query: string,
  language: string = "tr-TR",
): Promise<any[]> {
  const url = `${TMDB_BASE}/search/multi?api_key=${getKey()}&query=${encodeURIComponent(query)}&language=${encodeURIComponent(language)}&region=TR&include_adult=false`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error("TMDB multi search failed", res.status);
    return [];
  }
  const data = await res.json();
  return data.results || [];
}

export async function tmdbDetail(type: "movie" | "tv", id: number): Promise<TmdbDetail | null> {
  const url = `${TMDB_BASE}/${type}/${id}?api_key=${getKey()}&language=tr-TR`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const d = await res.json();
  return {
    id: d.id,
    type,
    title: d.title || d.name || "",
    original_title: d.original_title || d.original_name || "",
    overview: d.overview || "",
    poster_path: d.poster_path,
    backdrop_path: d.backdrop_path,
    release_date: d.release_date || d.first_air_date || null,
    vote_average: d.vote_average ?? 0,
    vote_count: d.vote_count ?? 0,
    genres: d.genres || [],
  };
}

export async function tmdbWatchProvidersTR(
  type: "movie" | "tv",
  id: number,
): Promise<TmdbWatchProvidersTR> {
  const url = `${TMDB_BASE}/${type}/${id}/watch/providers?api_key=${getKey()}`;
  const res = await fetch(url);
  const empty: TmdbWatchProvidersTR = {
    link: null, flatrate: [], rent: [], buy: [], free: [], ads: [],
  };
  if (!res.ok) return empty;
  const data = await res.json();
  const tr = data.results?.TR;
  if (!tr) return empty;
  return {
    link: tr.link || null,
    flatrate: tr.flatrate || [],
    rent: tr.rent || [],
    buy: tr.buy || [],
    free: tr.free || [],
    ads: tr.ads || [],
  };
}

export function tmdbImage(path: string | null, size = "w500"): string | null {
  if (!path) return null;
  return `https://image.tmdb.org/t/p/${size}${path}`;
}

// ─── Alias sources ────────────────────────────────────────────────────────
// Two TMDB endpoints contribute multilingual title aliases:
//   • /{type}/{id}/alternative_titles  → region-tagged AKAs (US, TR, etc.)
//   • /{type}/{id}/translations         → per-language localized titles
// We only consume TR + US (alt_titles) and tr-TR + en-US (translations) to
// keep noise low and stay Türkiye-focused.

export interface TmdbAliasRaw {
  alias: string;
  source: "tmdb_alt_title" | "tmdb_translation";
  language: string | null;
  country: string | null;
}

const ALLOWED_ALT_COUNTRIES = new Set(["TR", "US"]);
const ALLOWED_TRANSLATION_LANGS = new Set(["tr", "en"]);

export async function tmdbAlternativeTitles(
  type: "movie" | "tv",
  id: number,
): Promise<TmdbAliasRaw[]> {
  const url = `${TMDB_BASE}/${type}/${id}/alternative_titles?api_key=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  // movie endpoint: { titles: [...] }, tv endpoint: { results: [...] }
  const list: any[] = data.titles || data.results || [];
  const out: TmdbAliasRaw[] = [];
  for (const item of list) {
    const country: string | null = item.iso_3166_1 || null;
    if (!country || !ALLOWED_ALT_COUNTRIES.has(country)) continue;
    const title: string = (item.title || "").trim();
    if (!title) continue;
    out.push({
      alias: title,
      source: "tmdb_alt_title",
      language: null,
      country,
    });
  }
  return out;
}

export async function tmdbTranslations(
  type: "movie" | "tv",
  id: number,
): Promise<TmdbAliasRaw[]> {
  const url = `${TMDB_BASE}/${type}/${id}/translations?api_key=${getKey()}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = await res.json();
  const list: any[] = data.translations || [];
  const out: TmdbAliasRaw[] = [];
  for (const item of list) {
    const lang: string | null = item.iso_639_1 || null;
    if (!lang || !ALLOWED_TRANSLATION_LANGS.has(lang)) continue;
    const country: string | null = item.iso_3166_1 || null;
    const dataField = item.data || {};
    const title: string = (dataField.title || dataField.name || "").trim();
    if (!title) continue;
    out.push({
      alias: title,
      source: "tmdb_translation",
      language: lang,
      country,
    });
  }
  return out;
}
