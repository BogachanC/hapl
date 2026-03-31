import { Link } from 'react-router-dom';
import { Content } from '@/hooks/use-contents';
import { platformColorMap, statusLabels, statusColors } from '@/lib/platform-colors';
import { Film, Tv, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ContentCardProps {
  content: Content;
  index: number;
}

export function ContentCard({ content, index }: ContentCardProps) {
  const platform = content.platforms;

  // Gather all platforms from junction table
  const allPlatforms = new Map<string, typeof platform>();
  allPlatforms.set(platform.id, platform);
  content.content_platforms?.forEach((cp) => {
    if (cp.platforms) allPlatforms.set(cp.platforms.id, cp.platforms);
  });
  const platformList = Array.from(allPlatforms.values());

  return (
    <Link
      to={`/content/${content.id}`}
      className="bg-card rounded-lg overflow-hidden border border-border/50 hover:border-border transition-all animate-fade-in group block"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Poster */}
      <div className="relative aspect-[2/3] bg-gradient-to-br from-secondary to-muted flex items-center justify-center overflow-hidden">
        {content.poster_url ? (
          <img
            src={content.poster_url}
            alt={content.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        ) : content.content_type === 'dizi' ? (
          <Tv className="h-10 w-10 text-muted-foreground/40" />
        ) : (
          <Film className="h-10 w-10 text-muted-foreground/40" />
        )}

        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-card via-transparent to-transparent" />

        {/* Status badge */}
        <span className={cn('absolute top-2 right-2 z-10 px-2 py-0.5 rounded-full text-[10px] font-medium backdrop-blur-sm', statusColors[content.status])}>
          {statusLabels[content.status]}
        </span>
      </div>

      <div className="p-3 space-y-2">
        <h3 className="font-heading font-bold text-sm text-foreground truncate">{content.title}</h3>

        <div className="flex flex-wrap gap-1.5">
          {platformList.map((p) => (
            <div
              key={p.id}
              className={cn(
                'shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold tracking-wide shadow-lg',
                platformColorMap[p.slug] || 'bg-primary',
                'text-primary-foreground'
              )}
            >
              {p.name}
            </div>
          ))}
        </div>

        {content.description && (
          <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed">{content.description}</p>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="flex gap-1 flex-wrap">
            {content.genre.slice(0, 2).map((g) => (
              <span key={g} className="text-[10px] px-2 py-0.5 bg-secondary rounded-full text-secondary-foreground">
                {g}
              </span>
            ))}
          </div>
          {content.release_year && (
            <span className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {content.release_year}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
