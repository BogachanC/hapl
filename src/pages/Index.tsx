import { useState, useMemo } from 'react';
import haplLogo from '@/assets/hapl-logo.png';
import { usePlatforms } from '@/hooks/use-contents';
import { useContentSearch } from '@/hooks/useContentSearch';
import { useHomeFeed, type FeedCategory } from '@/hooks/useHomeFeed';
import { SearchBar } from '@/components/SearchBar';
import { SearchResults } from '@/components/SearchResults';
import { PlatformFilter } from '@/components/PlatformFilter';
import { TypeFilter } from '@/components/TypeFilter';
import { Tv, Loader2, Plus, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

// Map legacy TypeFilter values → home-feed category
function typeToCategory(t: string | undefined): FeedCategory {
  if (!t) return 'all';
  if (t === 'dizi') return 'tv';
  if (t === 'film') return 'movie';
  if (t === 'belgesel') return 'documentary';
  return 'all';
}

const Index = () => {
  const { results: searchResults, loading: searchLoading, hasSearched, query: search, setQuery: setSearch, clear: clearSearch } = useContentSearch();
  const [selectedPlatform, setSelectedPlatform] = useState<string | undefined>();
  const [selectedType, setSelectedType] = useState<string | undefined>();

  const { data: platforms, isLoading: platformsLoading } = usePlatforms();

  // Map selectedPlatform (platforms.id UUID) → streaming_providers.slug.
  // The legacy `platforms` table uses slightly different slugs than
  // `streaming_providers` for a few brands; bridge them so the home feed
  // filter actually matches.
  const PLATFORM_TO_PROVIDER_SLUG: Record<string, string> = {
    "prime-video": "amazon-prime-video",
    "hbo-max": "max",
    "tod": "tod-tv",
  };
  const providerSlug = useMemo(() => {
    if (!selectedPlatform || !platforms) return null;
    const p = platforms.find((x) => x.id === selectedPlatform);
    if (!p?.slug) return null;
    return PLATFORM_TO_PROVIDER_SLUG[p.slug] ?? p.slug;
  }, [selectedPlatform, platforms]);

  const category = typeToCategory(selectedType);

  const { results: feedResults, loading: feedLoading } = useHomeFeed({
    category,
    provider: providerSlug,
    enabled: !hasSearched,
    limit: 36,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/30 overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-background via-card to-background" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-transparent" />
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-16 bg-primary/10 blur-3xl rounded-full" />

        <div className="container max-w-lg mx-auto px-4 py-3 relative">
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="relative shrink-0">
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full scale-150" />
              <img
                src={haplLogo}
                alt="Hapl - Hangi Platform"
                className="h-20 w-auto object-contain relative z-10 drop-shadow-[0_0_15px_hsl(var(--primary)/0.4)]"
              />
            </div>

            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-[11px] font-extrabold tracking-[0.25em] uppercase font-heading bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                İçeriğin Adresi
              </span>
              <span className="text-[9px] text-muted-foreground/60 font-medium tracking-wider">
                Hangi platformda ne var?
              </span>
            </div>

            <Link
              to="/admin"
              className="ml-auto h-9 w-9 rounded-xl bg-secondary/80 hover:bg-primary/20 border border-border/30 hover:border-primary/40 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
            </Link>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        <SearchBar
          value={search}
          onChange={(v) => {
            setSearch(v);
            if (!v) clearSearch();
          }}
          loading={searchLoading}
        />
        {hasSearched ? (
          <>
            <button
              onClick={() => { setSearch(''); clearSearch(); }}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Keşfete dön
            </button>
            {searchLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : searchResults.length > 0 ? (
              <SearchResults results={searchResults} />
            ) : (
              <div className="text-center py-20 space-y-2">
                <Tv className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">Sonuç bulunamadı</p>
              </div>
            )}
          </>
        ) : (
          <>
            <TypeFilter selected={selectedType} onSelect={setSelectedType} />
            {platforms && <PlatformFilter platforms={platforms} selected={selectedPlatform} onSelect={setSelectedPlatform} />}

            {(platformsLoading || feedLoading) ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : feedResults.length > 0 ? (
              <SearchResults results={feedResults} />
            ) : (
              <div className="text-center py-20 space-y-2">
                <Tv className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">Henüz içerik yok. Yönetici panelinden katalog keşfini başlatabilirsin.</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Index;
