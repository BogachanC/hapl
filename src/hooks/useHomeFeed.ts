import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ContentResult } from "./useContentSearch";

export type FeedCategory = "all" | "movie" | "tv" | "documentary";
export type FeedSort = "quality" | "recent" | "popular";

interface UseHomeFeedArgs {
  category?: FeedCategory;
  provider?: string | null;
  enabled?: boolean;
  pageSize?: number;
  maxItems?: number;
}

interface FeedState {
  results: ContentResult[];
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  total: number;
  hasMore: boolean;
}

const DEFAULT_PAGE_SIZE = 36;
const DEFAULT_MAX_ITEMS = 120;

/**
 * DB-backed home feed with cursor-style pagination, capped at `maxItems`.
 * Refilters whenever category/provider changes.
 */
export function useHomeFeed({
  category = "all",
  provider = null,
  enabled = true,
  pageSize = DEFAULT_PAGE_SIZE,
  maxItems = DEFAULT_MAX_ITEMS,
}: UseHomeFeedArgs) {
  const [state, setState] = useState<FeedState>({
    results: [],
    loading: false,
    loadingMore: false,
    error: null,
    total: 0,
    hasMore: false,
  });

  // Stable seed per (category, provider) tuple so pagination is deterministic
  // and we don't re-shuffle between page fetches.
  const seedRef = useRef<number>(Math.floor(Math.random() * 1_000_000));
  const seenIdsRef = useRef<Set<string>>(new Set());

  const fetchPage = useCallback(
    async (offset: number, isInitial: boolean) => {
      if (!enabled) return;
      setState((s) => ({
        ...s,
        loading: isInitial,
        loadingMore: !isInitial,
        error: null,
      }));
      try {
        const { data, error } = await supabase.functions.invoke("hapl-home-feed", {
          body: {
            category,
            provider,
            limit: pageSize,
            offset,
            sort: "quality",
            seed: seedRef.current,
          },
        });
        if (error) throw new Error(error.message);
        const incoming = (data?.results || []) as ContentResult[];
        const total = Number(data?.total ?? 0);

        // Dedupe across pages (id + type composite — same as card key).
        const fresh: ContentResult[] = [];
        for (const item of incoming) {
          const k = `${item.type}-${item.id}`;
          if (seenIdsRef.current.has(k)) continue;
          seenIdsRef.current.add(k);
          fresh.push(item);
        }

        setState((s) => {
          const merged = isInitial ? fresh : [...s.results, ...fresh];
          const capped = merged.slice(0, maxItems);
          const hasMore = capped.length < Math.min(total, maxItems) && incoming.length > 0;
          return {
            results: capped,
            loading: false,
            loadingMore: false,
            error: null,
            total,
            hasMore,
          };
        });
      } catch (err: any) {
        setState((s) => ({
          ...s,
          loading: false,
          loadingMore: false,
          error: err?.message || "Feed yüklenemedi",
        }));
      }
    },
    [category, provider, enabled, pageSize, maxItems],
  );

  // Initial load + reset on filter change
  useEffect(() => {
    if (!enabled) return;
    seedRef.current = Math.floor(Math.random() * 1_000_000);
    seenIdsRef.current = new Set();
    setState({
      results: [],
      loading: true,
      loadingMore: false,
      error: null,
      total: 0,
      hasMore: false,
    });
    fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, provider, enabled]);

  const loadMore = useCallback(() => {
    setState((s) => {
      if (s.loading || s.loadingMore || !s.hasMore) return s;
      // Fire async fetch outside the setter
      void fetchPage(s.results.length, false);
      return { ...s, loadingMore: true };
    });
  }, [fetchPage]);

  return { ...state, loadMore };
}
