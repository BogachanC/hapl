// Single source of truth for TR availability "eligibility".
//
// A title is eligible to appear in public search / home feed / Meili
// (available_in_tr=true) when it has at least one content_availability row
// for region='TR' that matches:
//   - status = 'available'
//   - availability_type in ('stream','free','ads')
//   - confidence >= 0.5
//
// Source (tmdb / manual / provider_rule / firecrawl) is intentionally NOT
// considered — manual / provider_rule / firecrawl rows must keep a title
// eligible. This mirrors the Faz 1 override guard.
//
// All consumers (sync_dirty_titles, full Meili sync collectBatch, search-content
// DB fallback, hapl-home-feed, backfill_ineligible_tombstones) MUST go through
// this module — do not inline divergent filters.

export const ELIGIBLE_REGION = "TR" as const;
export const ELIGIBLE_STATUS = "available" as const;
export const ELIGIBLE_AVAILABILITY_TYPES = ["stream", "free", "ads"] as const;
export const ELIGIBLE_MIN_CONFIDENCE = 0.5;

export interface EligibleAvailRow {
  status: string;
  availability_type: string;
  confidence: number | null;
}

export function isEligibleAvail(a: EligibleAvailRow): boolean {
  if (a.status !== ELIGIBLE_STATUS) return false;
  if (!(ELIGIBLE_AVAILABILITY_TYPES as readonly string[]).includes(a.availability_type)) return false;
  const c = typeof a.confidence === "number" ? a.confidence : 0;
  return c >= ELIGIBLE_MIN_CONFIDENCE;
}

/**
 * Apply the eligibility WHERE clause to a Supabase PostgREST query builder
 * already pointed at `content_availability`. Returns the chained builder so
 * callers can keep adding `.in('title_id', …)` etc.
 */
export function applyEligibilityFilter<T extends {
  eq: (k: string, v: any) => T;
  in: (k: string, v: any) => T;
  gte: (k: string, v: any) => T;
}>(q: T): T {
  return q
    .eq("region", ELIGIBLE_REGION)
    .eq("status", ELIGIBLE_STATUS)
    .in("availability_type", ELIGIBLE_AVAILABILITY_TYPES as unknown as string[])
    .gte("confidence", ELIGIBLE_MIN_CONFIDENCE);
}
