import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

const QUERY_KEY = "notification_preferences";

export function useNotificationPreferences() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: emailEnabled = true, ...queryRest } = useQuery({
    queryKey: [QUERY_KEY, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("email_enabled")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return true;
      return data.email_enabled as boolean;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          { user_id: user!.id, email_enabled: enabled },
          { onConflict: "user_id" },
        );
      if (error) throw error;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
  });

  const setEmailEnabled = (enabled: boolean) => mutation.mutate(enabled);

  return {
    emailEnabled,
    ...queryRest,
    setEmailEnabled,
    updating: mutation.isPending,
  };
}
