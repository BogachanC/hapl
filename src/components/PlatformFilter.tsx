import { useState, useRef, useEffect } from 'react';
import { getPlatformStyle } from '@/lib/platform-colors';
import { cn } from '@/lib/utils';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface PlatformFilterItem {
  id: string;       // unique key (slug works fine)
  slug: string;     // canonical streaming_providers.slug
  name: string;     // display label
}

interface PlatformFilterProps {
  platforms: PlatformFilterItem[];
  selected: string | undefined; // selected slug (or undefined for "Tümü")
  onSelect: (slug: string | undefined) => void;
}

export function PlatformFilter({ platforms, selected, onSelect }: PlatformFilterProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 2);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 2);
  };

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener('scroll', checkScroll, { passive: true });
    window.addEventListener('resize', checkScroll);
    return () => {
      el.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, [platforms]);

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -120 : 120, behavior: 'smooth' });
  };

  return (
    <div className="relative group">
      {canScrollLeft && (
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-background/90 border border-border/50 shadow-md flex items-center justify-center backdrop-blur-sm transition-opacity"
        >
          <ChevronLeft className="h-4 w-4 text-foreground" />
        </button>
      )}

      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 snap-x snap-mandatory px-1"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <button
          onClick={() => onSelect(undefined)}
          className={cn(
            'shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border snap-start',
            !selected
              ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/25'
              : 'bg-secondary text-secondary-foreground border-border/50 hover:bg-secondary/80'
          )}
        >
          Tümü
        </button>
        {platforms.map((p) => {
          const style = getPlatformStyle(p.slug);
          const isSelected = selected === p.slug;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(isSelected ? undefined : p.slug)}
              className={cn(
                'shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border snap-start',
                isSelected
                  ? `${style.bg} ${style.text} border-transparent shadow-lg`
                  : 'bg-secondary text-secondary-foreground border-border/50 hover:bg-secondary/80'
              )}
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {canScrollRight && (
        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 h-8 w-8 rounded-full bg-background/90 border border-border/50 shadow-md flex items-center justify-center backdrop-blur-sm transition-opacity"
        >
          <ChevronRight className="h-4 w-4 text-foreground" />
        </button>
      )}
    </div>
  );
}
