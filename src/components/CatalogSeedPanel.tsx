import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Database } from 'lucide-react';
import { toast } from 'sonner';

interface SeedStats {
  discovered: number;
  titles_processed?: number;
  titles_new?: number;
  titles_existing?: number;
  titles_upserted: number;
  availability_rows: number;
  availability_new?: number;
  availability_existing?: number;
  aliases_added: number;
  aliases_skipped_cached?: number;
  errors: number;
  skipped_no_poster?: number;
  skipped_no_tr_availability?: number;
  skipped_provider_unverified?: number;
  kind_counts?: Record<string, number>;
  provider_counts?: Record<string, number>;
}

interface SourceStats {
  source: string;
  discovered: number;
  titles_upserted: number;
  availability_rows: number;
  aliases_added: number;
  aliases_skipped_cached?: number;
}

interface CoverageDelta {
  target_slug: string;
  titles_total_before: number;
  titles_total_after: number;
  titles_total_delta: number;
  target_avail_before: number;
  target_avail_after: number;
  target_avail_delta: number;
  target_available_titles_before: number;
  target_available_titles_after: number;
  target_available_titles_delta: number;
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
  coverage_delta?: CoverageDelta | null;
  elapsed_ms: number;
}

const MAX_CHUNKS = 400;

type SeedMode = 'small' | 'large' | 'wide' | 'deep' | 'provider-targeted';
type ProviderSlug = 'all' | 'netflix' | 'amazon-prime-video' | 'max' | 'disney-plus' | 'mubi' | 'tv-plus';
type Depth = 'standard' | 'full';

const PROVIDER_OPTIONS: { slug: ProviderSlug; label: string }[] = [
  { slug: 'all', label: 'Tümü (6 platform)' },
  { slug: 'netflix', label: 'Netflix' },
  { slug: 'max', label: 'HBO Max' },
  { slug: 'disney-plus', label: 'Disney+' },
  { slug: 'amazon-prime-video', label: 'Amazon Prime Video' },
  { slug: 'mubi', label: 'MUBI' },
  { slug: 'tv-plus', label: 'TV+' },
];

