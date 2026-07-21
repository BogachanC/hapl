import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface ProviderPlan {
  id: string;
  provider_id: string;
  code: string;
  display_name: string;
  billing_period: "monthly" | "annual";
  price_try: number;
  monthly_equivalent_try: number;
  has_ads: boolean;
  is_promotional: boolean;
  is_full_catalogue: boolean;
  verified_at: string;
}

export function useProviderPlans() {
  return useQuery({
    queryKey: ["provider_plans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_plans")
        .select(
          "id, provider_id, code, display_name, billing_period, price_try, monthly_equivalent_try, has_ads, is_promotional, is_full_catalogue, verified_at",
        )
        .order("price_try", { ascending: true });
      if (error) throw error;
      return (data || []) as ProviderPlan[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
