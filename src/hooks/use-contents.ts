import { useQuery } from '@tanstack/react-query';
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

export const PAGE_SIZE = 21;
export const MAX_ITEMS = 105;

export function useContents(filters?: {
  search?: string;
  platformId?: string;
  contentType?: string;
  status?: string;
  origin?: string;
  genres?: string[];
  limit?: number;
}) {
  return useQuery({
    queryKey: ['contents', filters],
    queryFn: async () => {
      const limit = Math.min(filters?.limit ?? PAGE_SIZE, MAX_ITEMS);
      let query = supabase
        .from('contents')
        .select('*, platforms(*), content_platforms(platform_id, platforms(*))')
        .limit(limit);

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
      
      // Deduplicate by title — merge platforms into a single card
      const titleMap = new Map<string, Content>();
      for (const item of data as Content[]) {
        const existing = titleMap.get(item.title);
        if (existing) {
          // Merge this item's platform into existing content_platforms
          if (!existing.content_platforms) {
            existing.content_platforms = [{ platform_id: existing.platform_id, platforms: existing.platforms }];
          }
          existing.content_platforms.push({ platform_id: item.platform_id, platforms: item.platforms });
          item.content_platforms?.forEach(cp => existing.content_platforms!.push(cp));
        } else {
          titleMap.set(item.title, { ...item });
        }
      }
      const deduped = Array.from(titleMap.values());
      
      // Shuffle for random order on each load
      const shuffled = deduped.sort(() => Math.random() - 0.5);
      return shuffled;
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
