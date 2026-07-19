import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bookmark, ChevronRight, Layers, Loader2, LogOut, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useUserSubscriptions } from '@/hooks/useUserSubscriptions';
import { useProfile } from '@/hooks/useProfile';

const Account = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { watchlist, isLoading: watchlistLoading } = useWatchlist();
  const { subscriptions, isLoading: subsLoading } = useUserSubscriptions();
  const { profile, isLoading: profileLoading } = useProfile();

  const handleSignOut = async () => {
    await signOut();
    navigate('/', { replace: true });
  };

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
          <User className="h-12 w-12 text-muted-foreground/30 mx-auto" />
          <p className="text-sm text-muted-foreground">
            Hesabını görmek için giriş yap.
          </p>
          <Link to="/auth">
            <Button variant="default" size="sm">Giriş Yap</Button>
          </Link>
        </main>
      </div>
    );
  }

  const loading = watchlistLoading || subsLoading || profileLoading;
  const greeting = profile.username ? `Merhaba, ${profile.username}` : 'Merhaba';

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
            {/* Greeting + account info */}
            <div className="space-y-3">
              <h2 className="font-heading text-lg font-bold text-foreground">
                {greeting}
              </h2>
              <div className="p-3 rounded-xl bg-card border border-border/50 space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                    E-posta
                  </span>
                </div>
                <p className="text-sm text-foreground truncate">{user.email}</p>
              </div>
            </div>

            {/* Navigation cards */}
            <div className="space-y-2">
              <NavCard
                to="/watchlist"
                icon={<Bookmark className="h-4 w-4" />}
                title="Listem"
                subtitle={`${watchlist.length} başlık`}
              />
              <NavCard
                to="/subscriptions"
                icon={<Layers className="h-4 w-4" />}
                title="Üyeliklerim"
                subtitle={`${subscriptions.length} platform`}
              />
            </div>

            {/* Sign out */}
            <Button
              variant="ghost"
              className="w-full gap-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4" />
              Çıkış Yap
            </Button>
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
        <h1 className="font-heading text-lg font-bold text-foreground">Hesabım</h1>
      </div>
    </header>
  );
}

function NavCard({
  to,
  icon,
  title,
  subtitle,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border/50 hover:border-border transition-colors"
    >
      <div className="h-9 w-9 rounded-lg bg-secondary/80 flex items-center justify-center shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground">{subtitle}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </Link>
  );
}

export default Account;
