import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { usePlatforms } from '@/hooks/use-contents';
import { Search, Plus, ArrowLeft, Loader2, Film, Tv, Check, Database, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type TmdbResult = {
  tmdb_id: number;
  title: string;
  original_title: string;
  overview: string | null;
  poster_url: string | null;
  release_year: string | null;
  genres?: string[];
};

const AdminPanel = () => {
  const [query, setQuery] = useState('');
  const [contentType, setContentType] = useState<'dizi' | 'film'>('dizi');
  const [results, setResults] = useState<TmdbResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedResult, setSelectedResult] = useState<TmdbResult | null>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [origin, setOrigin] = useState<'yerli' | 'yabanci'>('yerli');
  const [status, setStatus] = useState<'yayinda' | 'yakinda' | 'bitti'>('yayinda');
  const [loadingDetail, setLoadingDetail] = useState(false);

  const { data: platforms } = usePlatforms();

  const searchTmdb = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setSelectedResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('tmdb', {
        body: { action: 'search', query: query.trim(), content_type: contentType },
      });
      if (error) throw error;
      setResults(data.results || []);
    } catch (e: any) {
      toast.error('TMDB arama hatası: ' + (e.message || 'Bilinmeyen hata'));
    } finally {
      setSearching(false);
    }
  };

  const selectResult = async (result: TmdbResult) => {
    setLoadingDetail(true);
    try {
      const { data, error } = await supabase.functions.invoke('tmdb', {
        body: { action: 'details', tmdb_id: result.tmdb_id, content_type: contentType },
      });
      if (error) throw error;

      const detail = data as TmdbResult & { origin_country?: string[] };
      setSelectedResult(detail);

      // Auto-detect origin
      const trCountries = ['TR'];
      if (detail.origin_country?.some((c: string) => trCountries.includes(c))) {
        setOrigin('yerli');
      } else {
        setOrigin('yabanci');
      }
    } catch {
      setSelectedResult(result);
    } finally {
      setLoadingDetail(false);
    }
  };

  const saveContent = async () => {
    if (!selectedResult || selectedPlatforms.length === 0) {
      toast.error('Lütfen en az bir platform seçin');
      return;
    }

    setSaving(true);
    try {
      const primaryPlatformId = selectedPlatforms[0];

      const { data: inserted, error: insertError } = await supabase
        .from('contents')
        .insert({
          title: selectedResult.title,
          description: selectedResult.overview,
          poster_url: selectedResult.poster_url,
          content_type: contentType,
          status,
          origin,
          genre: selectedResult.genres || [],
          release_year: selectedResult.release_year ? parseInt(selectedResult.release_year) : null,
          platform_id: primaryPlatformId,
        })
        .select('id')
        .single();

      if (insertError) throw insertError;

      // Add additional platforms to junction table
      if (selectedPlatforms.length > 1) {
        const junctionRows = selectedPlatforms.slice(1).map((pid) => ({
          content_id: inserted.id,
          platform_id: pid,
        }));
        const { error: junctionError } = await supabase
          .from('content_platforms')
          .insert(junctionRows);
        if (junctionError) throw junctionError;
      }

      toast.success(`"${selectedResult.title}" başarıyla eklendi!`);
      setSelectedResult(null);
      setSelectedPlatforms([]);
      setResults([]);
      setQuery('');
    } catch (e: any) {
      toast.error('Kaydetme hatası: ' + (e.message || 'Bilinmeyen hata'));
    } finally {
      setSaving(false);
    }
  };

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="container max-w-lg mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <h1 className="font-heading text-lg font-bold text-foreground">
              İçerik Ekle (TMDB)
            </h1>
          </div>
        </div>
      </header>

      <main className="container max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* Content Type Toggle */}
        <div className="flex gap-2">
          <Button
            variant={contentType === 'dizi' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setContentType('dizi')}
            className="gap-1.5"
          >
            <Tv className="h-3.5 w-3.5" /> Dizi
          </Button>
          <Button
            variant={contentType === 'film' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setContentType('film')}
            className="gap-1.5"
          >
            <Film className="h-3.5 w-3.5" /> Film
          </Button>
        </div>

        {/* Search */}
        <div className="flex gap-2">
          <Input
            placeholder="TMDB'de ara..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && searchTmdb()}
          />
          <Button onClick={searchTmdb} disabled={searching} size="icon">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
        </div>

        {/* Selected Result Detail */}
        {selectedResult && (
          <div className="bg-card rounded-lg border border-border p-4 space-y-4">
            <div className="flex gap-3">
              {selectedResult.poster_url ? (
                <img src={selectedResult.poster_url} alt={selectedResult.title} className="w-20 h-28 rounded object-cover" />
              ) : (
                <div className="w-20 h-28 rounded bg-muted flex items-center justify-center">
                  {contentType === 'dizi' ? <Tv className="h-6 w-6 text-muted-foreground" /> : <Film className="h-6 w-6 text-muted-foreground" />}
                </div>
              )}
              <div className="flex-1 min-w-0 space-y-1">
                <h3 className="font-heading font-bold text-foreground">{selectedResult.title}</h3>
                {selectedResult.original_title !== selectedResult.title && (
                  <p className="text-xs text-muted-foreground">{selectedResult.original_title}</p>
                )}
                {selectedResult.release_year && (
                  <p className="text-xs text-muted-foreground">{selectedResult.release_year}</p>
                )}
                {selectedResult.genres && (
                  <div className="flex gap-1 flex-wrap">
                    {selectedResult.genres.map((g) => (
                      <span key={g} className="text-[10px] px-2 py-0.5 bg-secondary rounded-full text-secondary-foreground">{g}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {selectedResult.overview && (
              <p className="text-xs text-muted-foreground leading-relaxed">{selectedResult.overview}</p>
            )}

            {/* Origin & Status */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Yapım</label>
              <div className="flex gap-2">
                {(['yerli', 'yabanci'] as const).map((o) => (
                  <Button key={o} size="sm" variant={origin === o ? 'default' : 'outline'} onClick={() => setOrigin(o)}>
                    {o === 'yerli' ? 'Yerli' : 'Yabancı'}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Durum</label>
              <div className="flex gap-2">
                {([{ v: 'yayinda', l: 'Yayında' }, { v: 'yakinda', l: 'Yakında' }, { v: 'bitti', l: 'Bitti' }] as const).map((s) => (
                  <Button key={s.v} size="sm" variant={status === s.v ? 'default' : 'outline'} onClick={() => setStatus(s.v)}>
                    {s.l}
                  </Button>
                ))}
              </div>
            </div>

            {/* Platform Selection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground">Platformlar</label>
              <div className="flex gap-2 flex-wrap">
                {platforms?.map((p) => (
                  <Button
                    key={p.id}
                    size="sm"
                    variant={selectedPlatforms.includes(p.id) ? 'default' : 'outline'}
                    onClick={() => togglePlatform(p.id)}
                    className="gap-1"
                  >
                    {selectedPlatforms.includes(p.id) && <Check className="h-3 w-3" />}
                    {p.name}
                  </Button>
                ))}
              </div>
            </div>

            <Button onClick={saveContent} disabled={saving || selectedPlatforms.length === 0} className="w-full gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              İçerik Ekle
            </Button>
          </div>
        )}

        {/* Search Results */}
        {!selectedResult && results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{results.length} sonuç bulundu</p>
            {results.map((r) => (
              <button
                key={r.tmdb_id}
                onClick={() => selectResult(r)}
                className="w-full flex gap-3 p-3 bg-card rounded-lg border border-border/50 hover:border-border transition-colors text-left"
              >
                {r.poster_url ? (
                  <img src={r.poster_url} alt={r.title} className="w-12 h-16 rounded object-cover shrink-0" />
                ) : (
                  <div className="w-12 h-16 rounded bg-muted flex items-center justify-center shrink-0">
                    {contentType === 'dizi' ? <Tv className="h-4 w-4 text-muted-foreground" /> : <Film className="h-4 w-4 text-muted-foreground" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <h4 className="font-heading font-bold text-sm text-foreground truncate">{r.title}</h4>
                  {r.original_title !== r.title && (
                    <p className="text-[11px] text-muted-foreground truncate">{r.original_title}</p>
                  )}
                  {r.release_year && <p className="text-[11px] text-muted-foreground">{r.release_year}</p>}
                  {r.overview && <p className="text-[11px] text-muted-foreground line-clamp-2 mt-1">{r.overview}</p>}
                </div>
                {loadingDetail && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0 self-center" />}
              </button>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default AdminPanel;
