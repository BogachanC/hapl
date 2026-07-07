import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContentResult } from '@/hooks/useContentSearch';
import { Film, Tv, Calendar, Star, ExternalLink, X, Bookmark, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getPlatformStyle } from '@/lib/platform-colors';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Legacy fallback: search-content sometimes returns only `name` for older
// providers. Map well-known display names → slug so styling still works.
const PLATFORM_NAME_TO_SLUG: Record<string, string> = {
  'Netflix': 'netflix',
  'Disney+': 'disney-plus',
  'Amazon Prime': 'amazon-prime-video',
  'Amazon Prime Video': 'amazon-prime-video',
  'BluTV': 'blutv',
  'Gain': 'gain',
  'GAIN': 'gain',
  'Mubi': 'mubi',
  'MUBI': 'mubi',
  'YouTube Premium': 'youtube-premium',
  'Apple TV+': 'apple-tv',
  'HBO Max': 'hbo-max',
  'Max': 'max',
  'Exxen': 'exxen',
  'EXXEN': 'exxen',
  'Puhu TV': 'puhutv',
  'PuhuTV': 'puhutv',
  'puhutv': 'puhutv',
  'TOD': 'tod-tv',
  'TOD TV': 'tod-tv',
  'Tabii': 'tabii',
  'tabii': 'tabii',
  'TV+': 'tv-plus',
  'beIN CONNECT': 'bein-connect',
};

function resolvePlatformSlug(p: { slug?: string; name: string }): string {
  if (p.slug) return p.slug;
  return PLATFORM_NAME_TO_SLUG[p.name] || p.name.toLowerCase().replace(/\s+/g, '-');
}

function typeLabelFor(item: ContentResult): string {
  // content_kind isn't on ContentResult; fall back to tv/movie.
  return item.type === 'tv' ? 'Dizi' : 'Film';
}

interface SearchResultsProps {
  results: ContentResult[];
}

export function SearchResults({ results }: SearchResultsProps) {
  const [selected, setSelected] = useState<ContentResult | null>(null);

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
          <SearchResultCard
            key={`${item.type}-${item.id}`}
            item={item}
            index={i}
            onSelect={() => setSelected(item)}
          />
        ))}
      </div>

      <ContentDetailSheet
        item={selected}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </div>
  );
}

