import type { ProviderPlan } from "@/hooks/useProviderPlans";

export function cheapestMonthlyPlan(
  plans: ProviderPlan[],
  providerId: string,
): ProviderPlan | null {
  let best: ProviderPlan | null = null;
  for (const p of plans) {
    if (p.provider_id !== providerId) continue;
    if (p.billing_period !== "monthly") continue;
    if (p.is_promotional) continue;
    if (!p.is_full_catalogue) continue;
    if (!best || p.price_try < best.price_try) best = p;
  }
  return best;
}
