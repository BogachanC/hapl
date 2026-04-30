import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface StreamingProvider {
  id: string;
  slug: string;
  display_name: string;
  sort_order: number;
}

/**
 * Source of truth for the platform chip filter.
 *
 * Uses `streaming_providers` (the canonical, hapl-managed list) instead of the
 * legacy `platforms` table. The legacy table still exists but contains drift
 * (D-Smart GO, slug mismatches like prime-video / hbo-max / tod) — we don't
 * want any of that surfacing in the UI.
 */
export function useStreamingProviders() {
  return useQuery({
    queryKey: ["streaming_providers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("streaming_providers")
        .select("id, slug, display_name, sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data || []) as StreamingProvider[];
    },
    staleTime: 5 * 60 * 1000,
  });
}
