import { cn } from '@/lib/utils';

interface TypeFilterProps {
  selected: string | undefined;
  onSelect: (type: string | undefined) => void;
}

export function TypeFilter({ selected, onSelect }: TypeFilterProps) {
  const types = [
    { value: undefined, label: 'Tümü' },
    { value: 'dizi', label: 'Diziler' },
    { value: 'film', label: 'Filmler' },
  ];

  return (
    <div className="flex gap-1 bg-secondary rounded-lg p-1">
      {types.map((t) => (
        <button
          key={t.label}
          onClick={() => onSelect(t.value)}
          className={cn(
            'flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-all',
            selected === t.value
              ? 'bg-primary text-primary-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
