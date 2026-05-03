// Firecrawl helper — used as TMDB fallback only.
// Returns both concatenated text (for keyword extraction) and structured
// results (used as evidence payload for availability rows).

const FC_BASE = "https://api.firecrawl.dev/v2";

function getKey(): string | null {
  return Deno.env.get("FIRECRAWL_API_KEY") || null;
}

export interface FirecrawlResultItem {
  url: string;
  title: string;
  description: string;
}

export interface FirecrawlSearchOutput {
  text: string;
  query: string;
  results: FirecrawlResultItem[];
}

export async function firecrawlSearchText(
  title: string,
  year: number | null,
): Promise<FirecrawlSearchOutput> {
  const key = getKey();
  const empty: FirecrawlSearchOutput = { text: "", query: "", results: [] };
  if (!key) return empty;
  const yearPart = year ? ` ${year}` : "";
  const query = `"${title}"${yearPart} Türkiye hangi platformda izle stream`;
  try {
    const res = await fetch(`${FC_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query, limit: 3, lang: "tr", country: "tr" }),
    });
    if (!res.ok) {
      console.error("Firecrawl search failed", res.status);
      return { ...empty, query };
    }
    const data = await res.json();
    const raw = data.data?.web || data.data || [];
    const results: FirecrawlResultItem[] = raw.map((r: any) => ({
      url: r.url || r.link || "",
      title: r.title || "",
      description: r.description || r.markdown || "",
    }));
    let combined = "";
    for (const r of results) {
      combined += " " + r.title + " " + r.description + " " + r.url;
    }
    return { text: combined, query, results };
  } catch (err) {
    console.error("Firecrawl error:", err);
    return { ...empty, query };
  }
}
