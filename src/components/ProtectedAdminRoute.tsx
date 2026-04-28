import { Navigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface Props {
  children: React.ReactNode;
}

/**
 * Gate that requires:
 *  1. an authenticated user (otherwise -> /auth)
 *  2. the `admin` role in public.user_roles (otherwise -> friendly 403 view)
 */
const ProtectedAdminRoute = ({ children }: Props) => {
  const { user, loading, isAdmin, roleLoading } = useAuth();

  if (loading || (user && roleLoading)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace />;
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-sm text-center space-y-3">
          <h1 className="text-2xl font-bold">Erişim Reddedildi</h1>
          <p className="text-muted-foreground text-sm">
            Bu sayfaya yalnızca admin yetkisine sahip kullanıcılar erişebilir.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default ProtectedAdminRoute;
