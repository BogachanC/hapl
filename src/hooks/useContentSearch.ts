import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface Platform {
  id?: number | string;
  slug?: string;
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
  origin?: "yerli" | "yabanci" | "bilinmiyor";
}

interface SearchState {
  results: ContentResult[];
  loading: boolean;
  error: string | null;
  hasSearched: boolean;
}

const TYPEAHEAD_DEBOUNCE_MS = 250;
const FULL_DELAY_MS = 800; // after this much idle, upgrade to full search

export function useContentSearch() {
  const [state, setState] = useState<SearchState>({
    results: [],
    loading: false,
    error: null,
    hasSearched: false,
  });
  const [query, setQuery] = useState("");
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const fetchResults = useCallback(async (q: string, mode: "typeahead" | "full") => {
    if (!q.trim()) {
      setState({ results: [], loading: false, error: null, hasSearched: false });
      return;
    }

    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setState((prev) => ({ ...prev, loading: true, error: null, hasSearched: true }));

    try {
      const { data, error } = await supabase.functions.invoke("search-content", {
        body: { query: q.trim(), mode },
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

  // Debounced search: typeahead first, then upgrade to full once query is stable.
  useEffect(() => {
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    if (fullTimer.current) clearTimeout(fullTimer.current);

    if (!query.trim()) {
      setState({ results: [], loading: false, error: null, hasSearched: false });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, hasSearched: true }));

    typeaheadTimer.current = setTimeout(() => {
      fetchResults(query, "typeahead");
    }, TYPEAHEAD_DEBOUNCE_MS);

    fullTimer.current = setTimeout(() => {
      fetchResults(query, "full");
    }, TYPEAHEAD_DEBOUNCE_MS + FULL_DELAY_MS);

    return () => {
      if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
      if (fullTimer.current) clearTimeout(fullTimer.current);
    };
  }, [query, fetchResults]);

  const clear = useCallback(() => {
    setQuery("");
    if (typeaheadTimer.current) clearTimeout(typeaheadTimer.current);
    if (fullTimer.current) clearTimeout(fullTimer.current);
    if (abortRef.current) abortRef.current.abort();
    setState({ results: [], loading: false, error: null, hasSearched: false });
  }, []);

  return { ...state, query, setQuery, clear };
}