export function CatalogSeedPanel() {
  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<ChunkResponse | null>(null);
  const [mode, setMode] = useState<SeedMode>('small');
  const [providerSlug, setProviderSlug] = useState<ProviderSlug>('all');
  const [depth, setDepth] = useState<Depth>('standard');
  const [progress, setProgress] = useState<{ chunks: number; processed: number; total: number } | null>(null);
  const [totalElapsedMs, setTotalElapsedMs] = useState(0);

  const isProviderMode = mode === 'provider-targeted';
  const isSinglePlatform = isProviderMode && providerSlug !== 'all';
  const fullDisabled = !isSinglePlatform;

  const runSeed = async () => {
    setRunning(true);
    setLastResult(null);
    setProgress(null);
    setTotalElapsedMs(0);

    let initialParams: any;
    if (mode === 'small') {
      initialParams = { pages_primary: 1, pages_secondary: 1, pages_docs: 1, vote_floor: 20 };
    } else if (mode === 'large') {
      initialParams = { pages_primary: 3, pages_secondary: 2, pages_docs: 2, vote_floor: 20 };
    } else if (mode === 'wide') {
      initialParams = { pages_primary: 8, pages_secondary: 5, pages_docs: 4, vote_floor: 15 };
    } else if (mode === 'deep') {
      initialParams = {
        mode: 'deep',
        pages_per_strategy: 5,
        pages_docs_per_strategy: 3,
        vote_count_floor: 15,
        vote_average_floor: 7.0,
        strategies: ['popularity', 'vote_count', 'vote_average', 'recent'],
        recent_year_from: 2022,
      };
    } else {
      // provider-targeted
      const allSlugs = PROVIDER_OPTIONS.filter((p) => p.slug !== 'all').map((p) => p.slug);
      const providers = providerSlug === 'all' ? allSlugs : [providerSlug];

      if (depth === 'full' && isSinglePlatform) {
        initialParams = {
          mode: 'provider-full',
          providers,
          provider: providerSlug,
          vote_count_floor: 10,
          vote_average_floor: 6.5,
          strategies: ['popularity', 'vote_count', 'vote_average', 'recent'],
          recent_year_from: 2022,
          max_pages_per_strategy: 500,
        };
      } else {
        initialParams = {
          mode: 'provider-targeted',
          pages_per_strategy: 5,
          vote_count_floor: 10,
          vote_average_floor: 6.5,
          strategies: ['popularity', 'vote_count', 'vote_average', 'recent'],
          recent_year_from: 2022,
          providers,
        };
      }
    }

    const label = isProviderMode
      ? `Platform Bazlı (${providerSlug === 'all' ? 'Tümü' : providerSlug}${depth === 'full' ? ' · Tüm TMDB Sonuçları' : ''})`
      : mode;
    toast.info(`Keşif başlatıldı: ${label}. Sayfada kalın…`);

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

        setProgress({ chunks: chunkCount, processed: chunk.processed_jobs, total: chunk.plan_total });
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

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === 'small' ? 'default' : 'outline'} size="sm" onClick={() => setMode('small')} disabled={running}>
          Küçük (~300)
        </Button>
        <Button variant={mode === 'large' ? 'default' : 'outline'} size="sm" onClick={() => setMode('large')} disabled={running}>
          Büyük (~1000)
        </Button>
        <Button variant={mode === 'wide' ? 'default' : 'outline'} size="sm" onClick={() => setMode('wide')} disabled={running}>
          Geniş (~3000)
        </Button>
        <Button variant={mode === 'deep' ? 'default' : 'outline'} size="sm" onClick={() => setMode('deep')} disabled={running}>
          Derin (~5000+)
        </Button>
        <Button variant={isProviderMode ? 'default' : 'outline'} size="sm" onClick={() => setMode('provider-targeted')} disabled={running}>
          Platform Bazlı
        </Button>
      </div>

      {isProviderMode && (
        <div className="rounded-lg border border-border/40 bg-background/40 p-3 space-y-3">
          <div>
            <div className="text-xs font-bold mb-1">Platform Bazlı TMDB Keşfi</div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Seçili platform için TMDB'de Türkiye watch region ile görünen film/dizi içerikleri keşfedilir.
              Her sonuç ayrıca <code className="text-[10px]">/watch/providers</code> ile doğrulanır.
            </p>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Platform</div>
            <div className="flex flex-wrap gap-1.5">
              {PROVIDER_OPTIONS.map((p) => (
                <Button
                  key={p.slug}
                  variant={providerSlug === p.slug ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    setProviderSlug(p.slug);
                    if (p.slug === 'all') setDepth('standard');
                  }}
                  disabled={running}
                  className="h-7 text-xs"
                >
                  {p.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-muted-foreground">Derinlik</div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant={depth === 'standard' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setDepth('standard')}
                disabled={running}
                className="h-7 text-xs"
              >
                Standart (5 sayfa × strateji)
              </Button>
              <Button
                variant={depth === 'full' ? 'default' : 'outline'}
                size="sm"
                onClick={() => {
                  if (fullDisabled) {
                    toast.warning('Tüm TMDB Sonuçları sadece tek platform seçiliyken kullanılabilir.');
                    return;
                  }
                  setDepth('full');
                }}
                disabled={running || fullDisabled}
                className="h-7 text-xs"
                title={fullDisabled ? 'Tek platform seçin' : ''}
              >
                Tüm TMDB Sonuçları
              </Button>
            </div>
            {depth === 'full' && isSinglePlatform && (
              <p className="text-[10px] text-muted-foreground leading-relaxed pt-1">
                Seçili platform için TMDB'nin döndürdüğü tüm TR watch-region sayfalarını tarar. Uzun sürebilir.
              </p>
            )}
          </div>
        </div>
      )}

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
          {isProviderMode && (
            <div className="text-[11px] text-muted-foreground">
              Seçili platform: <span className="text-foreground font-medium">{providerSlug}</span>
              {depth === 'full' && isSinglePlatform && ' · Tüm TMDB Sonuçları'}
            </div>
          )}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
            <div>Bulunan:</div>                <div className="text-foreground font-medium">{lastResult.stats.discovered}</div>
            <div>İşlenen içerik:</div>         <div className="text-foreground font-medium">{lastResult.stats.titles_processed ?? lastResult.stats.titles_upserted}</div>
            <div>Yeni eklenen içerik:</div>    <div className="text-foreground font-medium">{lastResult.stats.titles_new ?? 0}</div>
            <div>Güncellenen içerik:</div>     <div className="text-foreground font-medium">{lastResult.stats.titles_existing ?? 0}</div>
            <div>Platform kaydı (toplam):</div><div className="text-foreground font-medium">{lastResult.stats.availability_rows}</div>
            <div>· yeni eklenen:</div>         <div className="text-foreground font-medium">{lastResult.stats.availability_new ?? 0}</div>
            <div>· güncellenen:</div>          <div className="text-foreground font-medium">{lastResult.stats.availability_existing ?? 0}</div>
            <div>Alias eklenen:</div>          <div className="text-foreground font-medium">{lastResult.stats.aliases_added}</div>
            <div>Alias cache hit:</div>        <div className="text-foreground font-medium">{lastResult.stats.aliases_skipped_cached ?? 0}</div>
            <div>Provider doğrulanmadı:</div>  <div className="text-foreground font-medium">{lastResult.stats.skipped_provider_unverified ?? 0}</div>
            <div>Postersiz atlanan:</div>      <div className="text-foreground font-medium">{lastResult.stats.skipped_no_poster ?? 0}</div>
            <div>Hata:</div>                   <div className="text-foreground font-medium">{lastResult.stats.errors}</div>
            <div>Toplam süre:</div>            <div className="text-foreground font-medium">{(totalElapsedMs / 1000).toFixed(1)}s</div>
          </div>

          {lastResult.coverage_delta && (
            <>
              <div className="font-bold text-foreground pt-2">Coverage Delta ({lastResult.coverage_delta.target_slug})</div>
              <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <div></div><div className="text-right">Önce</div><div className="text-right">Sonra (Δ)</div>
                <div>Toplam içerik</div>
                <div className="text-right text-foreground">{lastResult.coverage_delta.titles_total_before}</div>
                <div className="text-right text-foreground">{lastResult.coverage_delta.titles_total_after} (+{lastResult.coverage_delta.titles_total_delta})</div>
                <div>Hedef platform avail.</div>
                <div className="text-right text-foreground">{lastResult.coverage_delta.target_avail_before}</div>
                <div className="text-right text-foreground">{lastResult.coverage_delta.target_avail_after} (+{lastResult.coverage_delta.target_avail_delta})</div>
                <div>Hedef available title</div>
                <div className="text-right text-foreground">{lastResult.coverage_delta.target_available_titles_before}</div>
                <div className="text-right text-foreground">{lastResult.coverage_delta.target_available_titles_after} (+{lastResult.coverage_delta.target_available_titles_delta})</div>
              </div>
            </>
          )}

          {lastResult.stats.provider_counts && Object.keys(lastResult.stats.provider_counts).length > 0 && (
            <>
              <div className="font-bold text-foreground pt-2">Platform dağılımı (availability)</div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Not: Seçili platform keşif hedefidir. Platform dağılımı, keşfedilen içeriklerin TR'de göründüğü tüm platformları gösterir.
              </p>
              <div className="space-y-1">
                {Object.entries(lastResult.stats.provider_counts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between text-muted-foreground">
                      <span className="font-medium text-foreground">{k}</span>
                      <span>{v}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
          {lastResult.stats.kind_counts && Object.keys(lastResult.stats.kind_counts).length > 0 && (
            <>
              <div className="font-bold text-foreground pt-2">Kategori dağılımı</div>
              <div className="space-y-1">
                {Object.entries(lastResult.stats.kind_counts).map(([k, v]) => (
                  <div key={k} className="flex justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{k}</span>
                    <span>{v}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {lastResult.sources?.length > 0 && (
            <>
              <div className="font-bold text-foreground pt-2">Kaynaklar</div>
              <div className="space-y-1 max-h-40 overflow-auto">
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
