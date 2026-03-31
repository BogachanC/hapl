import { useState } from 'react';
import { cn } from '@/lib/utils';
import { SlidersHorizontal, X, ChevronDown } from 'lucide-react';

interface AdvancedFilterProps {
  selectedGenres: string[];
  onGenresChange: (genres: string[]) => void;
  selectedOrigin: string | undefined;
  onOriginChange: (origin: string | undefined) => void;
  selectedStatus: string | undefined;
  onStatusChange: (status: string | undefined) => void;
}

const GENRES = [
  'Dram', 'Komedi', 'Aksiyon', 'Gerilim', 'Bilim Kurgu', 'Fantastik',
  'Romantik', 'Suç', 'Korku', 'Tarih', 'Belgesel', 'Animasyon',
  'Gizem', 'Macera', 'Biyografi', 'Psikolojik', 'Sanat', 'Spor', 'Aile',
];

const ORIGINS = [
  { value: undefined, label: 'Tümü' },
  { value: 'yerli', label: '🇹🇷 Yerli' },
  { value: 'yabanci', label: '🌍 Yabancı' },
];

const STATUSES = [
  { value: undefined, label: 'Tümü' },
  { value: 'yayinda', label: 'Yayında' },
  { value: 'yakinda', label: 'Yakında' },
  { value: 'bitti', label: 'Bitti' },
];

export function AdvancedFilter({
  selectedGenres,
  onGenresChange,
  selectedOrigin,
  onOriginChange,
  selectedStatus,
  onStatusChange,
}: AdvancedFilterProps) {
  const [isOpen, setIsOpen] = useState(false);

  const activeFilterCount =
    selectedGenres.length +
    (selectedOrigin ? 1 : 0) +
    (selectedStatus ? 1 : 0);

  const toggleGenre = (genre: string) => {
    if (selectedGenres.includes(genre)) {
      onGenresChange(selectedGenres.filter((g) => g !== genre));
    } else {
      onGenresChange([...selectedGenres, genre]);
    }
  };

  const clearAll = () => {
    onGenresChange([]);
    onOriginChange(undefined);
    onStatusChange(undefined);
  };

  return (
    <div className="space-y-2">
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all w-full justify-between',
          isOpen || activeFilterCount > 0
            ? 'bg-primary/10 text-primary border border-primary/20'
            : 'bg-secondary text-muted-foreground border border-transparent'
        )}
      >
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Filtrele</span>
          {activeFilterCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold min-w-[18px] text-center">
              {activeFilterCount}
            </span>
          )}
        </div>
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {/* Filter Panel */}
      {isOpen && (
        <div className="bg-card border border-border/50 rounded-xl p-4 space-y-4 animate-fade-in">
          {/* Clear all */}
          {activeFilterCount > 0 && (
            <button
              onClick={clearAll}
              className="flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              <X className="h-3 w-3" />
              Filtreleri temizle
            </button>
          )}

          {/* Origin */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Yapım</h4>
            <div className="flex gap-1.5 flex-wrap">
              {ORIGINS.map((o) => (
                <button
                  key={o.label}
                  onClick={() => onOriginChange(selectedOrigin === o.value ? undefined : o.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    selectedOrigin === o.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* Status */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Durum</h4>
            <div className="flex gap-1.5 flex-wrap">
              {STATUSES.map((s) => (
                <button
                  key={s.label}
                  onClick={() => onStatusChange(selectedStatus === s.value ? undefined : s.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                    selectedStatus === s.value
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-secondary text-muted-foreground hover:text-foreground'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Genres - multi select */}
          <div className="space-y-2">
            <h4 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
              Tür
              {selectedGenres.length > 0 && (
                <span className="ml-1 text-primary">({selectedGenres.length})</span>
              )}
            </h4>
            <div className="flex gap-1.5 flex-wrap">
              {GENRES.map((genre) => (
                <button
                  key={genre}
                  onClick={() => toggleGenre(genre)}
                  className={cn(
                    'px-2.5 py-1 rounded-full text-[11px] font-medium transition-all border',
                    selectedGenres.includes(genre)
                      ? 'bg-primary/15 text-primary border-primary/30'
                      : 'bg-secondary/50 text-muted-foreground border-transparent hover:text-foreground'
                  )}
                >
                  {genre}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
