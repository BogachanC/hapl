import { ContentResult } from '@/hooks/useContentSearch';
import { Film, Tv, Calendar, Star } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

// Map edge function platform names to slug-based styling
const PLATFORM_SLUG_MAP: Record<string, string> = {
  'Netflix': 'netflix',
  'Disney+': 'disney-plus',
  'Amazon Prime': 'prime-video',
  'BluTV': 'blutv',
  'Gain': 'gain',
  'Mubi': 'mubi',
  'YouTube Premium': 'youtube-premium',
  'Apple TV+': 'apple-tv',
  'HBO Max': 'hbo-max',
  'Exxen': 'exxen',
  'Puhu TV': 'puhutv',
  'TOD': 'tod',
  'Tabii': 'tabii',
};

const PLATFORM_STYLES: Record<string, { bg: string; text: string }> = {
  'netflix': { bg: 'bg-platform-netflix', text: 'text-white' },
  'exxen': { bg: 'bg-platform-exxen', text: 'text-black' },
  'gain': { bg: 'bg-platform-gain', text: 'text-black' },
  'disney-plus': { bg: 'bg-platform-disney', text: 'text-white' },
  'prime-video': { bg: 'bg-platform-prime', text: 'text-white' },
  'tod': { bg: 'bg-platform-tod', text: 'text-yellow-400' },
  'tabii': { bg: 'bg-platform-tabii', text: 'text-green-400' },
  'mubi': { bg: 'bg-platform-mubi', text: 'text-white' },
  'hbo-max': { bg: 'bg-platform-hbo', text: 'text-black' },
  'puhutv': { bg: 'bg-platform-puhutv', text: 'text-black' },
  'apple-tv': { bg: 'bg-secondary', text: 'text-foreground' },
  'youtube-premium': { bg: 'bg-red-600/80', text: 'text-white' },
  'blutv': { bg: 'bg-blue-700/80', text: 'text-white' },
};

function getPlatformStyle(name: string) {
  const slug = PLATFORM_SLUG_MAP[name] || name.toLowerCase().replace(/\s+/g, '-');
  return PLATFORM_STYLES[slug] || { bg: 'bg-primary', text: 'text-primary-foreground' };
}

interface SearchResultsProps {
  results: ContentResult[];
}

export function SearchResults({ results }: SearchResultsProps) {
  // Filter: only show content available in Turkey
  const filtered = results.filter((item) => item.available_in_tr && item.platforms.length > 0);

  if (filtered.length === 0) {
    return (
      <div className="text-center py-20 space-y-2">
        <Tv className="h-10 w-10 text-muted-foreground/30 mx-auto" />
        <p className="text-sm text-muted-foreground">Türkiye'de yayınlanan sonuç bulunamadı</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 animate-fade-in">
      <p className="text-xs text-muted-foreground font-medium">
        {filtered.length} sonuç bulundu
      </p>
      <div className="grid grid-cols-3 gap-2.5 pb-4">
        {filtered.map((item, i) => (
          <SearchResultCard key={`${item.type}-${item.id}`} item={item} index={i} />
        ))}
      </div>
    </div>
  );
}

function SearchResultCard({ item, index }: { item: ContentResult; index: number }) {
  const [imgError, setImgError] = useState(false);

  const typeLabel = item.type === 'tv' ? 'Dizi' : 'Film';

  return (
    <a
      href={item.tmdb_url}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-card rounded-xl overflow-hidden border border-border/30 hover:border-primary/40 hover:shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.25)] transition-all duration-300 animate-fade-in group block"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-gradient-to-br from-secondary to-muted flex items-center justify-center overflow-hidden">
        {item.poster && !imgError ? (
          <img
            src={item.poster}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-[1.08] transition-transform duration-700 ease-out"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : item.type === 'tv' ? (
          <Tv className="h-8 w-8 text-muted-foreground/30" />
        ) : (
          <Film className="h-8 w-8 text-muted-foreground/30" />
        )}

        {/* IMDb rating badge */}
        {item.imdb_rating && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-black/70 backdrop-blur-sm px-1.5 py-0.5 rounded-md">
            <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
            <span className="text-[9px] font-bold text-yellow-400">{item.imdb_rating}</span>
          </div>
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      <div className="p-2 space-y-1.5">
        {/* Platforms */}
        <div className="flex flex-wrap gap-1">
          {item.platforms.map((p, i) => {
            const style = getPlatformStyle(p.name);
            return (
              <div
                key={i}
                className={cn(
                  'shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wide uppercase',
                  style.bg, style.text
                )}
              >
                {p.name}
              </div>
            );
          })}
        </div>

        <h3 className="font-heading font-bold text-xs text-foreground truncate leading-tight">{item.title}</h3>

        {/* Type + Year row */}
        <div className="flex items-center justify-between gap-1">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-muted-foreground/20 text-muted-foreground">
            {typeLabel}
          </span>
          {item.year && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 font-medium">
              <Calendar className="h-2.5 w-2.5" />
              {item.year}
            </span>
          )}
        </div>
      </div>
    </a>
  );
}
