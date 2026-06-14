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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      brief_nodes: {
        Row: {
          confidence: number | null
          created_at: string
          id: string
          last_edited_by: Database["public"]["Enums"]["brief_editor"]
          level: Database["public"]["Enums"]["brief_node_level"]
          order_key: string
          parent_id: string | null
          session_id: string
          source_chunk_ids: string[]
          status: Database["public"]["Enums"]["brief_node_status"]
          tag: string | null
          text: string
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          id?: string
          last_edited_by?: Database["public"]["Enums"]["brief_editor"]
          level?: Database["public"]["Enums"]["brief_node_level"]
          order_key: string
          parent_id?: string | null
          session_id: string
          source_chunk_ids?: string[]
          status?: Database["public"]["Enums"]["brief_node_status"]
          tag?: string | null
          text?: string
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          id?: string
          last_edited_by?: Database["public"]["Enums"]["brief_editor"]
          level?: Database["public"]["Enums"]["brief_node_level"]
          order_key?: string
          parent_id?: string | null
          session_id?: string
          source_chunk_ids?: string[]
          status?: Database["public"]["Enums"]["brief_node_status"]
          tag?: string | null
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "brief_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_nodes_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_operations: {
        Row: {
          applied: boolean
          created_at: string
          id: string
          op_type: Database["public"]["Enums"]["brief_op_type"]
          payload: Json
          rejection_reason: string | null
          segment_id: string | null
          session_id: string
        }
        Insert: {
          applied?: boolean
          created_at?: string
          id?: string
          op_type: Database["public"]["Enums"]["brief_op_type"]
          payload: Json
          rejection_reason?: string | null
          segment_id?: string | null
          session_id: string
        }
        Update: {
          applied?: boolean
          created_at?: string
          id?: string
          op_type?: Database["public"]["Enums"]["brief_op_type"]
          payload?: Json
          rejection_reason?: string | null
          segment_id?: string | null
          session_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_operations_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "transcript_segments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_operations_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      sessions: {
        Row: {
          context_files: Json
          created_at: string
          ended_at: string | null
          id: string
          prompt: string
          started_at: string
          status: Database["public"]["Enums"]["session_status"]
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          context_files?: Json
          created_at?: string
          ended_at?: string | null
          id?: string
          prompt?: string
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          context_files?: Json
          created_at?: string
          ended_at?: string | null
          id?: string
          prompt?: string
          started_at?: string
          status?: Database["public"]["Enums"]["session_status"]
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      transcript_chunks: {
        Row: {
          created_at: string
          end_ms: number
          id: string
          is_final: boolean
          lang: string | null
          session_id: string
          start_ms: number
          text: string
        }
        Insert: {
          created_at?: string
          end_ms?: number
          id?: string
          is_final?: boolean
          lang?: string | null
          session_id: string
          start_ms?: number
          text: string
        }
        Update: {
          created_at?: string
          end_ms?: number
          id?: string
          is_final?: boolean
          lang?: string | null
          session_id?: string
          start_ms?: number
          text?: string
        }
        Relationships: [
          {
            foreignKeyName: "transcript_chunks_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      transcript_segments: {
        Row: {
          boundary_reason: Database["public"]["Enums"]["boundary_reason"]
          chunk_ids: string[]
          created_at: string
          end_ms: number
          id: string
          raw_text: string
          session_id: string
          start_ms: number
        }
        Insert: {
          boundary_reason: Database["public"]["Enums"]["boundary_reason"]
          chunk_ids?: string[]
          created_at?: string
          end_ms?: number
          id?: string
          raw_text: string
          session_id: string
          start_ms?: number
        }
        Update: {
          boundary_reason?: Database["public"]["Enums"]["boundary_reason"]
          chunk_ids?: string[]
          created_at?: string
          end_ms?: number
          id?: string
          raw_text?: string
          session_id?: string
          start_ms?: number
        }
        Relationships: [
          {
            foreignKeyName: "transcript_segments_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      owns_session: { Args: { _session_id: string }; Returns: boolean }
    }
    Enums: {
      boundary_reason:
        | "word_count"
        | "char_count"
        | "time"
        | "silence"
        | "manual_stop"
      brief_editor: "ai" | "user"
      brief_node_level: "h1" | "h2" | "bullet"
      brief_node_status: "ai_draft" | "user_confirmed"
      brief_op_type:
        | "add_node"
        | "update_node"
        | "delete_node"
        | "move_node"
        | "annotate"
      session_status: "active" | "ended" | "archived"
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
      boundary_reason: [
        "word_count",
        "char_count",
        "time",
        "silence",
        "manual_stop",
      ],
      brief_editor: ["ai", "user"],
      brief_node_level: ["h1", "h2", "bullet"],
      brief_node_status: ["ai_draft", "user_confirmed"],
      brief_op_type: [
        "add_node",
        "update_node",
        "delete_node",
        "move_node",
        "annotate",
      ],
      session_status: ["active", "ended", "archived"],
    },
  },
} as const