function SearchResultCard({
  item,
  index,
  onSelect,
}: {
  item: ContentResult;
  index: number;
  onSelect: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const typeLabel = typeLabelFor(item);

  return (
    <button
      type="button"
      onClick={onSelect}
      className="text-left bg-card rounded-xl overflow-hidden border border-border/30 hover:border-primary/40 hover:shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.25)] transition-all duration-300 animate-fade-in group block w-full"
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
            const slug = resolvePlatformSlug(p as any);
            const style = getPlatformStyle(slug);
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

        {/* Type + Origin + Year row */}
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1">
            <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-muted-foreground/20 text-muted-foreground">
              {typeLabel}
            </span>
            {item.origin && item.origin !== 'bilinmiyor' && (
              <span className={cn(
                'px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider',
                item.origin === 'yerli'
                  ? 'bg-primary/20 text-primary'
                  : 'bg-secondary/60 text-secondary-foreground'
              )}>
                {item.origin === 'yerli' ? 'Yerli' : 'Yabancı'}
              </span>
            )}
          </div>
          {item.year && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 font-medium">
              <Calendar className="h-2.5 w-2.5" />
              {item.year}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function isContentTitlesUuid(id: number | string): boolean {
  return typeof id === 'string' && /^[0-9a-f]{8}-/.test(id);
}

function ContentDetailSheet({
  item,
  onOpenChange,
}: {
  item: ContentResult | null;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { isInWatchlist, addToWatchlist, removeFromWatchlist, adding, removing } = useWatchlist();
  const [resolving, setResolving] = useState(false);
  const [resolvedId, setResolvedId] = useState<string | null>(null);
  useEffect(() => { setResolvedId(null); }, [item?.id]);
  const open = !!item;
  const typeLabel = item ? typeLabelFor(item) : '';
  const sources = item
    ? Array.from(new Set(item.platforms.map((p: any) => p.source).filter(Boolean)))
    : [];
  const hasValidTitleId = item ? isContentTitlesUuid(item.id) : false;
  const titleId = hasValidTitleId ? String(item!.id) : resolvedId ?? '';
  const inList = !!titleId && isInWatchlist(titleId);

  const feedbackHref = item
    ? `mailto:hello@hapl.app?subject=${encodeURIComponent(`Hapl veri bildirimi: ${item.title}${item.year ? ` (${item.year})` : ''}`)}`
    : '#';

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="bg-background border-border/40">
        <div className="mx-auto w-full max-w-lg px-5 pb-6">
          <DrawerHeader className="px-0 pt-2 pb-3">
            <div className="flex items-start justify-between gap-3">
              <DrawerTitle className="font-heading text-lg leading-tight text-left">
                {item?.title}
              </DrawerTitle>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="shrink-0 p-1.5 rounded-full bg-secondary/60 hover:bg-secondary"
                aria-label="Kapat"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </DrawerHeader>

          {item && (
            <div className="space-y-4">
              {/* Meta row */}
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-2 py-0.5 rounded bg-muted-foreground/20 text-muted-foreground font-semibold uppercase tracking-wider">
                  {typeLabel}
                </span>
                {item.origin && item.origin !== 'bilinmiyor' && (
                  <span className={cn(
                    'px-2 py-0.5 rounded font-semibold uppercase tracking-wider',
                    item.origin === 'yerli'
                      ? 'bg-primary/20 text-primary'
                      : 'bg-secondary/60 text-secondary-foreground'
                  )}>
                    {item.origin === 'yerli' ? 'Yerli' : 'Yabancı'}
                  </span>
                )}
                {item.origin === 'bilinmiyor' && (
                  <span className="px-2 py-0.5 rounded font-semibold uppercase tracking-wider bg-secondary/40 text-muted-foreground">
                    Bilinmiyor
                  </span>
                )}
                {item.year && (
                  <span className="flex items-center gap-1 text-muted-foreground font-medium">
                    <Calendar className="h-3 w-3" />
                    {item.year}
                  </span>
                )}
              </div>

              {/* Genres */}
              {item.genres && item.genres.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {item.genres.slice(0, 6).map((g) => (
                    <span
                      key={g}
                      className="px-2.5 py-1 bg-secondary/70 rounded-lg text-[11px] font-semibold text-secondary-foreground border border-border/20"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {/* Platforms */}
              <div className="space-y-2">
                <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                  Platformlar
                </h3>
                <div className="flex flex-wrap gap-2">
                  {item.platforms.map((p, i) => {
                    const slug = resolvePlatformSlug(p as any);
                    const style = getPlatformStyle(slug);
                    return (
                      <div
                        key={i}
                        className={cn(
                          'px-3.5 py-1.5 rounded-xl text-xs font-extrabold tracking-wide uppercase shadow-md',
                          style.bg, style.text
                        )}
                      >
                        {p.name}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Watchlist toggle */}
              <button
                type="button"
                disabled={adding || removing || resolving}
                onClick={async () => {
                  if (!user) {
                    toast('Listeye eklemek için giriş yap');
                    navigate('/auth');
                    return;
                  }
                  if (hasValidTitleId || resolvedId) {
                    if (inList) {
                      removeFromWatchlist(titleId);
                    } else {
                      addToWatchlist(titleId);
                    }
                  } else {
                    setResolving(true);
                    try {
                      const { data, error } = await supabase.functions.invoke(
                        'hapl-resolve-title',
                        { body: { tmdb_id: item!.id, tmdb_type: item!.type } },
                      );
                      if (error || !data?.title_id) {
                        toast.error('İçerik eklenirken bir hata oluştu');
                        return;
                      }
                      setResolvedId(data.title_id);
                      addToWatchlist(data.title_id);
                    } catch {
                      toast.error('İçerik eklenirken bir hata oluştu');
                    } finally {
                      setResolving(false);
                    }
                  }
                }}
                className={cn(
                  'group flex items-center justify-center gap-2 w-full px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors',
                  inList
                    ? 'bg-primary/20 text-primary hover:bg-destructive/15 hover:text-destructive'
                    : 'bg-secondary/80 hover:bg-secondary text-foreground',
                )}
              >
                {adding || removing || resolving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bookmark className={cn('h-4 w-4', inList && 'fill-primary group-hover:fill-destructive')} />
                )}
                {inList ? (
                  <>
                    <span className="group-hover:hidden">Listemde</span>
                    <span className="hidden group-hover:inline">Listemden Çıkar</span>
                  </>
                ) : 'Listeme Ekle'}
              </button>

              {/* Sources */}
              {sources.length > 0 && (
                <div className="bg-card/60 border border-border/40 rounded-xl p-3 space-y-1">
                  <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Kaynak
                  </h3>
                  <p className="text-xs text-foreground/80">
                    {sources.map((s) => (s === 'tmdb' ? 'TMDB' : s === 'firecrawl' ? 'provider_catalog' : String(s))).join(' · ')}
                  </p>
                </div>
              )}

              {/* Feedback */}
              <a
                href={feedbackHref}
                className="block w-full text-center px-4 py-2.5 rounded-xl bg-secondary/80 hover:bg-secondary text-foreground text-sm font-semibold transition-colors"
              >
                Bu bilgi hatalı mı? Bildir
              </a>

              {/* Secondary TMDB attribution link — not the primary CTA */}
              {item.tmdb_url && (
                <a
                  href={item.tmdb_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-muted-foreground"
                >
                  Kaynak: TMDB <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
