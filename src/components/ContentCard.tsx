import { Link } from 'react-router-dom';
import { useState } from 'react';
import { Content } from '@/hooks/use-contents';
import { platformColorMap, statusLabels, statusColors } from '@/lib/platform-colors';
import { Film, Tv, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ContentCardProps {
  content: Content;
  index: number;
}

export function ContentCard({ content, index }: ContentCardProps) {
  const [imgError, setImgError] = useState(false);
  const platform = content.platforms;

  const allPlatforms = new Map<string, typeof platform>();
  allPlatforms.set(platform.id, platform);
  content.content_platforms?.forEach((cp) => {
    if (cp.platforms) allPlatforms.set(cp.platforms.id, cp.platforms);
  });
  const platformList = Array.from(allPlatforms.values());

  const yearDisplay = content.release_year
    ? content.end_year
      ? `${content.release_year}–${content.end_year}`
      : content.status === 'bitti'
        ? `${content.release_year}`
        : `${content.release_year}–`
    : null;

  return (
    <Link
      to={`/content/${content.id}`}
      className="bg-card rounded-xl overflow-hidden border border-border/30 hover:border-primary/40 hover:shadow-[0_8px_30px_-8px_hsl(var(--primary)/0.25)] transition-all duration-300 animate-fade-in group block"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-gradient-to-br from-secondary to-muted flex items-center justify-center overflow-hidden">
        {content.poster_url && !imgError ? (
          <img
            src={content.poster_url}
            alt={content.title}
            className="w-full h-full object-cover group-hover:scale-[1.08] transition-transform duration-700 ease-out"
            loading="lazy"
            onError={() => setImgError(true)}
          />
        ) : content.content_type === 'dizi' ? (
          <Tv className="h-8 w-8 text-muted-foreground/30" />
        ) : (
          <Film className="h-8 w-8 text-muted-foreground/30" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-card/90 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
      </div>

      <div className="p-2 space-y-1.5">
        {/* Platforms - most prominent */}
        <div className="flex flex-wrap gap-1">
          {platformList.map((p) => (
            <div
              key={p.id}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wide uppercase',
                platformColorMap[p.slug] || 'bg-primary',
                'text-primary-foreground'
              )}
            >
              {p.name}
            </div>
          ))}
        </div>

        <h3 className="font-heading font-bold text-xs text-foreground truncate leading-tight">{content.title}</h3>

        {/* Status + Year row */}
        <div className="flex items-center justify-between gap-1">
          <span className={cn('px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider', statusColors[content.status])}>
            {statusLabels[content.status]}
          </span>
          {yearDisplay && (
            <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 font-medium">
              <Calendar className="h-2.5 w-2.5" />
              {yearDisplay}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
