import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TMDB_BASE = "https://api.themoviedb.org/3";

// Known content for each platform (manually curated + will be extended by search)
const KNOWN_CONTENT: Record<string, string[]> = {
  "hbo-max": [
    "Yeşilçam", "Maviye Sürgün", "Alef", "Behzat Ç.", "Bozkır", "Çukur", 
    "Masum", "Şahsiyet", "Yarım Kalan Aşklar", "7faces", "Akıncı", "Aşk 101",
    "Bir Başkadır", "Kördüğüm", "Yüzleşme", "Merhaba Güzel Vatanım", "Dudullu Postası",
    "Aşk Ağlatır", "Darmaduman", "Elkızı", "Gönül Dağı", "Mahkum", "Kırmızı Oda",
    "Üç Kuruş", "Camdaki Kız", "Aldatmak", "Evlilik Hakkında Her Şey", "Kasaba Doktoru",
    "Ömer", "Yargı", "Teşkilat", "Barbaroslar", "Kuruluş Osman",
    "İstanbullu Gelin", "Vatanım Sensin", "Hercai", "Diriliş Ertuğrul",
    "Eşkıya Dünyaya Hükümdar Olmaz", "Sefirin Kızı", "Kıbrıs Zafere Doğru",
  ],
  exxen: [
    "Şahmaran", "Kuş Uçuşu", "Olağanüstü", "Acans", "Gibi", "Dünya ile Benim Aramda",
    "Kıskanmak", "Küçük Hesaplar", "Yaratılan", "Öğretmen", "Leyla Everlasting",
    "Değer misin?", "Arıza", "Gülcemal", "Kader Bağları", "Bülbül",
    "Ramo", "Son Yaz", "Tuzak", "Tozluyaka", "Yalancılar ve Mumları",
    "Ah Nerede", "Benden Söylemesi", "Bez Bebek", "4N1K İlk Aşk",
  ],
  gain: [
    "Limon Ağacı", "Eve Dönüş", "Ezel", "Bir Annenin Günahı", "Bihter",
    "Kulüp", "Yavaş Yavaş", "Gaddar", "Aile", "Rüzgarlı Tepe",
    "Hakim", "Kırmızı Kamyon", "Aşk Mantık İntikam", "Sadece Arkadaşız",
    "Bahar", "Kirli Sepeti", "Seni Çok Bekledim", "Terzi", "Aziz",
    "Kan Çiçekleri", "Adım Farah", "Zemheri", "Yasak Elma",
  ],
  puhutv: [
    "Fi", "Çi", "Pi", "Sahipli", "Dip", "Bir Deli Sevda", "Şeref Meselesi",
    "Arıza", "Yeşil Vadi", "Kayıp", "Kaçış", "Persona", "Nefes Nefese",
    "Jet Sosyete", "Benim Adım Melek", "Aşk Yeniden", "Acil Aşk Aranıyor",
    "Fatih Harbiye", "Poyraz Karayel", "İçerde", "Anne", "Kara Sevda",
    "Medcezir", "Kış Güneşi", "Adını Feriha Koydum",
  ],
  tabii: [
    "Kendi Düşen Ağlamaz", "Kardeşlerim", "Gönül Dağı", "Masumlar Apartmanı",
    "Alparslan Büyük Selçuklu", "Uyanış Büyük Selçuklu", "Payitaht Abdülhamid",
    "Mehmed Fetihler Sultanı", "Barbaroslar Akdeniz'in Kılıcı", "Tozkoparan İskender",
    "Kurtlar Vadisi", "Arka Sokaklar", "Zengin ve Yoksul", "Yemin",
    "Esaret", "Emanet", "Vuslat", "Aziz", "Ya İstiklal Ya Ölüm",
    "Destan", "Bozkır Arslanı Celaleddin", "Atatürk",
  ],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const TMDB_API_KEY = Deno.env.get("TMDB_API_TOKEN");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!TMDB_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Missing env vars" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let params: any = {};
  try { params = await req.json(); } catch { /* defaults */ }

  const targetPlatform = params.platform || "all";

  try {
    const { data: platforms } = await sb.from("platforms").select("id, slug, name");
    const platformBySlug = new Map(platforms?.map((p) => [p.slug, p]) || []);

    // Get all existing titles
    const { data: existing } = await sb.from("contents").select("title");
    const existingTitles = new Set(existing?.map((e) => e.title.toLowerCase()) || []);

    const targetSlugs = targetPlatform === "all"
      ? Object.keys(KNOWN_CONTENT)
      : [targetPlatform];

    let totalInserted = 0;
    let totalSkipped = 0;
    const platformStats: Record<string, number> = {};

    for (const slug of targetSlugs) {
      const titles = KNOWN_CONTENT[slug];
      if (!titles) continue;

      const dbPlatform = platformBySlug.get(slug);
      if (!dbPlatform) {
        console.log(`[scrape] Platform ${slug} not in DB`);
        continue;
      }

      console.log(`[scrape] Processing ${dbPlatform.name}: ${titles.length} titles`);
      let inserted = 0;

      for (const title of titles) {
        if (existingTitles.has(title.toLowerCase())) {
          totalSkipped++;
          continue;
        }

        // Search TMDB
        let tmdbResult: any = null;
        try {
          // TV first (most Turkish content is series)
          const tvRes = await fetch(
            `${TMDB_BASE}/search/tv?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`
          );
          const tvData = await tvRes.json();
          if (tvData.results?.length) {
            tmdbResult = { ...tvData.results[0], mediaType: "tv" };
          }

          if (!tmdbResult) {
            const movieRes = await fetch(
              `${TMDB_BASE}/search/movie?api_key=${TMDB_API_KEY}&query=${encodeURIComponent(title)}&language=tr-TR`
            );
            const movieData = await movieRes.json();
            if (movieData.results?.length) {
              tmdbResult = { ...movieData.results[0], mediaType: "movie" };
            }
          }
        } catch { /* skip */ }

        if (!tmdbResult) {
          console.log(`[scrape] TMDB not found: ${title}`);
          totalSkipped++;
          continue;
        }

        const tmdbTitle = tmdbResult.title || tmdbResult.name;
        if (existingTitles.has(tmdbTitle.toLowerCase())) {
          totalSkipped++;
          continue;
        }

        // Get details
        try {
          const detailRes = await fetch(
            `${TMDB_BASE}/${tmdbResult.mediaType}/${tmdbResult.id}?api_key=${TMDB_API_KEY}&language=tr-TR`
          );
          const detail = await detailRes.json();

          const genres = (detail.genres || []).map((g: any) => g.name);
          const overview = detail.overview || tmdbResult.overview || null;
          const releaseDate = detail.release_date || detail.first_air_date;
          const releaseYear = releaseDate ? new Date(releaseDate).getFullYear() : null;
          let endYear: number | null = null;
          if (tmdbResult.mediaType === "tv" && detail.status === "Ended" && detail.last_air_date) {
            endYear = new Date(detail.last_air_date).getFullYear();
          }

          const originCountries = detail.origin_country || detail.production_countries?.map((c: any) => c.iso_3166_1) || [];
          const origin: "yerli" | "yabanci" = originCountries.includes("TR") ? "yerli" : "yabanci";

          const genreIds = (detail.genres || []).map((g: any) => g.id);
          let contentType: "dizi" | "film" | "belgesel" = tmdbResult.mediaType === "tv" ? "dizi" : "film";
          if (genreIds.includes(99)) contentType = "belgesel";

          const posterUrl = tmdbResult.poster_path
            ? `https://image.tmdb.org/t/p/w500${tmdbResult.poster_path}`
            : null;

          let status: "yayinda" | "yakinda" | "bitti" = "yayinda";
          if (tmdbResult.mediaType === "tv" && endYear) status = "bitti";

          existingTitles.add(tmdbTitle.toLowerCase());

          const { error: insertError } = await sb
            .from("contents")
            .insert({
              title: tmdbTitle,
              description: overview,
              poster_url: posterUrl,
              content_type: contentType,
              status,
              origin,
              genre: genres,
              release_year: releaseYear,
              end_year: endYear,
              platform_id: dbPlatform.id,
            });

          if (insertError) {
            console.error(`[scrape] Insert error "${tmdbTitle}":`, insertError.message);
            totalSkipped++;
          } else {
            inserted++;
            totalInserted++;
          }
        } catch {
          totalSkipped++;
        }

        await new Promise(r => setTimeout(r, 80));
      }

      platformStats[dbPlatform.name] = inserted;
    }

    return new Response(
      JSON.stringify({
        success: true,
        inserted: totalInserted,
        skipped: totalSkipped,
        platformStats,
        message: `${totalInserted} içerik eklendi, ${totalSkipped} atlandı.`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[scrape] Error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
