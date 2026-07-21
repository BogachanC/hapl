import type { StreamingProvider } from "@/hooks/useStreamingProviders";
import type { ProviderPlan } from "@/hooks/useProviderPlans";
import { cheapestMonthlyPlan } from "./pricing";

export const MIN_WATCHLIST_SIZE = 5;
export const MIN_PROVIDER_ROWS = 250;

const ELIGIBLE_TYPES = new Set(["stream", "free", "ads"]);
const FREEISH_TYPES = new Set(["free", "ads"]);

export type ProviderAuditStatus =
  | "ok"
  | "insufficient_data"
  | "bundle_exempt"
  | "price_unknown";

export type ProviderVerdict = "keep" | "review" | "cancel" | null;

export interface ProviderAudit {
  providerId: string;
  slug: string;
  displayName: string;
  monthlyPrice: number | null;
  planCode: string | null;
  coveredCount: number;
  uniqueCount: number;
  status: ProviderAuditStatus;
  verdict: ProviderVerdict;
}

export interface AuditResult {
  insufficientWatchlist: boolean;
  watchlistSize: number;
  providers: ProviderAudit[];
  coveredTitles: number;
  gapTitles: number;
  awaitingDataTitles: number;
  totalMonthlySpend: number;
  wastedMonthlySpend: number;
}

export function computeAudit(input: {
  watchlistTitleIds: string[];
  subscribedProviderIds: string[];
  availabilityRows: {
    title_id: string;
    provider_id: string;
    availability_type: string;
  }[];
  providers: StreamingProvider[];
  plans: ProviderPlan[];
  providerRowCounts: Record<string, number>;
}): AuditResult {
  const {
    watchlistTitleIds,
    subscribedProviderIds,
    availabilityRows,
    providers,
    plans,
    providerRowCounts,
  } = input;

  const watchlistSize = watchlistTitleIds.length;

  if (watchlistSize < MIN_WATCHLIST_SIZE) {
    return {
      insufficientWatchlist: true,
      watchlistSize,
      providers: [],
      coveredTitles: 0,
      gapTitles: 0,
      awaitingDataTitles: 0,
      totalMonthlySpend: 0,
      wastedMonthlySpend: 0,
    };
  }

  const providerMap = new Map<string, StreamingProvider>();
  for (const p of providers) providerMap.set(p.id, p);

  const subscribedSet = new Set(subscribedProviderIds);
  const watchlistSet = new Set(watchlistTitleIds);

  // Build coverage maps from eligible rows only
  // titleProviders: title_id → Set<provider_id> (all providers, not just subscribed)
  const titleProviders = new Map<string, Set<string>>();
  // titleHasFreeish: title_id → true if any row is free/ads
  const titleHasFreeish = new Set<string>();

  for (const row of availabilityRows) {
    if (!ELIGIBLE_TYPES.has(row.availability_type)) continue;
    if (!watchlistSet.has(row.title_id)) continue;

    let provSet = titleProviders.get(row.title_id);
    if (!provSet) {
      provSet = new Set();
      titleProviders.set(row.title_id, provSet);
    }
    provSet.add(row.provider_id);

    if (FREEISH_TYPES.has(row.availability_type)) {
      titleHasFreeish.add(row.title_id);
    }
  }

  // Classify each watchlist title into buckets
  let coveredTitles = 0;
  let gapTitles = 0;
  let awaitingDataTitles = 0;

  // Per-provider: covered titles and unique titles
  const provCovered = new Map<string, Set<string>>();
  const provUnique = new Map<string, Set<string>>();
  for (const pid of subscribedProviderIds) {
    provCovered.set(pid, new Set());
    provUnique.set(pid, new Set());
  }

  for (const titleId of watchlistTitleIds) {
    const provSet = titleProviders.get(titleId);

    if (!provSet) {
      awaitingDataTitles++;
      continue;
    }

    // Which subscribed providers cover this title?
    const subscribedCovering: string[] = [];
    for (const pid of subscribedProviderIds) {
      if (provSet.has(pid)) {
        subscribedCovering.push(pid);
        provCovered.get(pid)!.add(titleId);
      }
    }

    if (subscribedCovering.length > 0) {
      coveredTitles++;

      // Unique: exactly one subscribed provider covers it, AND not freeish
      if (subscribedCovering.length === 1 && !titleHasFreeish.has(titleId)) {
        provUnique.get(subscribedCovering[0])!.add(titleId);
      }
    } else {
      gapTitles++;
    }
  }

  // Build per-provider audit entries
  const providerAudits: ProviderAudit[] = [];
  let totalMonthlySpend = 0;
  let wastedMonthlySpend = 0;

  for (const pid of subscribedProviderIds) {
    const sp = providerMap.get(pid);
    const slug = sp?.slug ?? "";
    const displayName = sp?.display_name ?? slug;

    const coveredCount = provCovered.get(pid)?.size ?? 0;
    const uniqueCount = provUnique.get(pid)?.size ?? 0;

    const plan = cheapestMonthlyPlan(plans, pid);
    const monthlyPrice = plan ? plan.price_try : null;
    const planCode = plan ? plan.code : null;

    // Determine status
    let status: ProviderAuditStatus = "ok";
    if (sp?.is_bundle) {
      status = "bundle_exempt";
    } else if ((providerRowCounts[pid] ?? 0) < MIN_PROVIDER_ROWS) {
      status = "insufficient_data";
    } else if (monthlyPrice === null) {
      status = "price_unknown";
    }

    // Verdict only when status is ok
    let verdict: ProviderVerdict = null;
    if (status === "ok") {
      if (uniqueCount > 0) verdict = "keep";
      else if (coveredCount > 0) verdict = "review";
      else verdict = "cancel";

      if (monthlyPrice !== null) {
        totalMonthlySpend += monthlyPrice;
        if (verdict === "cancel") wastedMonthlySpend += monthlyPrice;
      }
    }

    providerAudits.push({
      providerId: pid,
      slug,
      displayName,
      monthlyPrice,
      planCode,
      coveredCount,
      uniqueCount,
      status,
      verdict,
    });
  }

  return {
    insufficientWatchlist: false,
    watchlistSize,
    providers: providerAudits,
    coveredTitles,
    gapTitles,
    awaitingDataTitles,
    totalMonthlySpend,
    wastedMonthlySpend,
  };
}
