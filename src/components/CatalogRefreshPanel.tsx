import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Loader2, RefreshCw } from "lucide-react";
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

export const CatalogRefreshPanel = () => {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [lock, setLock] = useState<LockRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [triggering, setTriggering] = useState(false);

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: l }] = await Promise.all([
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
    ]);
    setRuns((r as RunRow[]) || []);
    setLock((l as LockRow | null) || null);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const triggerRefresh = async () => {
    setTriggering(true);
    try {
      // Manual trigger goes through the same edge function; it requires the
      // sync token, which we do NOT ship to the browser. So we call a
      // dedicated admin RPC path instead — for now, instruct via toast.
      toast.info("Cron her gün 03:15 ve 15:15 UTC'de çalışır. Manuel tetikleme için sync token gerekli.");
    } finally {
      setTriggering(false);
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
            TMDB existing-catalog refresh scheduler (twice daily, batch=50)
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

      <Button size="sm" variant="secondary" onClick={triggerRefresh} disabled={triggering}>
        Run small refresh now
      </Button>
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
