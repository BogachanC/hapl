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
      content_platforms: {
        Row: {
          content_id: string
          created_at: string
          id: string
          platform_id: string
        }
        Insert: {
          content_id: string
          created_at?: string
          id?: string
          platform_id: string
        }
        Update: {
          content_id?: string
          created_at?: string
          id?: string
          platform_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_platforms_content_id_fkey"
            columns: ["content_id"]
            isOneToOne: false
            referencedRelation: "contents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_platforms_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
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
          normalized_title: string | null
          original_title: string | null
          overview: string | null
          poster_path: string | null
          release_year: number | null
          search_aliases: string[]
          title: string
          tmdb_id: number
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
          normalized_title?: string | null
          original_title?: string | null
          overview?: string | null
          poster_path?: string | null
          release_year?: number | null
          search_aliases?: string[]
          title: string
          tmdb_id: number
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
          normalized_title?: string | null
          original_title?: string | null
          overview?: string | null
          poster_path?: string | null
          release_year?: number | null
          search_aliases?: string[]
          title?: string
          tmdb_id?: number
          tmdb_type?: string
          updated_at?: string
        }
        Relationships: []
      }
      contents: {
        Row: {
          content_type: Database["public"]["Enums"]["content_type"]
          created_at: string
          description: string | null
          end_year: number | null
          genre: string[] | null
          id: string
          origin: Database["public"]["Enums"]["content_origin"]
          platform_id: string
          poster_url: string | null
          release_year: number | null
          status: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at: string
        }
        Insert: {
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          description?: string | null
          end_year?: number | null
          genre?: string[] | null
          id?: string
          origin?: Database["public"]["Enums"]["content_origin"]
          platform_id: string
          poster_url?: string | null
          release_year?: number | null
          status?: Database["public"]["Enums"]["content_status"]
          title: string
          updated_at?: string
        }
        Update: {
          content_type?: Database["public"]["Enums"]["content_type"]
          created_at?: string
          description?: string | null
          end_year?: number | null
          genre?: string[] | null
          id?: string
          origin?: Database["public"]["Enums"]["content_origin"]
          platform_id?: string
          poster_url?: string | null
          release_year?: number | null
          status?: Database["public"]["Enums"]["content_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contents_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "platforms"
            referencedColumns: ["id"]
          },
        ]
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
      platforms: {
        Row: {
          color: string
          created_at: string
          id: string
          logo_url: string | null
          name: string
          slug: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name: string
          slug: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          logo_url?: string | null
          name?: string
          slug?: string
        }
        Relationships: []
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
      streaming_providers: {
        Row: {
          created_at: string
          display_name: string
          domains: string[]
          firecrawl_enabled: boolean
          firecrawl_priority: number
          id: string
          is_active: boolean
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_hapl_sync_token: { Args: never; Returns: string }
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
