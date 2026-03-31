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
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1">
      <button
        onClick={() => onSelect(undefined)}
        className={cn(
          'shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all',
          !selected
            ? 'bg-primary text-primary-foreground'
            : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
        )}
      >
        Tümü
      </button>
      {platforms.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(selected === p.id ? undefined : p.id)}
          className={cn(
            'shrink-0 px-4 py-2 rounded-full text-xs font-medium transition-all',
            selected === p.id
              ? `${platformColorMap[p.slug] || 'bg-primary'} text-primary-foreground`
              : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          )}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
