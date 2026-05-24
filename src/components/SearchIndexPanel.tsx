import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Loader2, Search, Settings2, Play, RotateCw, FastForward } from 'lucide-react';
import { toast } from 'sonner';

interface IndexState {
  index_name: string;
  indexed_count: number;
  failed_count: number;
  current_offset: number;
  total_titles: number;
  has_more: boolean;
  last_synced_at: string | null;
  last_error: string | null;
}

interface StatusResponse {
  ok: boolean;
  meili_configured: boolean;
  meili_enabled: boolean;
  index_name: string;
  state: IndexState | null;
  error?: string;
}

const FUNCTION = 'hapl-sync-search-index';

export function SearchIndexPanel() {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const { data, error } = await supabase.functions.invoke(FUNCTION, {
        body: { action: 'status' },
      });
      if (error) throw error;
      setStatus(data as StatusResponse);
    } catch (e: any) {
      toast.error('Durum alınamadı: ' + (e.message || 'bilinmeyen hata'));
    }
  };

  useEffect(() => { refresh(); }, []);

  const call = async (action: string, label: string) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke(FUNCTION, {
        body: { action },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'işlem başarısız');
      toast.success(`${label} tamam`);
      await refresh();
      return data;
    } catch (e: any) {
      toast.error(`${label} hatası: ${e.message || 'bilinmeyen hata'}`);
    } finally {
      setBusy(null);
    }
  };

  const continueBatched = async () => {
    setBusy('full_sync_continue_loop');
    let safety = 0;
    try {
      while (safety++ < 200) {
        const { data, error } = await supabase.functions.invoke(FUNCTION, {
          body: { action: 'full_sync_continue' },
        });
        if (error) throw error;
        if (!data?.ok) throw new Error(data?.error || 'devam başarısız');
        setStatus((prev) => prev ? { ...prev, state: data.state } : prev);
        if (!data.has_more) break;
      }
      toast.success('Sync tamamlandı.');
      await refresh();
    } catch (e: any) {
      toast.error('Sync hatası: ' + (e.message || 'bilinmeyen hata'));
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const s = status?.state;
  const configured = !!status?.meili_configured;
  const enabled = !!status?.meili_enabled;
  // total_titles is a pre-scan estimate; once sync completes current_offset
  // can exceed it. Use the max so the bar never inverts or exceeds 100%.
  const denom = s ? Math.max(s.total_titles || 0, s.current_offset || 0, s.indexed_count || 0) : 0;
  const numer = s ? (s.has_more ? (s.current_offset || 0) : (s.indexed_count || 0)) : 0;
  const pct = denom > 0 ? Math.min(100, Math.round((numer / denom) * 100)) : 0;

  return (
    <div className="rounded-xl border border-border/40 bg-card/40 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-primary" />
        <h2 className="font-heading font-bold text-sm">Search Index (Meilisearch)</h2>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">
        Hapl içeriklerini Meilisearch index'ine senkronlar. Stage 1: sadece index altyapısı —
        arama akışı değişmez. Stage 2 aktif olduğunda <code className="font-mono">MEILI_ENABLED=true</code>{' '}
        ile search-content'e bağlanır.
      </p>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <div className="rounded-md border border-border/40 p-2">
          <div className="text-muted-foreground">Config</div>
          <div className={configured ? 'text-foreground font-medium' : 'text-destructive font-medium'}>
            {configured ? 'OK' : 'Eksik (MEILI_HOST / KEY)'}
          </div>
        </div>
        <div className="rounded-md border border-border/40 p-2">
          <div className="text-muted-foreground">MEILI_ENABLED</div>
          <div className={enabled ? 'text-primary font-medium' : 'text-muted-foreground font-medium'}>
            {enabled ? 'true (Stage 2 canlı)' : 'false (sadece sync)'}
          </div>
        </div>
        <div className="rounded-md border border-border/40 p-2">
          <div className="text-muted-foreground">Index</div>
          <div className="font-mono text-foreground truncate">{status?.index_name ?? '—'}</div>
        </div>
        <div className="rounded-md border border-border/40 p-2">
          <div className="text-muted-foreground">İlerleme</div>
          <div className="text-foreground">
            {s ? `${s.indexed_count} indexed / ~${denom} scanned (%${pct})${s.has_more ? '' : ' ✓'}` : '—'}
          </div>
        </div>
        <div className="rounded-md border border-border/40 p-2">
          <div className="text-muted-foreground">Indexlenen</div>
          <div className="text-foreground">{s?.indexed_count ?? 0}</div>
        </div>
        <div className="rounded-md border border-border/40 p-2">
          <div className="text-muted-foreground">Başarısız</div>
          <div className="text-foreground">{s?.failed_count ?? 0}</div>
        </div>
        <div className="rounded-md border border-border/40 p-2 col-span-2">
          <div className="text-muted-foreground">Son sync</div>
          <div className="text-foreground">
            {s?.last_synced_at ? new Date(s.last_synced_at).toLocaleString('tr-TR') : '—'}
          </div>
        </div>
      </div>

      {s?.last_error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-[11px] text-destructive break-all">
          {s.last_error}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => call('setup_index', 'Index ayarları')}
          disabled={!!busy || !configured}
          className="gap-1 h-8 text-xs"
        >
          {busy === 'setup_index' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Settings2 className="h-3 w-3" />}
          Index Ayarlarını Kur
        </Button>
        <Button
          size="sm"
          onClick={() => call('full_sync_start', 'İlk batch sync')}
          disabled={!!busy || !configured}
          className="gap-1 h-8 text-xs"
        >
          {busy === 'full_sync_start' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          İlk Batch Sync
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => call('full_sync_continue', 'Devam')}
          disabled={!!busy || !configured || !s?.has_more}
          className="gap-1 h-8 text-xs"
        >
          {busy === 'full_sync_continue' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FastForward className="h-3 w-3" />}
          Tek Batch Devam
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={continueBatched}
          disabled={!!busy || !configured || !s?.has_more}
          className="gap-1 h-8 text-xs"
        >
          {busy === 'full_sync_continue_loop' ? <Loader2 className="h-3 w-3 animate-spin" /> : <FastForward className="h-3 w-3" />}
          Sonuna Kadar Sync Et
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={refresh}
          disabled={!!busy}
          className="gap-1 h-8 text-xs"
        >
          <RotateCw className="h-3 w-3" />
          Durumu Yenile
        </Button>
      </div>
    </div>
  );
}
