import { Platform } from '@/hooks/use-contents';
import { platformColorMap } from '@/lib/platform-colors';
import { cn } from '@/lib/utils';

interface PlatformFilterProps {
  platforms: Platform[];
  selected: string | undefined;
  onSelect: (id: string | undefined) => void;
}

export function PlatformFilter({ platforms, selected, onSelect }: PlatformFilterProps) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-4 px-4 snap-x snap-mandatory" style={{ WebkitOverflowScrolling: 'touch' }}>
      <button
        onClick={() => onSelect(undefined)}
        className={cn(
          'shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border',
          !selected
            ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/25'
            : 'bg-secondary text-secondary-foreground border-border/50 hover:bg-secondary/80'
        )}
      >
        Tümü
      </button>
      {platforms.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(selected === p.id ? undefined : p.id)}
          className={cn(
            'shrink-0 px-4 py-2.5 rounded-xl text-xs font-bold transition-all border',
            selected === p.id
              ? `${platformColorMap[p.slug] || 'bg-primary'} text-primary-foreground border-transparent shadow-lg`
              : 'bg-secondary text-secondary-foreground border-border/50 hover:bg-secondary/80'
          )}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
