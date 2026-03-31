import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export type Platform = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  color: string;
};

export type Content = {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  content_type: 'dizi' | 'film';
  status: 'yayinda' | 'yakinda' | 'bitti';
  origin: 'yerli' | 'yabanci';
  genre: string[];
  release_year: number | null;
  platform_id: string;
  platforms: Platform;
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

export function useContents(filters?: {
  search?: string;
  platformId?: string;
  contentType?: string;
  status?: string;
  origin?: string;
  genres?: string[];
}) {
  return useQuery({
    queryKey: ['contents', filters],
    queryFn: async () => {
      let query = supabase
        .from('contents')
        .select('*, platforms(*)')
        .order('created_at', { ascending: false });

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

      const { data, error } = await query;
      if (error) throw error;
      return data as Content[];
    },
  });
}
