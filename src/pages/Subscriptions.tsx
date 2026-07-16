import { Link } from 'react-router-dom';
import { ArrowLeft, Layers, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useUserSubscriptions } from '@/hooks/useUserSubscriptions';
import { getPlatformStyle } from '@/lib/platform-colors';
import { cn } from '@/lib/utils';

interface SubscriptionProvider {
  id: string;
  slug: string;
  display_name: string;
  sort_order: number;
  is_local: boolean;
}

function useSubscriptionProviders() {
  return useQuery({
    queryKey: ['streaming_providers_with_local'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('streaming_providers')
        .select('id, slug, display_name, sort_order, is_local')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      return (data || []) as SubscriptionProvider[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

const Subscriptions = () => {
  const { user, loading: authLoading } = useAuth();
  const { data: providers, isLoading: providersLoading } = useSubscriptionProviders();
  const {
    providerIdSet,
    subscribe,
    unsubscribe,
    isLoading: subsLoading,
  } = useUserSubscriptions();

  const loading = authLoading || providersLoading || subsLoading;

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
          <Layers className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Üyeliklerini görmek için giriş yap.
          </p>
          <Link to="/auth">
            <Button variant="default" size="sm">Giriş Yap</Button>
          </Link>
        </main>
      </div>
    );
  }

  const local = (providers || []).filter((p) => p.is_local);
  const global = (providers || []).filter((p) => !p.is_local);

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container max-w-lg mx-auto px-4 py-4 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Abone olduğun platformları işaretle — içeriklerde hangi platformların sana ait olduğunu gösterelim.
            </p>
            {local.length > 0 && (
              <Section
                title="Yerli Platformlar"
                providers={local}
                subscribedIds={providerIdSet}
                onToggle={(id, checked) => {
                  if (checked) subscribe(id);
                  else unsubscribe(id);
                }}
              />
            )}
            {global.length > 0 && (
              <Section
                title="Global Platformlar"
                providers={global}
                subscribedIds={providerIdSet}
                onToggle={(id, checked) => {
                  if (checked) subscribe(id);
                  else unsubscribe(id);
                }}
              />
            )}
          </>
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
        <h1 className="font-heading text-lg font-bold text-foreground">Üyeliklerim</h1>
      </div>
    </header>
  );
}

function Section({
  title,
  providers,
  subscribedIds,
  onToggle,
}: {
  title: string;
  providers: SubscriptionProvider[];
  subscribedIds: Set<string>;
  onToggle: (providerId: string, checked: boolean) => void;
}) {
  return (
    <div className="space-y-2.5">
      <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
        {title}
      </h2>
      <div className="space-y-1.5">
        {providers.map((p) => {
          const style = getPlatformStyle(p.slug);
          const checked = subscribedIds.has(p.id);
          return (
            <label
              key={p.id}
              className={cn(
                'flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all duration-200',
                checked
                  ? 'bg-primary/10 border-primary/40'
                  : 'bg-card border-border/50 hover:border-border',
              )}
            >
              <div
                className={cn(
                  'shrink-0 px-2.5 py-1 rounded-md text-[10px] font-extrabold tracking-wide uppercase min-w-[72px] text-center',
                  style.bg,
                  style.text,
                )}
              >
                {p.display_name}
              </div>
              <div className="flex-1" />
              <Checkbox
                checked={checked}
                onCheckedChange={(val) => {
                  const next = !!val;
                  onToggle(p.id, next);
                }}
              />
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default Subscriptions;
