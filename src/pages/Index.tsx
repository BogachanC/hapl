import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import haplLogo from '@/assets/hapl-logo.png';
import { useContents, usePlatforms } from '@/hooks/use-contents';
import { SearchBar } from '@/components/SearchBar';
import { PlatformFilter } from '@/components/PlatformFilter';
import { ContentCard } from '@/components/ContentCard';
import { TypeFilter } from '@/components/TypeFilter';
import { AdvancedFilter } from '@/components/AdvancedFilter';
import { Tv, Loader2, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';

const Index = () => {
  const [search, setSearch] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState<string | undefined>();
  const [selectedType, setSelectedType] = useState<string | undefined>();
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedOrigin, setSelectedOrigin] = useState<string | undefined>();
  const [selectedStatus, setSelectedStatus] = useState<string | undefined>();

  const { data: platforms, isLoading: platformsLoading } = usePlatforms();
  const { data: contentsData, isLoading: contentsLoading, fetchNextPage, hasNextPage, isFetchingNextPage } = useContents({
    search: search || undefined,
    platformId: selectedPlatform,
    contentType: selectedType,
    origin: selectedOrigin,
    status: selectedStatus,
    genres: selectedGenres.length > 0 ? selectedGenres : undefined,
  });

  const allContents = useMemo(() => contentsData?.pages.flat() ?? [], [contentsData]);
  const isLoading = platformsLoading || contentsLoading;

  // Infinite scroll observer
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useCallback((node: HTMLDivElement | null) => {
    if (isFetchingNextPage) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && hasNextPage) {
        fetchNextPage();
      }
    });
    if (node) observerRef.current.observe(node);
  }, [isFetchingNextPage, hasNextPage, fetchNextPage]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-1">
            <img src={haplLogo} alt="Hapl - Hangi Platform" className="h-28 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="text-sm font-extrabold text-muted-foreground tracking-widest uppercase font-heading">İçeriğin Adresi</span>
            </div>
            <Link to="/admin" className="ml-auto">
              <div className="h-8 w-8 rounded-lg bg-secondary hover:bg-secondary/80 flex items-center justify-center transition-colors">
                <Plus className="h-4 w-4 text-secondary-foreground" />
              </div>
            </Link>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Search */}
        <SearchBar value={search} onChange={setSearch} />

        {/* Type Filter */}
        <TypeFilter selected={selectedType} onSelect={setSelectedType} />

        {/* Platform Filter */}
        {platforms && <PlatformFilter platforms={platforms} selected={selectedPlatform} onSelect={setSelectedPlatform} />}

        {/* Advanced Filters */}
        <AdvancedFilter
          selectedGenres={selectedGenres}
          onGenresChange={setSelectedGenres}
          selectedOrigin={selectedOrigin}
          onOriginChange={setSelectedOrigin}
          selectedStatus={selectedStatus}
          onStatusChange={setSelectedStatus}
        />

        {/* Content Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : allContents.length > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2.5 pb-4">
              {allContents.map((content, i) => (
                <ContentCard key={content.id} content={content} index={i} />
              ))}
            </div>
            {/* Infinite scroll trigger */}
            <div ref={loadMoreRef} className="flex items-center justify-center py-4">
              {isFetchingNextPage && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            </div>
          </>
        ) : (
          <div className="text-center py-20 space-y-2">
            <Tv className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">İçerik bulunamadı</p>
          </div>
        )}
      </main>
    </div>
  );
};

export default Index;
