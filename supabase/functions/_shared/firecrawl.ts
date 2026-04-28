// Firecrawl helper — used as TMDB fallback only.
// Activated when TMDB returns 0 providers AND we have a strong title match.

const FC_BASE = "https://api.firecrawl.dev/v2";

function getKey(): string | null {
  return Deno.env.get("FIRECRAWL_API_KEY") || null;
}

/**
 * Search the web for "<title> Türkiye hangi platformda" and return
 * concatenated text from the top results.
 */
export async function firecrawlSearchText(title: string, year: number | null): Promise<string> {
  const key = getKey();
  if (!key) return "";
  const yearPart = year ? ` ${year}` : "";
  const query = `"${title}"${yearPart} Türkiye hangi platformda izle stream`;
  try {
    const res = await fetch(`${FC_BASE}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        query,
        limit: 3,
        lang: "tr",
        country: "tr",
      }),
    });
    if (!res.ok) {
      console.error("Firecrawl search failed", res.status);
      return "";
    }
    const data = await res.json();
    const results = data.data?.web || data.data || [];
    let combined = "";
    for (const r of results) {
      combined += " " + (r.title || "") + " " + (r.description || "") + " " + (r.markdown || "");
    }
    return combined;
  } catch (err) {
    console.error("Firecrawl error:", err);
    return "";
  }
}
