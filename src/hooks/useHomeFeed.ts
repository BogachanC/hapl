import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ContentResult } from "./useContentSearch";

export type FeedCategory = "all" | "movie" | "tv" | "documentary";
export type FeedSort = "quality" | "recent" | "popular";

interface UseHomeFeedArgs {
  category?: FeedCategory;
  provider?: string | null;
  enabled?: boolean;
  limit?: number;
}

interface FeedState {
  results: ContentResult[];
  loading: boolean;
  error: string | null;
  total: number;
}

/**
 * DB-backed home feed (no TMDB calls). Returned items are shape-compatible
 * with `ContentResult` so we can re-use the existing SearchResults card.
 */
export function useHomeFeed({
  category = "all",
  provider = null,
  enabled = true,
  limit = 24,
}: UseHomeFeedArgs) {
  const [state, setState] = useState<FeedState>({
    results: [],
    loading: false,
    error: null,
    total: 0,
  });

  const fetchFeed = useCallback(async () => {
    if (!enabled) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data, error } = await supabase.functions.invoke("hapl-home-feed", {
        body: { category, provider, limit, sort: "quality" },
      });
      if (error) throw new Error(error.message);
      setState({
        results: (data?.results || []) as ContentResult[],
        loading: false,
        error: null,
        total: data?.total ?? 0,
      });
    } catch (err: any) {
      setState({
        results: [],
        loading: false,
        error: err?.message || "Feed yüklenemedi",
        total: 0,
      });
    }
  }, [category, provider, enabled, limit]);

  useEffect(() => { fetchFeed(); }, [fetchFeed]);

  return { ...state, refresh: fetchFeed };
}
