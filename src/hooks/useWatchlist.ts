import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface WatchlistItem {
  id: string;
  title_id: string;
  created_at: string;
}

const QUERY_KEY = "watchlist";

export function useWatchlist() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: watchlist = [], ...queryRest } = useQuery({
    queryKey: [QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("watchlist_items")
        .select("id, title_id, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as WatchlistItem[];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const titleIdSet = new Set(watchlist.map((w) => w.title_id));

  const addMutation = useMutation({
    mutationFn: async (titleId: string) => {
      const { error } = await supabase
        .from("watchlist_items")
        .insert({ user_id: user!.id, title_id: titleId });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const removeMutation = useMutation({
    mutationFn: async (titleId: string) => {
      const { error } = await supabase
        .from("watchlist_items")
        .delete()
        .eq("user_id", user!.id)
        .eq("title_id", titleId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const isInWatchlist = (titleId: string): boolean => titleIdSet.has(titleId);

  const addToWatchlist = (titleId: string) => addMutation.mutate(titleId);

  const removeFromWatchlist = (titleId: string) => removeMutation.mutate(titleId);

  return {
    watchlist,
    ...queryRest,
    addToWatchlist,
    removeFromWatchlist,
    isInWatchlist,
    adding: addMutation.isPending,
    removing: removeMutation.isPending,
  };
}
