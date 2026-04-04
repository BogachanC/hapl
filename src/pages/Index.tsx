import { useState, useMemo, useRef, useCallback } from 'react';
import haplLogo from '@/assets/hapl-logo.png';
import { useContents, usePlatforms, PAGE_SIZE, MAX_ITEMS } from '@/hooks/use-contents';
import { useContentSearch } from '@/hooks/useContentSearch';
import { SearchBar } from '@/components/SearchBar';
import { SearchResults } from '@/components/SearchResults';
import { PlatformFilter } from '@/components/PlatformFilter';
import { ContentCard } from '@/components/ContentCard';
import { TypeFilter } from '@/components/TypeFilter';
import { AdvancedFilter } from '@/components/AdvancedFilter';
import { Tv, Loader2, Plus, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const [search, setSearch] = useState('');
  const { results: searchResults, loading: searchLoading, hasSearched, search: doSearch, clear: clearSearch } = useContentSearch();
  const [selectedPlatform, setSelectedPlatform] = useState<string | undefined>();
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: platforms, isLoading: platformsLoading } = usePlatforms();
  const { data: allContents, isLoading: contentsLoading } = useContents({
    search: search || undefined,
    platformId: selectedPlatform,
    contentType: selectedType,
    origin: selectedOrigin,
    status: selectedStatus,
    genres: selectedGenres.length > 0 ? selectedGenres : undefined,
    limit: MAX_ITEMS,
  });

  const isLoading = platformsLoading || contentsLoading;
  const visibleContents = useMemo(() => (allContents ?? []).slice(0, visibleCount), [allContents, visibleCount]);
  const hasMore = allContents ? visibleCount < allContents.length : false;

  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current) observerRef.current.disconnect();
    if (!node || !hasMore) return;
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) {
        setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, MAX_ITEMS));
      }
    });
    observerRef.current.observe(node);
  }, [hasMore]);

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
          onSearch={doSearch}
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
            <AdvancedFilter
              selectedGenres={selectedGenres}
              onGenresChange={setSelectedGenres}
              selectedOrigin={selectedOrigin}
              onOriginChange={setSelectedOrigin}
              selectedStatus={selectedStatus}
              onStatusChange={setSelectedStatus}
            />

            {isLoading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : visibleContents.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-2.5 pb-4">
                  {visibleContents.map((content, i) => (
                    <ContentCard key={content.id} content={content} index={i} />
                  ))}
                </div>
                {hasMore && (
                  <div ref={loadMoreRef} className="flex items-center justify-center py-4">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20 space-y-2">
                <Tv className="h-10 w-10 text-muted-foreground/30 mx-auto" />
                <p className="text-sm text-muted-foreground">İçerik bulunamadı</p>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};

export default Index;

