import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Database } from 'lucide-react';
import { toast } from 'sonner';

interface SeedStats {
  discovered: number;
  titles_upserted: number;
  availability_rows: number;
  aliases_added: number;
  errors: number;
}

interface SourceStats {
  source: string;
  discovered: number;
  titles_upserted: number;
  availability_rows: number;
  aliases_added: number;
}

interface SeedResponse {
  ok: boolean;
  stats: SeedStats;
  sources: SourceStats[];
  elapsed_ms: number;
  params: any;
}

/**
 * Admin-only catalog seed trigger. Calls hapl-seed-catalog edge function.
 * Two modes:
 *   - Small (~300 items): 1 page per provider + 1 docs page
 *   - Large (~1000 items): 3 pages primary, 2 secondary, 2 docs
 */
export function CatalogSeedPanel() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<SeedResponse | null>(null);
  const [mode, setMode] = useState<'small' | 'large'>('small');

  const runSeed = async () => {
    setRunning(true);
    setLastResult(null);
    try {
      const params = mode === 'small'
        ? { pages_primary: 1, pages_secondary: 1, pages_docs: 1, vote_floor: 20 }
        : { pages_primary: 3, pages_secondary: 2, pages_docs: 2, vote_floor: 20 };

      toast.info(
        mode === 'small'
          ? 'Küçük seed başlatıldı (~300 içerik). Lütfen 1-2 dakika bekleyin…'
          : 'Büyük seed başlatıldı (~1000 içerik). 3-5 dakika sürebilir…'
      );

      const { data, error } = await supabase.functions.invoke('hapl-seed-catalog', {
        body: params,
      });
      if (error) throw error;
      setLastResult(data as SeedResponse);
      toast.success(
        `Seed tamamlandı: ${data?.stats?.titles_upserted ?? 0} içerik, ${data?.stats?.availability_rows ?? 0} platform kaydı`
      );
    } catch (e: any) {
      toast.error('Seed hatası: ' + (e.message || 'Bilinmeyen hata'));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="font-heading font-bold text-sm">Katalog Keşfi</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        TMDB'den TR'de izlenebilir içerikleri keşfedip Hapl katalog veritabanına yazar.
        Ana sayfa feed'i bu veritabanından çalışır.
      </p>

      <div className="flex gap-2">
        <Button
          variant={mode === 'small' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('small')}
          disabled={running}
        >
          Küçük (~300)
        </Button>
        <Button
          variant={mode === 'large' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setMode('large')}
          disabled={running}
        >
          Büyük (~1000)
        </Button>
      </div>

      <Button onClick={runSeed} disabled={running} className="w-full gap-2">
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {running ? 'Keşfediliyor…' : 'Katalog Keşfi Başlat'}
      </Button>

      {lastResult && (
        <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-xs">
          <div className="font-bold text-foreground">Sonuç</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <div>Bulunan:</div>           <div className="text-foreground font-medium">{lastResult.stats.discovered}</div>
            <div>Yazılan içerik:</div>     <div className="text-foreground font-medium">{lastResult.stats.titles_upserted}</div>
            <div>Platform kaydı:</div>     <div className="text-foreground font-medium">{lastResult.stats.availability_rows}</div>
            <div>Alias eklenen:</div>      <div className="text-foreground font-medium">{lastResult.stats.aliases_added}</div>
            <div>Hata:</div>               <div className="text-foreground font-medium">{lastResult.stats.errors}</div>
            <div>Süre:</div>               <div className="text-foreground font-medium">{(lastResult.elapsed_ms / 1000).toFixed(1)}s</div>
          </div>
          {lastResult.sources?.length > 0 && (
            <>
              <div className="font-bold text-foreground pt-2">Kaynaklar</div>
              <div className="space-y-1">
                {lastResult.sources.map((s) => (
                  <div key={s.source} className="flex justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{s.source}</span>
                    <span>{s.titles_upserted} title · {s.availability_rows} avail · {s.aliases_added} alias</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
