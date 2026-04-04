import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Platform {
  id?: number;
  name: string;
  logo: string | null;
  type: "subscription" | "rent" | "free";
  link: string | null;
  source?: "tmdb" | "firecrawl";
}

export interface ContentResult {
  id: number;
  type: "movie" | "tv";
  title: string;
  year: number | null;
  overview: string;
  poster: string | null;
  backdrop: string | null;
  imdb_rating: number | null;
  vote_count: number;
  genres: string[];
  platforms: Platform[];
  tmdb_url: string;
  available_in_tr: boolean;
}

interface SearchState {
  results: ContentResult[];
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
}

export function useContentSearch() {
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
  });

  const search = useCallback(async (query: string) => {
    if (!query.trim()) return;

    setState((prev) => ({ ...prev, loading: true, error: null, hasSearched: true }));

    try {
      const { data, error } = await supabase.functions.invoke("search-content", {
        body: { query: query.trim() },
      });

      if (error) throw new Error(error.message);

      setState({
        results: data.results || [],
        loading: false,
        error: null,
        hasSearched: true,
      });
    } catch (err: any) {
      setState({
        results: [],
        loading: false,
        error: "Arama sırasında bir hata oluştu. Lütfen tekrar dene.",
        hasSearched: true,
      });
      console.error("Search error:", err);
    }
  }, []);

  const clear = useCallback(() => {
    setState({ results: [], loading: false, error: null, hasSearched: false });
  }, []);

  return { ...state, search, clear };
}
