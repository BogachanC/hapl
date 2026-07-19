import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

export interface Profile {
  username: string | null;
  avatar_key: string | null;
}

const QUERY_KEY = "profile";

const EMPTY_PROFILE: Profile = { username: null, avatar_key: null };

export function useProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: profile = EMPTY_PROFILE, ...queryRest } = useQuery({
    queryKey: [QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("username, avatar_key")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return EMPTY_PROFILE;
      return {
        username: data.username as string | null,
        avatar_key: data.avatar_key as string | null,
      } satisfies Profile;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const updateMutation = useMutation({
    mutationFn: async (fields: Partial<Pick<Profile, "username" | "avatar_key">>) => {
      const { error } = await supabase
        .from("profiles")
        .upsert(
          { user_id: user!.id, ...fields },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const updateProfile = (fields: Partial<Pick<Profile, "username" | "avatar_key">>) =>
    updateMutation.mutate(fields);

  return {
    profile,
    ...queryRest,
    updateProfile,
    updating: updateMutation.isPending,
  };
}
