import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useContent, Platform } from '@/hooks/use-contents';
import { platformColorMap, platformTextColorMap, statusLabels, statusColors } from '@/lib/platform-colors';
import { ArrowLeft, Calendar, Film, Tv, Globe, Flag, Loader2, Clapperboard } from 'lucide-react';
import { cn } from '@/lib/utils';

function getAllPlatforms(content: { platforms: Platform; content_platforms?: { platform_id: string; platforms: Platform }[] }): Platform[] {
  const map = new Map<string, Platform>();
  map.set(content.platforms.id, content.platforms);
  content.content_platforms?.forEach((cp) => {
    if (cp.platforms) map.set(cp.platforms.id, cp.platforms);
  });
  return Array.from(map.values());
}

const ContentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [imgError, setImgError] = useState(false);
  const { data: content, isLoading } = useContent(id || '');

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!content) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <p className="text-muted-foreground">İçerik bulunamadı</p>
        <button onClick={() => navigate('/')} className="text-primary text-sm hover:underline">Ana sayfaya dön</button>
      </div>
    );
  }

  const allPlatforms = getAllPlatforms(content);

  const yearDisplay = content.release_year
    ? content.end_year
      ? `${content.release_year}–${content.end_year}`
      : content.status === 'bitti'
        ? `${content.release_year}`
        : `${content.release_year}–`
    : null;

  const typeLabel = content.content_type === 'dizi' ? 'Dizi' : content.content_type === 'belgesel' ? 'Belgesel' : 'Film';

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Poster */}
      <div className="relative">
        <div className="aspect-[2/3] max-h-[55vh] w-full overflow-hidden bg-gradient-to-br from-secondary to-muted">
          {content.poster_url && !imgError ? (
            <img
              src={content.poster_url}
              alt={content.title}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
            />
          ) : content.content_type === 'dizi' ? (
            <div className="w-full h-full flex items-center justify-center">
              <Tv className="h-20 w-20 text-muted-foreground/20" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="h-20 w-20 text-muted-foreground/20" />
            </div>
          )}

          {/* Gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-transparent to-transparent h-20" />
        </div>

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-4 left-4 z-10 p-2.5 rounded-full bg-background/50 backdrop-blur-md border border-border/30 text-foreground hover:bg-background/80 transition-all duration-200 active:scale-95"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      </div>

      {/* Content Info */}
      <div className="container max-w-lg mx-auto px-5 -mt-24 relative z-10 pb-12 space-y-6">
        {/* Platform badges — MOST PROMINENT */}
        <div className="flex gap-2 flex-wrap">
          {allPlatforms.map((p) => (
            <div
              key={p.id}
              className={cn(
                'px-5 py-2.5 rounded-2xl text-sm font-extrabold tracking-wide uppercase shadow-xl',
                platformColorMap[p.slug] || 'bg-primary',
                'text-primary-foreground'
              )}
              style={{ textShadow: '0 1px 2px rgba(0,0,0,0.3)' }}
            >
              {p.name}
            </div>
          ))}
        </div>

        {/* Title & meta */}
        <div className="space-y-3">
          <h1 className="font-heading text-2xl font-bold text-foreground leading-tight">
            {content.title}
          </h1>

          <div className="flex items-center gap-3 flex-wrap">
            {/* Status */}
            <span className={cn(
              'px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider',
              statusColors[content.status]
            )}>
              {statusLabels[content.status]}
            </span>

            {/* Type */}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              {content.content_type === 'dizi' ? <Tv className="h-3.5 w-3.5" /> : content.content_type === 'belgesel' ? <Clapperboard className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
              {typeLabel}
            </span>

            {/* Year */}
            {yearDisplay && (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
                <Calendar className="h-3.5 w-3.5" />
                {yearDisplay}
              </span>
            )}

            {/* Origin */}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              {content.origin === 'yerli' ? <Flag className="h-3.5 w-3.5" /> : <Globe className="h-3.5 w-3.5" />}
              {content.origin === 'yerli' ? 'Yerli' : 'Yabancı'}
            </span>
          </div>
        </div>

        {/* Description */}
        {content.description && (
          <div className="space-y-2 bg-card/50 rounded-2xl p-4 border border-border/30">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Açıklama</h3>
            <p className="text-sm text-foreground/85 leading-relaxed">{content.description}</p>
          </div>
        )}

        {/* Genres */}
        {content.genre && content.genre.length > 0 && (
          <div className="space-y-2.5">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Türler</h3>
            <div className="flex gap-2 flex-wrap">
              {content.genre.map((g) => (
                <span
                  key={g}
                  className="px-3.5 py-1.5 bg-secondary/80 rounded-xl text-xs font-semibold text-secondary-foreground border border-border/20"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card/50 rounded-2xl p-4 border border-border/30 space-y-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Tür</span>
            <p className="text-sm font-semibold text-foreground">{typeLabel}</p>
          </div>
          <div className="bg-card/50 rounded-2xl p-4 border border-border/30 space-y-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Köken</span>
            <p className="text-sm font-semibold text-foreground">{content.origin === 'yerli' ? 'Yerli' : 'Yabancı'}</p>
          </div>
          {yearDisplay && (
            <div className="bg-card/50 rounded-2xl p-4 border border-border/30 space-y-1">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Yıl</span>
              <p className="text-sm font-semibold text-foreground">{yearDisplay}</p>
            </div>
          )}
          <div className="bg-card/50 rounded-2xl p-4 border border-border/30 space-y-1">
            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Durum</span>
            <p className="text-sm font-semibold text-foreground">{statusLabels[content.status]}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ContentDetail;
