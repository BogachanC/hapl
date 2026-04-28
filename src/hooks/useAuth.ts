import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

/**
 * useAuth — listens for Supabase auth changes and exposes session + user.
 * Also resolves whether the current user has the `admin` role.
 *
 * IMPORTANT: We attach the auth listener BEFORE calling getSession() to avoid
 * missing events that fire during the initial hydration.
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [roleLoading, setRoleLoading] = useState(true);

  useEffect(() => {
    // 1. Subscribe FIRST
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      setUser(newSession?.user ?? null);
    });

    // 2. THEN read existing session
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Resolve admin role whenever user changes. We defer the query so we never
  // call supabase from inside the auth callback (avoids deadlocks).
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      setRoleLoading(false);
      return;
    }
    setRoleLoading(true);
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      if (cancelled) return;
      setIsAdmin(!error && !!data);
      setRoleLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return { session, user, loading, isAdmin, roleLoading, signOut };
}
