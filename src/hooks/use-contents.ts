import { useQuery, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type Platform = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  color: string;
};

export type ContentPlatform = {
  platform_id: string;
  platforms: Platform;
};

export type Content = {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  content_type: 'dizi' | 'film' | 'belgesel';
  status: 'yayinda' | 'yakinda' | 'bitti';
  origin: 'yerli' | 'yabanci';
  genre: string[];
  release_year: number | null;
  end_year: number | null;
  platform_id: string;
  platforms: Platform;
  content_platforms?: ContentPlatform[];
};

export function usePlatforms() {
  return useQuery({
    queryKey: ['platforms'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platforms')
        .select('*')
        .order('name');
      if (error) throw error;
      return data as Platform[];
    },
  });
}

const PAGE_SIZE = 21;

export function useContents(filters?: {
  search?: string;
  platformId?: string;
  contentType?: string;
  status?: string;
  origin?: string;
  genres?: string[];
}) {
  return useInfiniteQuery({
    queryKey: ['contents', filters],
    queryFn: async ({ pageParam = 0 }) => {
      let query = supabase
        .from('contents')
        .select('*, platforms(*), content_platforms(platform_id, platforms(*))')
        .order('created_at', { ascending: false })
        .range(pageParam * PAGE_SIZE, (pageParam + 1) * PAGE_SIZE - 1);

      if (filters?.platformId) {
        query = query.eq('platform_id', filters.platformId);
      }
      if (filters?.contentType) {
        query = query.eq('content_type', filters.contentType as any);
      }
      if (filters?.status) {
        query = query.eq('status', filters.status as any);
      }
      if (filters?.search) {
        query = query.ilike('title', `%${filters.search}%`);
      }
      if (filters?.origin) {
        query = query.eq('origin', filters.origin as any);
      }
      if (filters?.genres && filters.genres.length > 0) {
        query = query.overlaps('genre', filters.genres);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Content[];
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      return lastPage.length === PAGE_SIZE ? allPages.length : undefined;
    },
  });
}

export function useContent(id: string) {
  return useQuery({
    queryKey: ['content', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('contents')
        .select('*, platforms(*), content_platforms(platform_id, platforms(*))')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as Content;
    },
    enabled: !!id,
  });
}
