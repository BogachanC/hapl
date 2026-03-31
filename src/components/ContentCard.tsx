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

  return (
    <div
      className="bg-card rounded-lg overflow-hidden border border-border/50 hover:border-border transition-all animate-fade-in"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      {/* Poster placeholder with gradient */}
      <div className="relative h-40 bg-gradient-to-br from-secondary to-muted flex items-center justify-center">
        {content.content_type === 'dizi' ? (
          <Tv className="h-10 w-10 text-muted-foreground/40" />
        ) : (
          <Film className="h-10 w-10 text-muted-foreground/40" />
        )}
        
        {/* Status badge */}
        <span className={cn('absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-medium', statusColors[content.status])}>
          {statusLabels[content.status]}
        </span>

        {/* Platform badge */}
        <span className={cn('absolute bottom-2 left-2 px-2.5 py-1 rounded-full text-[10px] font-semibold text-primary-foreground', platformColorMap[platform.slug] || 'bg-primary')}>
          {platform.name}
        </span>
      </div>

      <div className="p-3 space-y-1.5">
        <h3 className="font-heading font-semibold text-sm text-foreground truncate">{content.title}</h3>
        
        {content.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{content.description}</p>
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
    </div>
  );
}
