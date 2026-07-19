import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Bookmark, Check, ChevronRight, Layers, Loader2, LogOut, Pencil, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useAuth } from '@/hooks/useAuth';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useUserSubscriptions } from '@/hooks/useUserSubscriptions';
import { useProfile } from '@/hooks/useProfile';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';
import { AVATAR_OPTIONS, getAvatarByKey, getInitial } from '@/lib/avatars';
import { cn } from '@/lib/utils';

const Account = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { watchlist, isLoading: watchlistLoading } = useWatchlist();
  const { subscriptions, isLoading: subsLoading } = useUserSubscriptions();
  const { profile, isLoading: profileLoading, updateProfile, updating: profileUpdating } = useProfile();
  const { emailEnabled, isLoading: notifLoading, setEmailEnabled, updating: notifUpdating } = useNotificationPreferences();

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

  const loading = watchlistLoading || subsLoading || profileLoading || notifLoading;
  const greeting = profile.username ? `Merhaba, ${profile.username}` : 'Merhaba';
  const avatarOption = getAvatarByKey(profile.avatar_key);
  const initial = getInitial(profile.username, user.email ?? undefined);

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
            {/* Greeting + avatar */}
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
                {avatarOption ? (
                  <avatarOption.Icon className="h-6 w-6 text-primary" />
                ) : (
                  <span className="text-lg font-bold text-primary">{initial}</span>
                )}
              </div>
              <div className="min-w-0">
                <h2 className="font-heading text-lg font-bold text-foreground truncate">
                  {greeting}
                </h2>
                <p className="text-xs text-muted-foreground truncate">{user.email}</p>
              </div>
            </div>

            {/* Profile section */}
            <ProfileSection
              profile={profile}
              email={user.email ?? undefined}
              onSave={updateProfile}
              saving={profileUpdating}
            />

            {/* Notification section */}
            <div className="space-y-2.5">
              <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                Bildirimler
              </h3>
              <div className="p-3 rounded-xl bg-card border border-border/50">
                <div className="flex items-center gap-3">
                  <Bell className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">E-posta bildirimleri</p>
                    <p className="text-[11px] text-muted-foreground">
                      İzleme listendeki içerikler yeni bir platformda yayına girdiğinde e-posta al
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {notifUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                    <Switch
                      checked={emailEnabled}
                      onCheckedChange={setEmailEnabled}
                      disabled={notifUpdating}
                    />
                  </div>
                </div>
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

function ProfileSection({
  profile,
  email,
  onSave,
  saving,
}: {
  profile: { username: string | null; avatar_key: string | null };
  email: string | undefined;
  onSave: (fields: { username?: string | null; avatar_key?: string | null }) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [draftAvatar, setDraftAvatar] = useState<string | null>(null);

  const startEditing = () => {
    setDraft(profile.username ?? '');
    setDraftAvatar(profile.avatar_key);
    setEditing(true);
  };

  const handleSave = () => {
    const trimmed = draft.trim();
    onSave({
      username: trimmed.length > 0 ? trimmed : null,
      avatar_key: draftAvatar,
    });
    setEditing(false);
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const currentAvatar = getAvatarByKey(profile.avatar_key);
  const initial = getInitial(profile.username, email);

  if (editing) {
    return (
      <div className="space-y-2.5">
        <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
          Profil
        </h3>
        <div className="p-3 rounded-xl bg-card border border-border/50 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Kullanıcı adı</label>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={40}
              placeholder="Adını gir"
              className="h-9 text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Avatar</label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDraftAvatar(null)}
                className={cn(
                  'h-10 w-10 rounded-lg border flex items-center justify-center transition-all',
                  draftAvatar === null
                    ? 'border-primary bg-primary/15 ring-1 ring-primary/40'
                    : 'border-border/50 bg-secondary/50 hover:border-border',
                )}
                title="Baş harf"
              >
                <span className="text-sm font-bold text-foreground">
                  {getInitial(draft || profile.username, email)}
                </span>
              </button>
              {AVATAR_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setDraftAvatar(opt.key)}
                  className={cn(
                    'h-10 w-10 rounded-lg border flex items-center justify-center transition-all',
                    draftAvatar === opt.key
                      ? 'border-primary bg-primary/15 ring-1 ring-primary/40'
                      : 'border-border/50 bg-secondary/50 hover:border-border',
                  )}
                  title={opt.label}
                >
                  <opt.Icon className="h-5 w-5 text-foreground" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="flex-1"
            >
              İptal
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving}
              className="flex-1 gap-1.5"
            >
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              Kaydet
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <h3 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
        Profil
      </h3>
      <div className="p-3 rounded-xl bg-card border border-border/50">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            {currentAvatar ? (
              <currentAvatar.Icon className="h-4 w-4 text-primary" />
            ) : (
              <span className="text-sm font-bold text-primary">{initial}</span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground truncate">
              {profile.username ?? 'Henüz bir isim belirlemedin'}
            </p>
            <p className="text-[11px] text-muted-foreground">
              {currentAvatar ? currentAvatar.label : 'Baş harf'}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={startEditing}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

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
