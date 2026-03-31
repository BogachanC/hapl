import { useParams, useNavigate } from 'react-router-dom';
import { useContent, Platform } from '@/hooks/use-contents';
import { platformColorMap, statusLabels, statusColors } from '@/lib/platform-colors';
import { ArrowLeft, Calendar, Film, Tv, Globe, Flag, Loader2 } from 'lucide-react';
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

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Poster */}
      <div className="relative">
        <div className="aspect-[2/3] max-h-[60vh] w-full overflow-hidden bg-gradient-to-br from-secondary to-muted">
          {content.poster_url ? (
            <img
              src={content.poster_url}
              alt={content.title}
              className="w-full h-full object-cover"
            />
          ) : content.content_type === 'dizi' ? (
            <div className="w-full h-full flex items-center justify-center">
              <Tv className="h-20 w-20 text-muted-foreground/30" />
            </div>
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Film className="h-20 w-20 text-muted-foreground/30" />
            </div>
          )}

          {/* Gradient overlays */}
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-transparent to-transparent h-24" />
        </div>

        {/* Back button */}
        <button
          onClick={() => navigate('/')}
          className="absolute top-4 left-4 z-10 p-2 rounded-full bg-background/60 backdrop-blur-sm border border-border/50 text-foreground hover:bg-background/80 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        {/* Status badge */}
        <span className={cn(
          'absolute top-4 right-4 z-10 px-3 py-1 rounded-full text-xs font-medium backdrop-blur-sm',
          statusColors[content.status]
        )}>
          {statusLabels[content.status]}
        </span>
      </div>

      {/* Content Info */}
      <div className="container max-w-lg mx-auto px-4 -mt-20 relative z-10 pb-10 space-y-5">
        {/* Title */}
        <div className="space-y-2">
          <h1 className="font-heading text-2xl font-bold text-foreground leading-tight">
            {content.title}
          </h1>
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="flex items-center gap-1">
              {content.content_type === 'dizi' ? <Tv className="h-3 w-3" /> : <Film className="h-3 w-3" />}
              {content.content_type === 'dizi' ? 'Dizi' : 'Film'}
            </span>
            {content.release_year && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {content.release_year}
                </span>
              </>
            )}
            <span>•</span>
            <span className="flex items-center gap-1">
              {content.origin === 'yerli' ? <Flag className="h-3 w-3" /> : <Globe className="h-3 w-3" />}
              {content.origin === 'yerli' ? 'Yerli' : 'Yabancı'}
            </span>
          </div>
        </div>

        {/* Platforms */}
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {allPlatforms.length > 1 ? 'Platformlar' : 'Platform'}
          </h3>
          <div className="flex gap-2 flex-wrap">
            {allPlatforms.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'px-4 py-2 rounded-xl text-sm font-bold tracking-wide shadow-lg backdrop-blur-sm',
                  platformColorMap[p.slug] || 'bg-primary',
                  'text-primary-foreground'
                )}
              >
                {p.name}
              </div>
            ))}
          </div>
        </div>

        {/* Description */}
        {content.description && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Açıklama</h3>
            <p className="text-sm text-foreground/80 leading-relaxed">{content.description}</p>
          </div>
        )}

        {/* Genres */}
        {content.genre && content.genre.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Türler</h3>
            <div className="flex gap-2 flex-wrap">
              {content.genre.map((g) => (
                <span
                  key={g}
                  className="px-3 py-1.5 bg-secondary rounded-lg text-xs font-medium text-secondary-foreground"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ContentDetail;
