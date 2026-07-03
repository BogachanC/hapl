import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Bookmark, Tv, Film, Loader2, Trash2, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface TitleDetail {
  id: string;
  title: string;
  tmdb_type: string;
  poster_path: string | null;
  release_year: number | null;
}

const TMDB_IMG = 'https://image.tmdb.org/t/p';

const Watchlist = () => {
  const { user, loading: authLoading } = useAuth();
  const { watchlist, isLoading: watchlistLoading, removeFromWatchlist, removing } = useWatchlist();
  const [removingId, setRemovingId] = useState<string | null>(null);

  const titleIds = watchlist.map((w) => w.title_id);

  const { data: titles = [] } = useQuery({
    queryKey: ['watchlist_titles', titleIds],
    queryFn: async () => {
      if (titleIds.length === 0) return [];
      const { data, error } = await supabase
        .from('content_titles')
        .select('id, title, tmdb_type, poster_path, release_year')
        .in('id', titleIds);
      if (error) throw error;
      return (data || []) as TitleDetail[];
    },
    enabled: titleIds.length > 0,
  });

  const titlesById = new Map(titles.map((t) => [t.id, t]));

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container max-w-lg mx-auto px-4 py-16 text-center space-y-4">
          <Bookmark className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Listeni görmek için giriş yap.
          </p>
          <Link to="/auth">
            <Button variant="default" size="sm">Giriş Yap</Button>
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        {watchlistLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : watchlist.length === 0 ? (
          <div className="text-center py-20 space-y-2">
            <Bookmark className="h-10 w-10 text-muted-foreground/30 mx-auto" />
            <p className="text-sm text-muted-foreground">
              Listen boş. Ana sayfadan içerik detayına gidip listeye ekleyebilirsin.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">
              {watchlist.length} içerik
            </p>
            {watchlist.map((item) => {
              const title = titlesById.get(item.title_id);
              return (
                <div
                  key={item.id}
                  className="flex gap-3 p-3 bg-card rounded-lg border border-border/50"
                >
                  <div className="w-12 h-16 rounded bg-gradient-to-br from-secondary to-muted flex items-center justify-center overflow-hidden shrink-0">
                    {title?.poster_path ? (
                      <img
                        src={`${TMDB_IMG}/w200${title.poster_path}`}
                        alt={title.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    ) : title?.tmdb_type === 'tv' ? (
                      <Tv className="h-4 w-4 text-muted-foreground/30" />
                    ) : (
                      <Film className="h-4 w-4 text-muted-foreground/30" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
                    <h4 className="font-heading font-bold text-sm text-foreground truncate">
                      {title?.title || 'Yükleniyor…'}
                    </h4>
                    <div className="flex items-center gap-1.5">
                      {title?.tmdb_type && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider bg-muted-foreground/20 text-muted-foreground">
                          {title.tmdb_type === 'tv' ? 'Dizi' : 'Film'}
                        </span>
                      )}
                      {title?.release_year && (
                        <span className="text-[9px] text-muted-foreground flex items-center gap-0.5 font-medium">
                          <Calendar className="h-2.5 w-2.5" />
                          {title.release_year}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={removing}
                    onClick={() => {
                      setRemovingId(item.title_id);
                      removeFromWatchlist(item.title_id);
                    }}
                    className="shrink-0 self-center p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    aria-label="Listeden çıkar"
                  >
                    {removing && removingId === item.title_id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

function Header() {
  return (
    <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
      <div className="container max-w-lg mx-auto px-4 py-4 flex items-center gap-3">
        <Link to="/">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <h1 className="font-heading text-lg font-bold text-foreground">Listem</h1>
      </div>
    </header>
  );
}

export default Watchlist;
