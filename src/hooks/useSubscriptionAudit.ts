import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";
import { useWatchlist } from "./useWatchlist";
import { useUserSubscriptions } from "./useUserSubscriptions";
import { useStreamingProviders } from "./useStreamingProviders";
import { useProviderPlans } from "./useProviderPlans";
import { computeAudit, MIN_WATCHLIST_SIZE, type AuditResult } from "@/lib/audit";

export function useSubscriptionAudit() {
  const { user } = useAuth();
  const { watchlist, isLoading: watchlistLoading } = useWatchlist();
  const { subscriptions, isLoading: subsLoading } = useUserSubscriptions();
  const { data: providers, isLoading: providersLoading } = useStreamingProviders();
  const { data: plans, isLoading: plansLoading } = useProviderPlans();

  const watchlistTitleIds = watchlist.map((w) => w.title_id);
  const subscribedProviderIds = subscriptions.map((s) => s.provider_id);

  const depsReady =
    !!user &&
    !watchlistLoading &&
    !subsLoading &&
    !providersLoading &&
    !plansLoading &&
    !!providers &&
    !!plans;

  const hasEnoughTitles = watchlistTitleIds.length >= MIN_WATCHLIST_SIZE;
  const hasSubscriptions = subscribedProviderIds.length > 0;

  const {
    data: auditResult = null,
    isLoading: auditLoading,
    error,
  } = useQuery({
    queryKey: [
      "subscription_audit",
      user?.id,
      watchlistTitleIds.sort().join(","),
      subscribedProviderIds.sort().join(","),
    ],
    queryFn: async (): Promise<AuditResult> => {
      if (!hasEnoughTitles) {
        return computeAudit({
          watchlistTitleIds,
          subscribedProviderIds,
          availabilityRows: [],
          providers: providers!,
          plans: plans!,
          providerRowCounts: {},
        });
      }

      if (!hasSubscriptions) {
        return computeAudit({
          watchlistTitleIds,
          subscribedProviderIds: [],
          availabilityRows: [],
          providers: providers!,
          plans: plans!,
          providerRowCounts: {},
        });
      }

      const [availResult, statsResult] = await Promise.all([
        fetchAvailabilityRows(watchlistTitleIds),
        fetchProviderStats(),
      ]);

      return computeAudit({
        watchlistTitleIds,
        subscribedProviderIds,
        availabilityRows: availResult,
        providers: providers!,
        plans: plans!,
        providerRowCounts: statsResult,
      });
    },
    enabled: depsReady,
    staleTime: 2 * 60 * 1000,
  });

  if (auditResult) {
    console.log("[useSubscriptionAudit] result:", JSON.stringify(auditResult, null, 2));
  }

  return {
    data: auditResult,
    isLoading: !depsReady || auditLoading,
    error,
  };
}

async function fetchAvailabilityRows(
  titleIds: string[],
): Promise<{ title_id: string; provider_id: string; availability_type: string }[]> {
  if (titleIds.length === 0) return [];

  const rows: { title_id: string; provider_id: string; availability_type: string }[] = [];
  const CHUNK = 80;

  for (let i = 0; i < titleIds.length; i += CHUNK) {
    const slice = titleIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("content_availability")
      .select("title_id, provider_id, availability_type")
      .eq("region", "TR")
      .eq("status", "available")
      .in("availability_type", ["stream", "free", "ads"])
      .gte("confidence", 0.5)
      .in("title_id", slice);
    if (error) throw error;
    if (data) rows.push(...(data as any));
  }

  return rows;
}

async function fetchProviderStats(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("provider_coverage_stats")
    .select("provider_id, eligible_rows");
  if (error) throw error;

  const counts: Record<string, number> = {};
  for (const row of data || []) {
    counts[row.provider_id] = row.eligible_rows;
  }
  return counts;
}
