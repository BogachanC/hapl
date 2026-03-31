import { useState, useMemo } from 'react';
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
  const { data: contents, isLoading: contentsLoading } = useContents({
    search: search || undefined,
    platformId: selectedPlatform,
    contentType: selectedType,
    origin: selectedOrigin,
    status: selectedStatus,
    genres: selectedGenres.length > 0 ? selectedGenres : undefined,
  });

  const isLoading = platformsLoading || contentsLoading;

  const stats = useMemo(() => {
    if (!contents) return { total: 0, dizi: 0, film: 0, belgesel: 0 };
    return {
      total: contents.length,
      dizi: contents.filter((c) => c.content_type === 'dizi').length,
      film: contents.filter((c) => c.content_type === 'film').length,
      belgesel: contents.filter((c) => c.content_type === 'belgesel').length,
    };
  }, [contents]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center gap-3 mb-1">
            <img src={haplLogo} alt="Hapl - Hangi Platform" className="h-28 w-auto object-contain" />
            <div className="flex flex-col">
              <span className="text-base font-semibold text-muted-foreground tracking-widest uppercase" style={{ fontFamily: "'Playfair Display', serif" }}>İçeriğin Adresi</span>
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
        ) : contents && contents.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 pb-8">
            {contents.map((content, i) => (
              <ContentCard key={content.id} content={content} index={i} />
            ))}
          </div>
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
