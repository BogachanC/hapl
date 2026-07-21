import { Link } from 'react-router-dom';
import { ArrowLeft, Bookmark, Layers, Loader2, PiggyBank } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useSubscriptionAudit } from '@/hooks/useSubscriptionAudit';
import { useProviderPlans } from '@/hooks/useProviderPlans';
import { formatTRY } from '@/lib/format';
import { getPlatformStyle } from '@/lib/platform-colors';
import type { ProviderAudit } from '@/lib/audit';
import { cn } from '@/lib/utils';

const VERDICT_ORDER: Record<string, number> = { cancel: 0, review: 1, keep: 2 };

function sortProviders(providers: ProviderAudit[]): ProviderAudit[] {
  return [...providers].sort((a, b) => {
    const aOk = a.status === 'ok';
    const bOk = b.status === 'ok';
    if (aOk && !bOk) return -1;
    if (!aOk && bOk) return 1;
    if (aOk && bOk) {
      return (VERDICT_ORDER[a.verdict ?? ''] ?? 9) - (VERDICT_ORDER[b.verdict ?? ''] ?? 9);
    }
    return 0;
  });
}

function formatVerifiedDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
}

const Savings = () => {
  const { user, loading: authLoading } = useAuth();
  const { data: audit, isLoading: auditLoading } = useSubscriptionAudit();
  const { data: plans } = useProviderPlans();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-lg mx-auto px-4 py-16 text-center space-y-4">
          <PiggyBank className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Tasarruf analizini görmek için giriş yap.
          </p>
          <Link to="/auth">
            <Button variant="default" size="sm">Giriş Yap</Button>
          </Link>
        </main>
      </div>
    );
  }

  if (auditLoading || !audit) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-lg mx-auto px-4 py-4 space-y-6">
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        </main>
      </div>
    );
  }

  if (audit.insufficientWatchlist) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-lg mx-auto px-4 py-16 text-center space-y-4">
          <Bookmark className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <h2 className="text-sm font-bold text-foreground">Listen henüz çok kısa</h2>
          <p className="text-sm text-muted-foreground">
            Denetimin anlamlı olması için listende en az 5 başlık olmalı. Şu an {audit.watchlistSize} başlık var.
          </p>
          <Link to="/watchlist">
            <Button variant="default" size="sm">Listeye Git</Button>
          </Link>
        </main>
      </div>
    );
  }

  if (audit.providers.length === 0) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-lg mx-auto px-4 py-16 text-center space-y-4">
          <Layers className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Henüz bir abonelik eklemedin. Aboneliklerini işaretle, denetimi görelim.
          </p>
          <Link to="/subscriptions">
            <Button variant="default" size="sm">Üyeliklerim</Button>
          </Link>
        </main>
      </div>
    );
  }

  const sorted = sortProviders(audit.providers);

  const usedPlanCodes = new Set(
    audit.providers.map((p) => p.planCode).filter(Boolean) as string[],
  );
  const latestVerified = (plans || [])
    .filter((p) => usedPlanCodes.has(p.code))
    .map((p) => p.verified_at)
    .sort()
    .pop();

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-lg mx-auto px-4 py-4 space-y-6">
        <SummaryBlock
          totalMonthlySpend={audit.totalMonthlySpend}
          wastedMonthlySpend={audit.wastedMonthlySpend}
          unpricedProviderCount={audit.unpricedProviderCount}
        />

        <div className="space-y-2.5">
          <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
            Platformlar
          </h3>
          <div className="space-y-2">
            {sorted.map((p) => (
              <ProviderRow key={p.providerId} provider={p} />
            ))}
          </div>
        </div>

        <CoverageSummary
          coveredTitles={audit.coveredTitles}
          gapTitles={audit.gapTitles}
          awaitingDataTitles={audit.awaitingDataTitles}
        />

        {latestVerified && (
          <p className="text-[10px] text-muted-foreground/60 text-center">
            Fiyatlar {formatVerifiedDate(latestVerified)} tarihinde doğrulandı.
          </p>
        )}
      </main>
    </div>
  );
};

function Header() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
      <div className="container max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
        <Link to="/account">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="font-heading text-lg font-bold text-foreground">Tasarruf</h1>
      </div>
    </header>
  );
}

