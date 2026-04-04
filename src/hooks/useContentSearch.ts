import { useState, useCallback, useRef, useEffect } from "react";
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
  confidence: number;
}

interface SearchState {
  results: ContentResult[];
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
}

const DEBOUNCE_MS = 300;

export function useContentSearch() {
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
  });
  const [query, setQuery] = useState("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchResults = useCallback(async (q: string) => {
    if (!q.trim()) {
      setState({ results: [], loading: false, error: null, hasSearched: false });
      return;
    }

    // Cancel previous in-flight request
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setState((prev) => ({ ...prev, loading: true, error: null, hasSearched: true }));

    try {
      const { data, error } = await supabase.functions.invoke("search-content", {
        body: { query: q.trim() },
      });

      if (error) throw new Error(error.message);

      setState({
        results: data.results || [],
        loading: false,
        error: null,
        hasSearched: true,
      });
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      setState({
        results: [],
        loading: false,
        error: "Arama sırasında bir hata oluştu. Lütfen tekrar dene.",
        hasSearched: true,
      });
      console.error("Search error:", err);
    }
  }, []);

  // Debounced search on query change
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (!query.trim()) {
      setState({ results: [], loading: false, error: null, hasSearched: false });
      return;
    }

    // Show loading immediately
    setState((prev) => ({ ...prev, loading: true, hasSearched: true }));

    timerRef.current = setTimeout(() => {
      fetchResults(query);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, fetchResults]);

  const clear = useCallback(() => {
    setQuery("");
    if (timerRef.current) clearTimeout(timerRef.current);
    if (abortRef.current) abortRef.current.abort();
    setState({ results: [], loading: false, error: null, hasSearched: false });
  }, []);

  return { ...state, query, setQuery, clear };
}
