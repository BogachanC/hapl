import { ContentResult } from '@/hooks/useContentSearch';
import { Film, Tv, Star, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

interface SearchResultsProps {
  results: ContentResult[];
}

export function SearchResults({ results }: SearchResultsProps) {
  return (
    <div className="space-y-3 animate-fade-in">
      <p className="text-xs text-muted-foreground font-medium">
        {results.length} sonuç bulundu
      </p>
      {results.map((item) => (
        <SearchResultCard key={`${item.type}-${item.id}`} item={item} />
      ))}
    </div>
  );
}

function SearchResultCard({ item }: { item: ContentResult }) {
  const [imgError, setImgError] = useState(false);

  return (
    <div className="bg-card rounded-xl border border-border/30 overflow-hidden flex gap-3 p-3 hover:border-primary/40 transition-all duration-200">
      {/* Poster */}
      <div className="w-20 shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-secondary flex items-center justify-center">
        {item.poster && !imgError ? (
          <img
            src={item.poster}
            alt={item.title}
            className="w-full h-full object-cover"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : item.type === 'tv' ? (
          <Tv className="h-6 w-6 text-muted-foreground/30" />
        ) : (
          <Film className="h-6 w-6 text-muted-foreground/30" />
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading font-bold text-sm text-foreground leading-tight line-clamp-2">
            {item.title}
          </h3>
          {item.imdb_rating && (
            <span className="shrink-0 flex items-center gap-0.5 text-xs font-semibold text-yellow-400">
              <Star className="h-3 w-3 fill-yellow-400" />
              {item.imdb_rating}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="uppercase font-semibold tracking-wider px-1.5 py-0.5 bg-secondary rounded">
            {item.type === 'tv' ? 'Dizi' : 'Film'}
          </span>
          {item.year && <span>{item.year}</span>}
          {item.genres.length > 0 && (
            <span className="truncate">{item.genres.slice(0, 2).join(', ')}</span>
          )}
        </div>

        {item.overview && (
          <p className="text-[11px] text-muted-foreground/80 line-clamp-2 leading-relaxed">
            {item.overview}
          </p>
        )}

        {/* Platforms */}
        {item.platforms.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {item.platforms.map((p, i) => (
              <a
                key={i}
                href={p.link || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(
                  'flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide',
                  p.type === 'subscription'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-accent/15 text-accent'
                )}
              >
                {p.logo && (
                  <img src={p.logo} alt={p.name} className="h-3.5 w-3.5 rounded-sm object-cover" />
                )}
                {p.name}
                <ExternalLink className="h-2.5 w-2.5 opacity-50" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-muted-foreground/50 italic pt-1">
            Türkiye'de platform bilgisi bulunamadı
          </p>
        )}
      </div>
    </div>
  );
}