function SummaryBlock({
  totalMonthlySpend,
  wastedMonthlySpend,
  unpricedProviderCount,
}: {
  totalMonthlySpend: number;
  wastedMonthlySpend: number;
  unpricedProviderCount: number;
}) {
  return (
    <div className="p-4 rounded-xl bg-card border border-border/50 space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">Aylık toplam</p>
          <p className="text-lg font-bold text-foreground">{formatTRY(totalMonthlySpend)}</p>
        </div>
        {wastedMonthlySpend > 0 && (
          <div className="text-right">
            <p className="text-[11px] text-destructive/80">Boşa giden</p>
            <p className="text-lg font-bold text-destructive">{formatTRY(wastedMonthlySpend)}</p>
          </div>
        )}
      </div>
      {unpricedProviderCount > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {unpricedProviderCount} platform için fiyat bilgisi yok.
        </p>
      )}
      {wastedMonthlySpend === 0 && unpricedProviderCount === 0 && (
        <p className="text-xs text-muted-foreground">
          Aboneliklerinin hepsi listende karşılığı olan içerik sunuyor.
        </p>
      )}
    </div>
  );
}

function ProviderRow({ provider }: { provider: ProviderAudit }) {
  const style = getPlatformStyle(provider.slug);

  if (provider.status !== 'ok') {
    const statusText: Record<string, string> = {
      insufficient_data: 'Kapsama verisi yetersiz — değerlendirilemiyor',
      bundle_exempt: 'Paket aboneliği — tek başına değerlendirilemiyor',
      price_unknown: 'Fiyat bilgisi yok — değerlendirilemiyor',
    };
    return (
      <div className="p-3 rounded-xl bg-card border border-border/50">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wide uppercase min-w-[72px] text-center',
              style.bg,
              style.text,
            )}
          >
            {provider.displayName}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] text-muted-foreground">
              {statusText[provider.status] ?? 'Değerlendirilemiyor'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const verdictConfig = {
    cancel: {
      label: 'İptal adayı',
      labelClass: 'text-destructive bg-destructive/10',
      borderClass: 'border-destructive/30',
      body: `${formatTRY(provider.monthlyPrice)} ödüyorsun ama listendeki hiçbir başlığı karşılamıyor.`,
      showPrice: false,
    },
    review: {
      label: 'Gözden geçir',
      labelClass: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
      borderClass: 'border-amber-500/30',
      body: `${provider.coveredCount} başlığı karşılıyor ama hiçbirini tek başına karşılamıyor — iptal edersen bir şey kaybetmezsin.`,
      showPrice: true,
    },
    keep: {
      label: 'Tut',
      labelClass: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
      borderClass: 'border-emerald-500/30',
      body: `${provider.coveredCount} başlığı karşılıyor, ${provider.uniqueCount} tanesini tek başına.`,
      showPrice: true,
    },
  } as const;

  const v = provider.verdict;
  if (!v) return null;
  const cfg = verdictConfig[v];

  return (
    <div className={cn('p-3 rounded-xl bg-card border', cfg.borderClass)}>
      <div className="flex items-center gap-3 mb-2">
        <div
          className={cn(
            'shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wide uppercase min-w-[72px] text-center',
            style.bg,
            style.text,
          )}
        >
          {provider.displayName}
        </div>
        <div className="flex-1" />
        <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', cfg.labelClass)}>
          {cfg.label}
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] text-muted-foreground flex-1">{cfg.body}</p>
        {cfg.showPrice && (
          <p className="text-xs font-medium text-foreground shrink-0 ml-2">
            {formatTRY(provider.monthlyPrice)}
          </p>
        )}
      </div>
    </div>
  );
}

function CoverageSummary({
  coveredTitles,
  gapTitles,
  awaitingDataTitles,
}: {
  coveredTitles: number;
  gapTitles: number;
  awaitingDataTitles: number;
}) {
  return (
    <div className="space-y-2.5">
      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
        Liste kapsaması
      </h3>
      <div className="p-3 rounded-xl bg-card border border-border/50 space-y-1.5">
        <p className="text-xs text-foreground">
          {coveredTitles} başlık karşılanıyor
        </p>
        {gapTitles > 0 && (
          <p className="text-xs text-muted-foreground">
            {gapTitles} başlık hiçbir aboneliğinde yok
          </p>
        )}
        {awaitingDataTitles > 0 && (
          <p className="text-xs text-muted-foreground">
            {awaitingDataTitles} başlık için veri bekleniyor
          </p>
        )}
      </div>
    </div>
  );
}

export default Savings;
