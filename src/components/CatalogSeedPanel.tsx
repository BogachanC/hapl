import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Sparkles, Database, AlertTriangle, RotateCw, Play } from 'lucide-react';
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
  status?: 'partial' | 'completed' | 'failed';
  job_id?: string | null;
  next_cursor: any | null;
  plan_total: number;
  processed_jobs: number;
  jobs_done_this_chunk: number;
  stats: SeedStats;
  sources: SourceStats[];
  coverage_delta?: CoverageDelta | null;
  error?: string | null;
  elapsed_ms: number;
}

interface SeedJobSummary {
  id: string;
  status: 'running' | 'partial' | 'paused' | 'failed' | 'completed' | string;
  selected_provider_slug?: string | null;
  current_strategy?: string | null;
  current_media_type?: string | null;
  current_page?: number | null;
  total_pages?: number | null;
  processed_count?: number | null;
  processed_jobs?: number | null;
  plan_total?: number | null;
  last_error?: string | null;
  updated_at?: string | null;
  stats?: SeedStats;
  sources?: SourceStats[];
  coverage_delta?: CoverageDelta | null;
}

interface FunctionDebug {
  functionName: string;
  action: string;
  jobId?: string | null;
  errorMessage: string;
}

const MAX_CHUNKS = 800;
const ACTIVE_JOB_KEY = 'hapl_active_catalog_seed_job_id';
const LEGACY_ACTIVE_JOB_KEY = 'hapl.catalog_seed.active_job_id';
const SEED_FUNCTION = 'hapl-seed-catalog';
const CONNECTION_ERROR_MESSAGE = 'Bağlantı koptu veya proxy hata verdi. Job kaydı korunuyor. Devam etmeyi deneyebilirsin.';

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
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [interrupted, setInterrupted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [debugInfo, setDebugInfo] = useState<FunctionDebug | null>(null);

  const isProviderMode = mode === 'provider-targeted';
  const isSinglePlatform = isProviderMode && providerSlug !== 'all';
  const fullDisabled = !isSinglePlatform;

  const persistActiveJob = (jobId: string) => {
    setActiveJobId(jobId);
    localStorage.setItem(ACTIVE_JOB_KEY, jobId);
    localStorage.removeItem(LEGACY_ACTIVE_JOB_KEY);
  };

  const clearActiveJob = () => {
    setActiveJobId(null);
    localStorage.removeItem(ACTIVE_JOB_KEY);
    localStorage.removeItem(LEGACY_ACTIVE_JOB_KEY);
  };

  const resultFromJob = (job: SeedJobSummary): ChunkResponse => ({
    ok: job.status !== 'failed',
    done: job.status === 'completed',
    status: job.status === 'completed' ? 'completed' : (job.status === 'failed' ? 'failed' : 'partial'),
    job_id: job.id,
    next_cursor: null,
    plan_total: job.plan_total ?? job.total_pages ?? 0,
    processed_jobs: job.processed_jobs ?? job.processed_count ?? 0,
    jobs_done_this_chunk: 0,
    stats: (job.stats as SeedStats) ?? {
      discovered: 0, titles_upserted: 0, availability_rows: 0, aliases_added: 0, errors: 0,
    },
    sources: job.sources ?? [],
    coverage_delta: job.coverage_delta ?? null,
    error: job.last_error ?? null,
    elapsed_ms: 0,
  });

  const applyJobSummary = (job: SeedJobSummary, markInterrupted = true) => {
    persistActiveJob(job.id);
    const processed = job.processed_jobs ?? job.processed_count ?? 0;
    const total = job.plan_total ?? job.total_pages ?? 0;
    setProgress({ chunks: 0, processed, total });
    setLastResult(resultFromJob(job));
    setInterrupted(markInterrupted || job.status !== 'completed');
    setErrorMsg(job.last_error || (job.status === 'running' ? CONNECTION_ERROR_MESSAGE : null));
  };

  const invokeSeedFunction = async (action: string, body: Record<string, any>) => {
    const res = await supabase.functions.invoke(SEED_FUNCTION, { body: { ...body, action } });
    if (res.error) {
      setDebugInfo({ functionName: SEED_FUNCTION, action, jobId: body.job_id ?? null, errorMessage: res.error.message || String(res.error) });
      throw res.error;
    }
    setDebugInfo(null);
    return res.data;
  };

  const fetchJobStatus = async (id: string): Promise<SeedJobSummary | null> => {
    const data = await invokeSeedFunction('status', { job_id: id }) as { ok: boolean; job?: SeedJobSummary | null };
    return data?.ok ? (data.job ?? null) : null;
  };

  const findLatestIncomplete = async (): Promise<SeedJobSummary | null> => {
    const data = await invokeSeedFunction('latest_incomplete', {}) as { ok: boolean; job?: SeedJobSummary | null };
    return data?.ok ? (data.job ?? null) : null;
  };

  // Restore last interrupted job from localStorage or backend status on mount
  useEffect(() => {
    const saved = localStorage.getItem(ACTIVE_JOB_KEY) || localStorage.getItem(LEGACY_ACTIVE_JOB_KEY);
    (async () => {
      try {
        const job = saved ? await fetchJobStatus(saved) : await findLatestIncomplete();
        if (!job) return;
        if (job.status === 'completed') {
          if (saved === job.id) clearActiveJob();
          return;
        }
        applyJobSummary(job);
      } catch (e: any) {
        if (saved) {
          persistActiveJob(saved);
          setInterrupted(true);
          setErrorMsg(CONNECTION_ERROR_MESSAGE);
          setDebugInfo({ functionName: SEED_FUNCTION, action: 'status', jobId: saved, errorMessage: e?.message || 'Status çağrısı başarısız' });
        }
      }
    })();
  }, []);

  const drive = async (initialBody: any, label: string, existingJobId?: string) => {
    setRunning(true);
    setInterrupted(false);
    setErrorMsg(null);
    if (!existingJobId) setLastResult(null);
    setProgress(null);
    setTotalElapsedMs(0);

    toast.info(`Keşif başlatıldı: ${label}. Sayfada kalın…`);

    let chunkCount = 0;
    let lastChunk: ChunkResponse | null = null;
    const t0 = Date.now();
    let body: any = initialBody;
    let currentJobId: string | null = existingJobId ?? null;

    // Prepare phase: persist job_id ASAP before long work starts
    if (!existingJobId) {
      try {
        const prep = await supabase.functions.invoke('hapl-seed-catalog', {
          body: { ...initialBody, action: 'prepare' },
        });
        if (prep.error) throw prep.error;
        const prepData = prep.data as ChunkResponse;
        if (prepData.job_id) {
          currentJobId = prepData.job_id;
          setActiveJobId(prepData.job_id);
          localStorage.setItem(ACTIVE_JOB_KEY, prepData.job_id);
          setLastResult(prepData);
          setProgress({ chunks: 0, processed: 0, total: prepData.plan_total });
        }
      } catch (e: any) {
        const msg = e?.message || 'Hazırlık aşamasında hata';
        setErrorMsg(msg);
        setRunning(false);
        toast.error('Keşif başlatılamadı: ' + msg);
        return;
      }
      body = currentJobId ? { action: 'continue', job_id: currentJobId } : initialBody;
    }

    try {
      while (chunkCount < MAX_CHUNKS) {
        const { data, error } = await supabase.functions.invoke('hapl-seed-catalog', { body });
        if (error) throw error;
        const chunk = data as ChunkResponse;
        chunkCount++;
        lastChunk = chunk;

        if (chunk.job_id) {
          currentJobId = chunk.job_id;
          setActiveJobId(chunk.job_id);
          localStorage.setItem(ACTIVE_JOB_KEY, chunk.job_id);
        }

        setProgress({ chunks: chunkCount, processed: chunk.processed_jobs, total: chunk.plan_total });
        setLastResult(chunk);
        setTotalElapsedMs(Date.now() - t0);

        if (chunk.status === 'failed' || !chunk.ok) {
          throw new Error(chunk.error || 'Backend "failed" status döndü');
        }
        if (chunk.done) break;

        body = currentJobId
          ? { action: 'continue', job_id: currentJobId }
          : (chunk.next_cursor ? { cursor: chunk.next_cursor } : null);
        if (!body) break;
      }

      if (lastChunk?.done) {
        localStorage.removeItem(ACTIVE_JOB_KEY);
        setActiveJobId(null);
        toast.success(
          `Seed tamamlandı (${chunkCount} chunk): ${lastChunk.stats.titles_upserted} içerik, ${lastChunk.stats.availability_rows} platform kaydı`,
        );
      } else {
        setInterrupted(true);
        toast.warning(`Seed ${chunkCount} chunk'tan sonra durdu.`);
      }
    } catch (e: any) {
      const msg = e?.message || 'Bilinmeyen hata';
      setInterrupted(true);
      // Proxy/network error: response gelmedi. DB'den son job durumunu çek.
      if (currentJobId) {
        const job = await fetchJobFromDb(currentJobId);
        if (job) {
          setProgress({ chunks: chunkCount, processed: job.processed_jobs ?? 0, total: job.plan_total ?? 0 });
          if (job.status === 'completed') {
            localStorage.removeItem(ACTIVE_JOB_KEY);
            setActiveJobId(null);
            setInterrupted(false);
            toast.success('Keşif tamamlandı (DB onayı).');
            setRunning(false);
            return;
          }
          setErrorMsg(`Bağlantı kesildi ama iş durumu kaydedildi (${job.processed_jobs}/${job.plan_total}). Kaldığı yerden devam edebilirsin.`);
          toast.warning('Bağlantı koptu — Devam Et ile sürdürebilirsin.');
          setRunning(false);
          return;
        }
      }
      setErrorMsg(msg);
      toast.error('Keşif yarıda kesildi: ' + msg);
    } finally {
      setRunning(false);
    }
  };

  const buildInitialBody = () => {
    if (mode === 'small') return { pages_primary: 1, pages_secondary: 1, pages_docs: 1, vote_floor: 20 };
    if (mode === 'large') return { pages_primary: 3, pages_secondary: 2, pages_docs: 2, vote_floor: 20 };
    if (mode === 'wide')  return { pages_primary: 8, pages_secondary: 5, pages_docs: 4, vote_floor: 15 };
    if (mode === 'deep') {
      return {
        mode: 'deep', pages_per_strategy: 5, pages_docs_per_strategy: 3,
        vote_count_floor: 15, vote_average_floor: 7.0,
        strategies: ['popularity', 'vote_count', 'vote_average', 'recent'],
        recent_year_from: 2022,
      };
    }
    const allSlugs = PROVIDER_OPTIONS.filter((p) => p.slug !== 'all').map((p) => p.slug);
    const providers = providerSlug === 'all' ? allSlugs : [providerSlug];
    if (depth === 'full' && isSinglePlatform) {
      return {
        mode: 'provider-full', providers, provider: providerSlug,
        vote_count_floor: 10, vote_average_floor: 6.5,
        strategies: ['popularity', 'vote_count', 'vote_average', 'recent'],
        recent_year_from: 2022, max_pages_per_strategy: 500,
      };
    }
    return {
      mode: 'provider-targeted', pages_per_strategy: 5,
      vote_count_floor: 10, vote_average_floor: 6.5,
      strategies: ['popularity', 'vote_count', 'vote_average', 'recent'],
      recent_year_from: 2022, providers,
    };
  };

  const runSeed = async () => {
    const label = isProviderMode
      ? `Platform Bazlı (${providerSlug === 'all' ? 'Tümü' : providerSlug}${depth === 'full' ? ' · Tüm TMDB Sonuçları' : ''})`
      : mode;
    await drive(buildInitialBody(), label);
  };

  const resumeJob = async () => {
    if (!activeJobId) return;
    await drive({ action: 'continue', job_id: activeJobId }, `Devam: ${activeJobId.slice(0, 8)}`, activeJobId);
  };

  const discardJob = () => {
    localStorage.removeItem(ACTIVE_JOB_KEY);
    setActiveJobId(null);
    setInterrupted(false);
    setErrorMsg(null);
    setLastResult(null);
    toast.info('Yarım kalan iş atıldı.');
  };

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Database className="h-4 w-4 text-primary" />
        <h2 className="font-heading font-bold text-sm">Katalog Keşfi</h2>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        TMDB'den TR'de izlenebilir içerikleri keşfedip Hapl katalog veritabanına yazar.
        Job/chunk mimarisi sayesinde yarıda kesilirse "Devam Et" ile aynı yerden sürebilir.
      </p>

      {(activeJobId && !running) && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 space-y-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-destructive">
            <AlertTriangle className="h-3.5 w-3.5" />
            {interrupted ? 'Keşif yarıda kesildi' : 'Yarım kalan iş bulundu'}
          </div>
          <div className="text-muted-foreground">
            Job: <span className="font-mono text-foreground">{activeJobId.slice(0, 8)}…</span>
            {lastResult && (
              <> · Son başarılı chunk: <span className="text-foreground">{lastResult.processed_jobs} / {lastResult.plan_total}</span></>
            )}
          </div>
          {errorMsg && <div className="text-destructive/90 break-all">{errorMsg}</div>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={resumeJob} disabled={running} className="gap-1 h-8 text-xs">
              <Play className="h-3 w-3" /> Devam Et
            </Button>
            <Button size="sm" variant="outline" onClick={discardJob} disabled={running} className="gap-1 h-8 text-xs">
              <RotateCw className="h-3 w-3" /> Baştan Başlat
            </Button>
          </div>
        </div>
      )}

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
          <div className="flex items-center justify-between">
            <div className="font-bold text-foreground">
              {lastResult.done ? 'Sonuç' : (lastResult.status === 'failed' ? 'Hata' : 'Ara sonuç')}
            </div>
            {lastResult.status && (
              <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                lastResult.status === 'completed' ? 'bg-primary/20 text-primary' :
                lastResult.status === 'failed' ? 'bg-destructive/20 text-destructive' :
                'bg-muted text-muted-foreground'
              }`}>
                {lastResult.status}
              </span>
            )}
          </div>
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
