import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface UserSubscription {
  id: string;
  provider_id: string;
  slug: string;
  display_name: string;
  is_local: boolean;
  created_at: string;
}

const QUERY_KEY = "user_subscriptions";

export function useUserSubscriptions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: subscriptions = [], ...queryRest } = useQuery({
    queryKey: [QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_subscriptions")
        .select(
          "id, provider_id, created_at, streaming_providers(slug, display_name, is_local)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []).map((row: any) => ({
        id: row.id,
        provider_id: row.provider_id,
        slug: row.streaming_providers.slug,
        display_name: row.streaming_providers.display_name,
        is_local: row.streaming_providers.is_local,
        created_at: row.created_at,
      })) as UserSubscription[];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const providerIdSet = new Set(subscriptions.map((s) => s.provider_id));
  const slugSet = new Set(subscriptions.map((s) => s.slug));

  const subscribeMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const { error } = await supabase
        .from("user_subscriptions")
        .insert({ user_id: user!.id, provider_id: providerId });
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const unsubscribeMutation = useMutation({
    mutationFn: async (providerId: string) => {
      const { error } = await supabase
        .from("user_subscriptions")
        .delete()
        .eq("user_id", user!.id)
        .eq("provider_id", providerId);
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const isSubscribed = (providerId: string): boolean =>
    providerIdSet.has(providerId);

  const isSubscribedBySlug = (slug: string): boolean => slugSet.has(slug);

  const subscribe = (providerId: string) =>
    subscribeMutation.mutate(providerId);

  const unsubscribe = (providerId: string) =>
    unsubscribeMutation.mutate(providerId);

  return {
    subscriptions,
    providerIdSet,
    slugSet,
    ...queryRest,
    subscribe,
    unsubscribe,
    isSubscribed,
    isSubscribedBySlug,
    subscribing: subscribeMutation.isPending,
    unsubscribing: unsubscribeMutation.isPending,
  };
}
