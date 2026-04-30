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
  aliases_skipped_cached?: number;
  errors: number;
}

interface SourceStats {
  source: string;
  discovered: number;
  titles_upserted: number;
  availability_rows: number;
  aliases_added: number;
  aliases_skipped_cached?: number;
}

interface ChunkResponse {
  ok: boolean;
  done: boolean;
  next_cursor: any | null;
  plan_total: number;
  processed_jobs: number;
  jobs_done_this_chunk: number;
  stats: SeedStats;
  sources: SourceStats[];
  elapsed_ms: number;
}

const MAX_CHUNKS = 30; // safety cap

export function CatalogSeedPanel() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<ChunkResponse | null>(null);
  const [mode, setMode] = useState<'small' | 'large'>('small');
  const [progress, setProgress] = useState<{ chunks: number; processed: number; total: number } | null>(null);
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);

  const runSeed = async () => {
    setRunning(true);
    setLastResult(null);
    setProgress(null);
    setTotalElapsedMs(0);

    const initialParams = mode === 'small'
      ? { pages_primary: 1, pages_secondary: 1, pages_docs: 1, vote_floor: 20 }
      : { pages_primary: 3, pages_secondary: 2, pages_docs: 2, vote_floor: 20 };

    toast.info(
      mode === 'small'
        ? 'Küçük seed başlatıldı (~300 içerik). Lütfen 1-2 dakika bekleyin…'
        : 'Büyük seed başlatıldı (~1000 içerik). Birden fazla chunk halinde çalışacak…'
    );

    try {
      let cursor: any = null;
      let chunkCount = 0;
      let lastChunk: ChunkResponse | null = null;
      const t0 = Date.now();

      while (chunkCount < MAX_CHUNKS) {
        const body = cursor ? { cursor } : initialParams;
        const { data, error } = await supabase.functions.invoke('hapl-seed-catalog', { body });
        if (error) throw error;
        const chunk = data as ChunkResponse;
        chunkCount++;
        lastChunk = chunk;

        setProgress({
          chunks: chunkCount,
          processed: chunk.processed_jobs,
          total: chunk.plan_total,
        });
        setLastResult(chunk);
        setTotalElapsedMs(Date.now() - t0);

        if (chunk.done) break;
        cursor = chunk.next_cursor;
        if (!cursor) break;
      }

      if (lastChunk?.done) {
        toast.success(
          `Seed tamamlandı (${chunkCount} chunk): ${lastChunk.stats.titles_upserted} içerik, ${lastChunk.stats.availability_rows} platform kaydı`
        );
      } else {
        toast.warning(`Seed ${chunkCount} chunk'tan sonra durdu, tamamlanmadı.`);
      }
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
        Büyük mod, timeout'tan kaçınmak için chunk'lara bölünür.
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

      {progress && (
        <div className="rounded-lg bg-secondary/30 p-3 space-y-1.5 text-xs">
          <div className="flex justify-between text-muted-foreground">
            <span>Chunk:</span>
            <span className="text-foreground font-medium">{progress.chunks}</span>
          </div>
          <div className="flex justify-between text-muted-foreground">
            <span>İş ilerlemesi:</span>
            <span className="text-foreground font-medium">{progress.processed} / {progress.total}</span>
          </div>
          <div className="h-1.5 w-full bg-muted/40 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {lastResult && (
        <div className="rounded-lg bg-secondary/40 p-3 space-y-2 text-xs">
          <div className="font-bold text-foreground">{lastResult.done ? 'Sonuç' : 'Ara sonuç'}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <div>Bulunan:</div>           <div className="text-foreground font-medium">{lastResult.stats.discovered}</div>
            <div>Yazılan içerik:</div>     <div className="text-foreground font-medium">{lastResult.stats.titles_upserted}</div>
            <div>Platform kaydı:</div>     <div className="text-foreground font-medium">{lastResult.stats.availability_rows}</div>
            <div>Alias eklenen:</div>      <div className="text-foreground font-medium">{lastResult.stats.aliases_added}</div>
            <div>Alias cache hit:</div>    <div className="text-foreground font-medium">{lastResult.stats.aliases_skipped_cached ?? 0}</div>
            <div>Hata:</div>               <div className="text-foreground font-medium">{lastResult.stats.errors}</div>
            <div>Toplam süre:</div>        <div className="text-foreground font-medium">{(totalElapsedMs / 1000).toFixed(1)}s</div>
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
