import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw, Zap, Compass } from "lucide-react";
import { toast } from "sonner";


type RunRow = {
  id: string;
  job_name: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  processed: number;
  changed: number;
  dirty_enqueued: number;
  override_skips: number;
  failed: number;
  last_error: string | null;
};

type LockRow = {
  lock_name: string;
  locked_at: string;
  expires_at: string;
  owner: string | null;
};

type DirtyStats = {
  open_count: number;
  failed_count: number;
  last_processed_at: string | null;
  last_error: { last_error: string; attempts: number; title_id: string } | null;
};

export const CatalogRefreshPanel = () => {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [lock, setLock] = useState<LockRow | null>(null);
  const [dirty, setDirty] = useState<DirtyStats | null>(null);
  const [discoveryRuns, setDiscoveryRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [dProvider, setDProvider] = useState("netflix");
  const [dMedia, setDMedia] = useState<"movie" | "tv">("movie");
  const [dSort, setDSort] = useState("popularity.desc");
  const [dPages, setDPages] = useState(1);
  const [dDryRun, setDDryRun] = useState(true);
  const [dProcessAfter, setDProcessAfter] = useState(false);
  const [lastDiscovery, setLastDiscovery] = useState<any>(null);
  const [smokeRunning, setSmokeRunning] = useState(false);
  const [smoke, setSmoke] = useState<any>(null);


  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: l }, dirtyRes, { data: dr }] = await Promise.all([
      supabase
        .from("catalog_job_runs")
        .select("*")
        .eq("job_name", "refresh_existing")
        .order("started_at", { ascending: false })
        .limit(10),
      supabase
        .from("catalog_job_locks")
        .select("*")
        .eq("lock_name", "hapl_refresh")
        .maybeSingle(),
      supabase.functions.invoke("hapl-sync-search-index", { body: { action: "dirty_stats" } }),
      supabase
        .from("catalog_job_runs")
        .select("*")
        .eq("job_name", "provider_discovery_delta")
        .order("started_at", { ascending: false })
        .limit(8),
    ]);
    setRuns((r as RunRow[]) || []);
    setLock((l as LockRow | null) || null);
    if (dirtyRes.data?.ok) setDirty(dirtyRes.data as DirtyStats);
    setDiscoveryRuns((dr as any[]) || []);
    setLoading(false);
  };


  useEffect(() => {
    load();
  }, []);

  const processDirty = async () => {
    setProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke("hapl-sync-search-index", {
        body: { action: "sync_dirty_titles", limit: 50 },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.upsert_error || data?.error || "failed");
      toast.success(`Processed: ${data.processed}, failed: ${data.failed}, cache cleared: ${data.cache_cleared}`);
      await load();
    } catch (e: any) {
      toast.error("Dirty process hatası: " + (e.message || "bilinmeyen"));
    } finally {
      setProcessing(false);
    }
  };

  const runDiscovery = async () => {
    setDiscovering(true);
    setLastDiscovery(null);
    try {
      const { data, error } = await supabase.functions.invoke("hapl-seed-catalog", {
        body: {
          action: "provider_discovery_delta",
          provider_slug: dProvider,
          media_type: dMedia,
          sort_by: dSort,
          page_limit: dPages,
          dry_run: dDryRun,
        },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "discovery failed");
      setLastDiscovery(data);
      const c = data.counters || {};
      toast.success(
        `${dDryRun ? "Dry-run" : "Apply"} · scanned=${c.scanned} verified=${c.verified} ` +
        (dDryRun ? "" : `inserted=${c.inserted_titles} updated=${c.updated_titles} dirty=${c.dirty_enqueued}`),
      );
      await load();
    } catch (e: any) {
      toast.error("Discovery hatası: " + (e.message || "bilinmeyen"));
    } finally {
      setDiscovering(false);
    }
  };


  const lockActive = lock && new Date(lock.expires_at) > new Date();
  const last = runs[0];

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Catalog Refresh</h2>
          <p className="text-xs text-muted-foreground">
            TMDB refresh (twice daily, batch=50) + Meili dirty consumer
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <Stat label="Lock" value={lockActive ? "ACTIVE" : "free"} tone={lockActive ? "warn" : "ok"} />
        <Stat label="Last status" value={last ? (last.ok ? "ok" : "failed") : "—"} tone={!last ? "muted" : last.ok ? "ok" : "err"} />
        <Stat label="Processed" value={last ? String(last.processed) : "—"} />
        <Stat label="Dirty enqueued" value={last ? String(last.dirty_enqueued) : "—"} />
      </div>

      <div className="rounded-md border border-border/60 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Dirty queue (Meili consumer)</h3>
          <Button size="sm" variant="secondary" onClick={processDirty} disabled={processing} className="gap-1">
            {processing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
            Process dirty now
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <Stat label="Open" value={dirty ? String(dirty.open_count) : "—"} tone={dirty && dirty.open_count > 0 ? "warn" : "ok"} />
          <Stat label="Failed (>=5)" value={dirty ? String(dirty.failed_count) : "—"} tone={dirty && dirty.failed_count > 0 ? "err" : "ok"} />
          <Stat
            label="Last sync"
            value={dirty?.last_processed_at ? new Date(dirty.last_processed_at).toLocaleString("tr-TR") : "—"}
          />
        </div>
        {dirty?.last_error && (
          <p className="text-xs text-destructive break-all">
            attempts={dirty.last_error.attempts} · {dirty.last_error.last_error.slice(0, 160)}
          </p>
        )}
      </div>

      <div className="space-y-1">
        <h3 className="text-sm font-medium">Recent runs</h3>
        <div className="text-xs space-y-1 max-h-64 overflow-y-auto">
          {runs.length === 0 && <p className="text-muted-foreground">Henüz çalışma yok.</p>}
          {runs.map((r) => (
            <div key={r.id} className="flex items-center justify-between border-b border-border/40 py-1">
              <span className="text-muted-foreground">
                {new Date(r.started_at).toLocaleString("tr-TR")}
              </span>
              <span className={r.ok ? "text-emerald-500" : "text-destructive"}>
                p={r.processed} c={r.changed} d={r.dirty_enqueued} f={r.failed} skip={r.override_skips}
                {r.last_error ? ` · ${r.last_error.slice(0, 40)}` : ""}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Phase 6: Provider Discovery ──────────────────────────── */}
      <div className="rounded-md border border-border/60 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Compass className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">Provider Discovery (delta)</h3>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Provider</span>
            <select className="bg-background border border-border rounded px-2 py-1" value={dProvider} onChange={(e) => setDProvider(e.target.value)}>
              <option value="netflix">Netflix</option>
              <option value="disney-plus">Disney+</option>
              <option value="amazon-prime-video">Amazon Prime</option>
              <option value="max">HBO Max</option>
              <option value="mubi">MUBI</option>
              <option value="tv-plus">TV+</option>
              <option value="tod-tv">TOD TV</option>
              <option value="tabii">tabii</option>
              <option value="gain">GAIN</option>
              <option value="puhutv">PuhuTV</option>
              <option value="exxen">EXXEN</option>
              <option value="bein-connect">beIN CONNECT</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Media</span>
            <select className="bg-background border border-border rounded px-2 py-1" value={dMedia} onChange={(e) => setDMedia(e.target.value as "movie" | "tv")}>
              <option value="movie">movie</option>
              <option value="tv">tv</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Sort</span>
            <select className="bg-background border border-border rounded px-2 py-1" value={dSort} onChange={(e) => setDSort(e.target.value)}>
              <option value="popularity.desc">popularity.desc</option>
              <option value="release_date.desc">release_date.desc</option>
              <option value="vote_count.desc">vote_count.desc</option>
              <option value="vote_average.desc">vote_average.desc</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-muted-foreground">Pages (1–5)</span>
            <input type="number" min={1} max={5} className="bg-background border border-border rounded px-2 py-1" value={dPages} onChange={(e) => setDPages(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={dDryRun} onChange={(e) => setDDryRun(e.target.checked)} />
            Dry-run (no writes)
          </label>
          <Button size="sm" variant={dDryRun ? "secondary" : "default"} onClick={runDiscovery} disabled={discovering} className="gap-1">
            {discovering ? <Loader2 className="w-3 h-3 animate-spin" /> : <Compass className="w-3 h-3" />}
            {dDryRun ? "Run dry-run" : "Apply discovery"}
          </Button>
        </div>

        {lastDiscovery?.counters && (
          <div className="text-xs space-y-1">
            <div className="font-mono text-muted-foreground">
              scanned={lastDiscovery.counters.scanned} verified={lastDiscovery.counters.verified}
              {!lastDiscovery.dry_run && (
                <> · inserted={lastDiscovery.counters.inserted_titles} updated={lastDiscovery.counters.updated_titles} avail={lastDiscovery.counters.availability_rows} dirty={lastDiscovery.counters.dirty_enqueued} aliases={lastDiscovery.counters.aliases_added}</>
              )}
              {" · "}skip(noPoster)={lastDiscovery.counters.skipped_no_poster} skip(unverified)={lastDiscovery.counters.skipped_unverified}
              {!lastDiscovery.dry_run && <> skip(override)={lastDiscovery.counters.skipped_override_guard} skip(protected)={lastDiscovery.counters.skipped_protected_source}</>}
              {" · "}failed={lastDiscovery.counters.failed}
            </div>
            {lastDiscovery.dry_run && Array.isArray(lastDiscovery.candidates_sample) && lastDiscovery.candidates_sample.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground">Candidates ({lastDiscovery.candidates_sample.length})</summary>
                <ul className="pl-3 mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                  {lastDiscovery.candidates_sample.map((c: any) => (
                    <li key={`${c.tmdb_type}-${c.tmdb_id}`} className="text-muted-foreground">
                      {c.tmdb_type} #{c.tmdb_id} · {c.title} {c.year ? `(${c.year})` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}

        <div className="space-y-1">
          <h4 className="text-[11px] uppercase text-muted-foreground">Recent discovery runs</h4>
          <div className="text-xs space-y-1 max-h-48 overflow-y-auto">
            {discoveryRuns.length === 0 && <p className="text-muted-foreground">Henüz discovery run yok.</p>}
            {discoveryRuns.map((r: any) => {
              const p = r.payload || {};
              const c = p.counters || {};
              return (
                <div key={r.id} className="flex items-center justify-between border-b border-border/40 py-1 gap-2">
                  <span className="text-muted-foreground truncate">
                    {new Date(r.started_at).toLocaleString("tr-TR")} · {p.provider_slug}/{p.media_type}/{p.sort_by} p={p.page_limit}{p.dry_run ? " · dry" : ""}
                  </span>
                  <span className={r.ok ? "text-emerald-500" : "text-destructive"}>
                    s={c.scanned ?? r.processed} v={c.verified ?? "-"} ins={c.inserted_titles ?? "-"} upd={c.updated_titles ?? "-"} f={r.failed}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
};


const Stat = ({ label, value, tone = "muted" }: { label: string; value: string; tone?: "ok" | "warn" | "err" | "muted" }) => {
  const color =
    tone === "ok" ? "text-emerald-500" :
    tone === "warn" ? "text-amber-500" :
    tone === "err" ? "text-destructive" : "text-foreground";
  return (
    <div className="rounded border border-border/60 p-2">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className={`font-mono text-sm ${color}`}>{value}</div>
    </div>
  );
};
