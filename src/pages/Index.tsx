import { useState, useMemo } from 'react';
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
    if (!contents) return { total: 0, dizi: 0, film: 0 };
    return {
      total: contents.length,
      dizi: contents.filter((c) => c.content_type === 'dizi').length,
      film: contents.filter((c) => c.content_type === 'film').length,
    };
  }, [contents]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
              <Tv className="h-4 w-4 text-primary-foreground" />
            </div>
            <h1 className="font-heading text-xl font-bold text-foreground tracking-tight">
              Hapl
            </h1>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
              Hangi Platform?
            </span>
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

        {/* Stats */}
        <div className="flex gap-3 text-xs text-muted-foreground">
          <span>{stats.total} içerik</span>
          <span>•</span>
          <span>{stats.dizi} dizi</span>
          <span>•</span>
          <span>{stats.film} film</span>
        </div>

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
