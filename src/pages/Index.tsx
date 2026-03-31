import { useState, useMemo, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import haplLogo from '@/assets/hapl-logo.png';
import { useContents, usePlatforms, PAGE_SIZE, MAX_ITEMS } from '@/hooks/use-contents';
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

  // Infinite scroll observer
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
      {/* Premium Header */}
      <header className="sticky top-0 z-50 border-b border-border/30 overflow-hidden">
        {/* Gradient background */}
        <div className="absolute inset-0 bg-gradient-to-r from-background via-card to-background" />
        <div className="absolute inset-0 bg-gradient-to-b from-primary/8 via-transparent to-transparent" />
        {/* Subtle glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-16 bg-primary/10 blur-3xl rounded-full" />
        
        <div className="container max-w-lg mx-auto px-4 py-3 relative">
          <div className="flex items-center gap-3">
            {/* Logo with glow effect */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="relative"
            >
              <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full scale-150" />
              <img src={haplLogo} alt="Hapl - Hangi Platform" className="h-20 w-auto object-contain relative z-10 drop-shadow-[0_0_15px_hsl(var(--primary)/0.4)]" />
            </motion.div>

            {/* Slogan with animation */}
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="flex flex-col gap-0.5"
            >
              <span className="text-[11px] font-extrabold tracking-[0.25em] uppercase font-heading bg-gradient-to-r from-primary via-accent to-primary bg-clip-text text-transparent">
                İçeriğin Adresi
              </span>
              <span className="text-[9px] text-muted-foreground/60 font-medium tracking-wider">
                Hangi platformda ne var?
              </span>
            </motion.div>

            <Link to="/admin" className="ml-auto">
              <motion.div
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                className="h-9 w-9 rounded-xl bg-secondary/80 hover:bg-primary/20 border border-border/30 hover:border-primary/40 flex items-center justify-center transition-colors"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
              </motion.div>
            </Link>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        <SearchBar value={search} onChange={setSearch} />
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
      </main>
    </div>
  );
};

export default Index;
