export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      availability_changes: {
        Row: {
          action: string
          detected_at: string
          id: string
          processed_at: string | null
          provider_id: string
          title_id: string
        }
        Insert: {
          action: string
          detected_at?: string
          id?: string
          processed_at?: string | null
          provider_id: string
          title_id: string
        }
        Update: {
          action?: string
          detected_at?: string
          id?: string
          processed_at?: string | null
          provider_id?: string
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "availability_changes_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "availability_changes_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "content_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_dirty_titles: {
        Row: {
          attempts: number
          enqueued_at: string
          id: string
          last_error: string | null
          metadata: Json | null
          processed_at: string | null
          processing_at: string | null
          processing_owner: string | null
          reason: string
          source_job_id: string | null
          title_id: string
        }
        Insert: {
          attempts?: number
          enqueued_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json | null
          processed_at?: string | null
          processing_at?: string | null
          processing_owner?: string | null
          reason: string
          source_job_id?: string | null
          title_id: string
        }
        Update: {
          attempts?: number
          enqueued_at?: string
          id?: string
          last_error?: string | null
          metadata?: Json | null
          processed_at?: string | null
          processing_at?: string | null
          processing_owner?: string | null
          reason?: string
          source_job_id?: string | null
          title_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "catalog_dirty_titles_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "content_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_job_locks: {
        Row: {
          expires_at: string
          heartbeat_at: string
          lock_name: string
          locked_at: string
          metadata: Json
          owner: string | null
        }
        Insert: {
          expires_at: string
          heartbeat_at?: string
          lock_name: string
          locked_at?: string
          metadata?: Json
          owner?: string | null
        }
        Update: {
          expires_at?: string
          heartbeat_at?: string
          lock_name?: string
          locked_at?: string
          metadata?: Json
          owner?: string | null
        }
        Relationships: []
      }
      catalog_job_runs: {
        Row: {
          changed: number
          dirty_enqueued: number
          failed: number
          finished_at: string | null
          id: string
          job_name: string
          last_error: string | null
          ok: boolean | null
          override_skips: number
          payload: Json
          processed: number
          started_at: string
        }
        Insert: {
          changed?: number
          dirty_enqueued?: number
          failed?: number
          finished_at?: string | null
          id?: string
          job_name: string
          last_error?: string | null
          ok?: boolean | null
          override_skips?: number
          payload?: Json
          processed?: number
          started_at?: string
        }
        Update: {
          changed?: number
          dirty_enqueued?: number
          failed?: number
          finished_at?: string | null
          id?: string
          job_name?: string
          last_error?: string | null
          ok?: boolean | null
          override_skips?: number
          payload?: Json
          processed?: number
          started_at?: string
        }
        Relationships: []
      }
      catalog_seed_jobs: {
        Row: {
          baseline: Json | null
          completed_at: string | null
          coverage_delta: Json | null
          created_at: string
          current_page: number | null
          current_provider: string | null
          current_strategy: string | null
          current_type: string | null
          cursor: Json | null
          id: string
          last_error: string | null
          last_heartbeat_at: string
          mode: string
          params: Json
          plan_total: number
          processed_jobs: number
          sources: Json
          stats: Json
          status: string
          updated_at: string
        }
        Insert: {
          baseline?: Json | null
          completed_at?: string | null
          coverage_delta?: Json | null
          created_at?: string
          current_page?: number | null
          current_provider?: string | null
          current_strategy?: string | null
          current_type?: string | null
          cursor?: Json | null
          id?: string
          last_error?: string | null
          last_heartbeat_at?: string
          mode: string
          params?: Json
          plan_total?: number
          processed_jobs?: number
          sources?: Json
          stats?: Json
          status?: string
          updated_at?: string
        }
        Update: {
          baseline?: Json | null
          completed_at?: string | null
          coverage_delta?: Json | null
          created_at?: string
          current_page?: number | null
          current_provider?: string | null
          current_strategy?: string | null
          current_type?: string | null
          cursor?: Json | null
          id?: string
          last_error?: string | null
          last_heartbeat_at?: string
          mode?: string
          params?: Json
          plan_total?: number
          processed_jobs?: number
          sources?: Json
          stats?: Json
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_availability: {
        Row: {
          availability_type: string
          checked_at: string
          confidence: number
          created_at: string
          expires_at: string | null
          id: string
          last_seen_at: string | null
          provider_id: string
          raw_payload: Json
          region: string
          source: string
          source_url: string | null
          status: string
          title_id: string
          updated_at: string
        }
        Insert: {
          availability_type?: string
          checked_at?: string
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          last_seen_at?: string | null
          provider_id: string
          raw_payload?: Json
          region?: string
          source: string
          source_url?: string | null
          status: string
          title_id: string
          updated_at?: string
        }
        Update: {
          availability_type?: string
          checked_at?: string
          confidence?: number
          created_at?: string
          expires_at?: string | null
          id?: string
          last_seen_at?: string | null
          provider_id?: string
          raw_payload?: Json
          region?: string
          source?: string
          source_url?: string | null
          status?: string
          title_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_availability_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_availability_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "content_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_availability_history: {
        Row: {
          availability_id: string | null
          availability_type: string
          change_type: string
          changed_at: string
          id: string
          new_confidence: number | null
          new_source: string | null
          new_status: string | null
          old_confidence: number | null
          old_source: string | null
          old_status: string | null
          provider_id: string
          region: string
          title_id: string
        }
        Insert: {
          availability_id?: string | null
          availability_type: string
          change_type: string
          changed_at?: string
          id?: string
          new_confidence?: number | null
          new_source?: string | null
          new_status?: string | null
          old_confidence?: number | null
          old_source?: string | null
          old_status?: string | null
          provider_id: string
          region: string
          title_id: string
        }
        Update: {
          availability_id?: string | null
          availability_type?: string
          change_type?: string
          changed_at?: string
          id?: string
          new_confidence?: number | null
          new_source?: string | null
          new_status?: string | null
          old_confidence?: number | null
          old_source?: string | null
          old_status?: string | null
          provider_id?: string
          region?: string
          title_id?: string
        }
        Relationships: []
      }
      content_title_aliases: {
        Row: {
          alias: string
          country: string | null
          created_at: string
          id: string
          language: string | null
          normalized_alias: string
          normalized_compact: string | null
          source: string
          tmdb_id: number
          tmdb_type: string
          updated_at: string
        }
        Insert: {
          alias: string
          country?: string | null
          created_at?: string
          id?: string
          language?: string | null
          normalized_alias: string
          normalized_compact?: string | null
          source: string
          tmdb_id: number
          tmdb_type: string
          updated_at?: string
        }
        Update: {
          alias?: string
          country?: string | null
          created_at?: string
          id?: string
          language?: string | null
          normalized_alias?: string
          normalized_compact?: string | null
          source?: string
          tmdb_id?: number
          tmdb_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      content_titles: {
        Row: {
          backdrop_path: string | null
          content_kind: string | null
          created_at: string
          first_release_date: string | null
          genres: string[]
          id: string
          last_full_sync_at: string | null
          last_requested_at: string | null
          last_tmdb_sync_at: string | null
          metadata: Json
          normalized_compact: string | null
          normalized_title: string | null
          original_title: string | null
          overview: string | null
          poster_path: string | null
          release_year: number | null
          search_aliases: string[]
          source: string
          title: string
          tmdb_id: number | null
          tmdb_type: string
          updated_at: string
        }
        Insert: {
          backdrop_path?: string | null
          content_kind?: string | null
          created_at?: string
          first_release_date?: string | null
          genres?: string[]
          id?: string
          last_full_sync_at?: string | null
          last_requested_at?: string | null
          last_tmdb_sync_at?: string | null
          metadata?: Json
          normalized_compact?: string | null
          normalized_title?: string | null
          original_title?: string | null
          overview?: string | null
          poster_path?: string | null
          release_year?: number | null
          search_aliases?: string[]
          source?: string
          title: string
          tmdb_id?: number | null
          tmdb_type: string
          updated_at?: string
        }
        Update: {
          backdrop_path?: string | null
          content_kind?: string | null
          created_at?: string
          first_release_date?: string | null
          genres?: string[]
          id?: string
          last_full_sync_at?: string | null
          last_requested_at?: string | null
          last_tmdb_sync_at?: string | null
          metadata?: Json
          normalized_compact?: string | null
          normalized_title?: string | null
          original_title?: string | null
          overview?: string | null
          poster_path?: string | null
          release_year?: number | null
          search_aliases?: string[]
          source?: string
          title?: string
          tmdb_id?: number | null
          tmdb_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      manual_availability_overrides: {
        Row: {
          action: string
          created_at: string
          effective_from: string
          effective_until: string | null
          id: string
          note: string | null
          provider_id: string
          source_url: string | null
          title_id: string
          updated_at: string
        }
        Insert: {
          action: string
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          note?: string | null
          provider_id: string
          source_url?: string | null
          title_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: string
          note?: string | null
          provider_id?: string
          source_url?: string | null
          title_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_availability_overrides_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_availability_overrides_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "content_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          created_at: string
          email_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pending_notifications: {
        Row: {
          action: string
          availability_change_id: string
          created_at: string
          id: string
          provider_id: string
          sent_at: string | null
          title_id: string
          user_id: string
        }
        Insert: {
          action: string
          availability_change_id: string
          created_at?: string
          id?: string
          provider_id: string
          sent_at?: string | null
          title_id: string
          user_id: string
        }
        Update: {
          action?: string
          availability_change_id?: string
          created_at?: string
          id?: string
          provider_id?: string
          sent_at?: string | null
          title_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_notifications_availability_change_id_fkey"
            columns: ["availability_change_id"]
            isOneToOne: false
            referencedRelation: "availability_changes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_notifications_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_notifications_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "content_titles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_derivation_rules: {
        Row: {
          availability_type: string
          confidence: number
          created_at: string
          derived_provider_id: string
          id: string
          is_active: boolean
          note: string | null
          region: string
          source_provider_id: string
          updated_at: string
        }
        Insert: {
          availability_type?: string
          confidence?: number
          created_at?: string
          derived_provider_id: string
          id?: string
          is_active?: boolean
          note?: string | null
          region?: string
          source_provider_id: string
          updated_at?: string
        }
        Update: {
          availability_type?: string
          confidence?: number
          created_at?: string
          derived_provider_id?: string
          id?: string
          is_active?: boolean
          note?: string | null
          region?: string
          source_provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_derivation_rules_derived_provider_id_fkey"
            columns: ["derived_provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_derivation_rules_source_provider_id_fkey"
            columns: ["source_provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      search_cache: {
        Row: {
          cache_key: string
          created_at: string
          id: string
          results: Json
        }
        Insert: {
          cache_key: string
          created_at?: string
          id?: string
          results?: Json
        }
        Update: {
          cache_key?: string
          created_at?: string
          id?: string
          results?: Json
        }
        Relationships: []
      }
      search_events: {
        Row: {
          created_at: string
          id: string
          mode: string | null
          normalized_query: string
          raw_query: string
          result_count: number
          selected_category: string | null
          selected_provider: string | null
          source: string
          top_result_title: string | null
          top_result_tmdb_id: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          mode?: string | null
          normalized_query: string
          raw_query: string
          result_count?: number
          selected_category?: string | null
          selected_provider?: string | null
          source: string
          top_result_title?: string | null
          top_result_tmdb_id?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          mode?: string | null
          normalized_query?: string
          raw_query?: string
          result_count?: number
          selected_category?: string | null
          selected_provider?: string | null
          source?: string
          top_result_title?: string | null
          top_result_tmdb_id?: number | null
        }
        Relationships: []
      }
      search_index_state: {
        Row: {
          created_at: string
          current_offset: number
          failed_count: number
          has_more: boolean
          id: string
          index_name: string
          indexed_count: number
          last_error: string | null
          last_synced_at: string | null
          meta: Json
          total_titles: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_offset?: number
          failed_count?: number
          has_more?: boolean
          id?: string
          index_name: string
          indexed_count?: number
          last_error?: string | null
          last_synced_at?: string | null
          meta?: Json
          total_titles?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_offset?: number
          failed_count?: number
          has_more?: boolean
          id?: string
          index_name?: string
          indexed_count?: number
          last_error?: string | null
          last_synced_at?: string | null
          meta?: Json
          total_titles?: number
          updated_at?: string
        }
        Relationships: []
      }
      streaming_providers: {
        Row: {
          created_at: string
          display_name: string
          domains: string[]
          firecrawl_enabled: boolean
          firecrawl_priority: number
          id: string
          is_active: boolean
          is_local: boolean
          slug: string
          sort_order: number
          tmdb_names: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name: string
          domains?: string[]
          firecrawl_enabled?: boolean
          firecrawl_priority?: number
          id?: string
          is_active?: boolean
          is_local?: boolean
          slug: string
          sort_order?: number
          tmdb_names?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string
          domains?: string[]
          firecrawl_enabled?: boolean
          firecrawl_priority?: number
          id?: string
          is_active?: boolean
          is_local?: boolean
          slug?: string
          sort_order?: number
          tmdb_names?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "streaming_providers"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist_items: {
        Row: {
          created_at: string
          id: string
          title_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_items_title_id_fkey"
            columns: ["title_id"]
            isOneToOne: false
            referencedRelation: "content_titles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_dirty_titles: {
        Args: { p_limit: number; p_owner: string }
        Returns: {
          attempts: number
          id: string
          metadata: Json
          reason: string
          title_id: string
        }[]
      }
      get_hapl_sync_token: { Args: never; Returns: string }
      hapl_create_manual_title: {
        Args: {
          p_genres?: string[]
          p_origin?: string
          p_overview?: string
          p_poster_path?: string
          p_provider_ids: string[]
          p_release_year?: number
          p_status?: string
          p_title: string
          p_tmdb_type: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
    }
    Enums: {
      app_role: "admin"
      content_origin: "yerli" | "yabanci"
      content_status: "yayinda" | "yakinda" | "bitti"
      content_type: "dizi" | "film" | "belgesel"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin"],
      content_origin: ["yerli", "yabanci"],
      content_status: ["yayinda", "yakinda", "bitti"],
      content_type: ["dizi", "film", "belgesel"],
    },
  },
} as const
