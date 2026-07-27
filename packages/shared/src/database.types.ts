export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          entity: string
          entity_id: string | null
          id: number
          metadata: Json
          occurred_at: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          entity: string
          entity_id?: string | null
          id?: never
          metadata?: Json
          occurred_at?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          entity?: string
          entity_id?: string | null
          id?: never
          metadata?: Json
          occurred_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      check_in_evidence: {
        Row: {
          accuracy_m: number | null
          attendance_id: string
          client_ts: string | null
          distance_m: number | null
          method: Database["public"]["Enums"]["check_in_method"]
          reported_lat: number | null
          reported_lng: number | null
          run_id: string
          server_ts: string
        }
        Insert: {
          accuracy_m?: number | null
          attendance_id: string
          client_ts?: string | null
          distance_m?: number | null
          method: Database["public"]["Enums"]["check_in_method"]
          reported_lat?: number | null
          reported_lng?: number | null
          run_id: string
          server_ts?: string
        }
        Update: {
          accuracy_m?: number | null
          attendance_id?: string
          client_ts?: string | null
          distance_m?: number | null
          method?: Database["public"]["Enums"]["check_in_method"]
          reported_lat?: number | null
          reported_lng?: number | null
          run_id?: string
          server_ts?: string
        }
        Relationships: [
          {
            foreignKeyName: "check_in_evidence_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: true
            referencedRelation: "run_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_evidence_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: true
            referencedRelation: "run_attendance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "check_in_evidence_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "check_in_evidence_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          description: string
          enabled: boolean
          key: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          description: string
          enabled?: boolean
          key: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          description?: string
          enabled?: boolean
          key?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_flags_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_deliveries: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          event_id: string
          id: number
          push_token: string
          sent_at: string | null
          status: Database["public"]["Enums"]["delivery_status"]
          user_id: string | null
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          event_id: string
          id?: never
          push_token: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          user_id?: string | null
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          event_id?: string
          id?: never
          push_token?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["delivery_status"]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notification_deliveries_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "notification_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_deliveries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_events: {
        Row: {
          audience: Database["public"]["Enums"]["notification_audience"]
          body: string
          created_at: string
          created_by: string | null
          dedupe_key: string
          id: string
          processed_at: string | null
          run_id: string | null
          scheduled_for: string
          target_user_id: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Insert: {
          audience: Database["public"]["Enums"]["notification_audience"]
          body: string
          created_at?: string
          created_by?: string | null
          dedupe_key: string
          id?: string
          processed_at?: string | null
          run_id?: string | null
          scheduled_for?: string
          target_user_id?: string | null
          title: string
          type: Database["public"]["Enums"]["notification_type"]
        }
        Update: {
          audience?: Database["public"]["Enums"]["notification_audience"]
          body?: string
          created_at?: string
          created_by?: string | null
          dedupe_key?: string
          id?: string
          processed_at?: string | null
          run_id?: string | null
          scheduled_for?: string
          target_user_id?: string | null
          title?: string
          type?: Database["public"]["Enums"]["notification_type"]
        }
        Relationships: [
          {
            foreignKeyName: "notification_events_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "notification_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notification_events_target_user_id_fkey"
            columns: ["target_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
        }
        Relationships: []
      }
      push_tokens: {
        Row: {
          created_at: string
          expo_push_token: string
          id: string
          last_seen_at: string
          platform: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expo_push_token: string
          id?: string
          last_seen_at?: string
          platform: string
          user_id: string
        }
        Update: {
          created_at?: string
          expo_push_token?: string
          id?: string
          last_seen_at?: string
          platform?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      run_attendance: {
        Row: {
          check_in_method: Database["public"]["Enums"]["check_in_method"] | null
          checked_in_at: string | null
          created_at: string
          id: string
          pace_group: string | null
          queued_at: string
          run_id: string
          signed_up_at: string | null
          updated_at: string
          user_id: string | null
          waitlisted_at: string | null
          withdrawn_at: string | null
        }
        Insert: {
          check_in_method?:
            | Database["public"]["Enums"]["check_in_method"]
            | null
          checked_in_at?: string | null
          created_at?: string
          id?: string
          pace_group?: string | null
          queued_at?: string
          run_id: string
          signed_up_at?: string | null
          updated_at?: string
          user_id?: string | null
          waitlisted_at?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          check_in_method?:
            | Database["public"]["Enums"]["check_in_method"]
            | null
          checked_in_at?: string | null
          created_at?: string
          id?: string
          pace_group?: string | null
          queued_at?: string
          run_id?: string
          signed_up_at?: string | null
          updated_at?: string
          user_id?: string | null
          waitlisted_at?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_attendance_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "run_attendance_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      run_attendance_events: {
        Row: {
          actor_id: string | null
          attendance_id: string
          event: Database["public"]["Enums"]["attendance_event"]
          id: number
          occurred_at: string
          run_id: string
          user_id: string | null
        }
        Insert: {
          actor_id?: string | null
          attendance_id: string
          event: Database["public"]["Enums"]["attendance_event"]
          id?: never
          occurred_at?: string
          run_id: string
          user_id?: string | null
        }
        Update: {
          actor_id?: string | null
          attendance_id?: string
          event?: Database["public"]["Enums"]["attendance_event"]
          id?: never
          occurred_at?: string
          run_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_attendance_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_attendance_events_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "run_attendance"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_attendance_events_attendance_id_fkey"
            columns: ["attendance_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_attendance_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "run_attendance_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_attendance_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      runs: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          capacity: number | null
          check_in_radius_m: number
          cover_image_url: string | null
          cover_video_url: string | null
          created_at: string
          created_by: string | null
          description: string | null
          distance_meters: number | null
          ends_at: string | null
          id: string
          meeting_point_lat: number
          meeting_point_lng: number
          meeting_point_name: string
          pace_groups: string[]
          published_at: string | null
          starts_at: string
          status: Database["public"]["Enums"]["run_status"]
          title: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          capacity?: number | null
          check_in_radius_m?: number
          cover_image_url?: string | null
          cover_video_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          distance_meters?: number | null
          ends_at?: string | null
          id?: string
          meeting_point_lat: number
          meeting_point_lng: number
          meeting_point_name: string
          pace_groups?: string[]
          published_at?: string | null
          starts_at: string
          status?: Database["public"]["Enums"]["run_status"]
          title: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          capacity?: number | null
          check_in_radius_m?: number
          cover_image_url?: string | null
          cover_video_url?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          distance_meters?: number | null
          ends_at?: string | null
          id?: string
          meeting_point_lat?: number
          meeting_point_lng?: number
          meeting_point_name?: string
          pace_groups?: string[]
          published_at?: string | null
          starts_at?: string
          status?: Database["public"]["Enums"]["run_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "runs_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      run_attendance_counts: {
        Row: {
          checked_in_count: number | null
          going_count: number | null
          run_id: string | null
          waitlist_count: number | null
        }
        Relationships: []
      }
      run_attendance_view: {
        Row: {
          check_in_method: Database["public"]["Enums"]["check_in_method"] | null
          checked_in_at: string | null
          created_at: string | null
          id: string | null
          is_in: boolean | null
          pace_group: string | null
          queued_at: string | null
          run_id: string | null
          signed_up_at: string | null
          state: Database["public"]["Enums"]["attendance_state"] | null
          updated_at: string | null
          user_id: string | null
          waitlisted_at: string | null
          withdrawn_at: string | null
        }
        Insert: {
          check_in_method?:
            | Database["public"]["Enums"]["check_in_method"]
            | null
          checked_in_at?: string | null
          created_at?: string | null
          id?: string | null
          is_in?: never
          pace_group?: string | null
          queued_at?: string | null
          run_id?: string | null
          signed_up_at?: string | null
          state?: never
          updated_at?: string | null
          user_id?: string | null
          waitlisted_at?: string | null
          withdrawn_at?: string | null
        }
        Update: {
          check_in_method?:
            | Database["public"]["Enums"]["check_in_method"]
            | null
          checked_in_at?: string | null
          created_at?: string | null
          id?: string | null
          is_in?: never
          pace_group?: string | null
          queued_at?: string | null
          run_id?: string | null
          signed_up_at?: string | null
          state?: never
          updated_at?: string | null
          user_id?: string | null
          waitlisted_at?: string | null
          withdrawn_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_attendance_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "run_attendance_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_attendance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      admin_check_in: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      admin_remove_check_in: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: undefined
      }
      attendance_state: {
        Args: {
          checked_in_at: string
          signed_up_at: string
          withdrawn_at: string
        }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      cancel_run: {
        Args: { p_reason?: string; p_run_id: string }
        Returns: undefined
      }
      check_in: {
        Args: {
          p_accuracy_m?: number
          p_client_ts?: string
          p_lat: number
          p_lng: number
          p_run_id: string
        }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      end_run: { Args: { p_run_id: string }; Returns: undefined }
      erase_member: { Args: { p_user_id: string }; Returns: undefined }
      is_admin: { Args: { uid?: string }; Returns: boolean }
      join_run: {
        Args: { p_pace_group?: string; p_run_id: string }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      publish_run: { Args: { p_run_id: string }; Returns: undefined }
      purge_expired_location_data: { Args: never; Returns: number }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      scheduler_tick: { Args: never; Returns: Json }
      start_run: { Args: { p_run_id: string }; Returns: undefined }
      withdraw_from_run: { Args: { p_run_id: string }; Returns: undefined }
    }
    Enums: {
      attendance_event:
        | "signed_up"
        | "waitlisted"
        | "promoted"
        | "checked_in"
        | "check_in_removed"
        | "withdrawn"
        | "rejoined"
      attendance_state: "waitlisted" | "signed_up" | "checked_in" | "withdrawn"
      check_in_method: "geofence" | "qr" | "admin"
      delivery_status: "pending" | "logged" | "sent" | "failed" | "skipped"
      member_role: "member" | "admin"
      notification_audience:
        | "all_members"
        | "run_signed_up"
        | "run_checked_in"
        | "single_user"
      notification_type:
        | "run_published"
        | "reminder_evening_before"
        | "reminder_morning_of"
        | "run_started"
        | "run_ended"
        | "waitlist_promoted"
      run_status:
        | "draft"
        | "published"
        | "in_progress"
        | "completed"
        | "cancelled"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      attendance_event: [
        "signed_up",
        "waitlisted",
        "promoted",
        "checked_in",
        "check_in_removed",
        "withdrawn",
        "rejoined",
      ],
      attendance_state: ["waitlisted", "signed_up", "checked_in", "withdrawn"],
      check_in_method: ["geofence", "qr", "admin"],
      delivery_status: ["pending", "logged", "sent", "failed", "skipped"],
      member_role: ["member", "admin"],
      notification_audience: [
        "all_members",
        "run_signed_up",
        "run_checked_in",
        "single_user",
      ],
      notification_type: [
        "run_published",
        "reminder_evening_before",
        "reminder_morning_of",
        "run_started",
        "run_ended",
        "waitlist_promoted",
      ],
      run_status: [
        "draft",
        "published",
        "in_progress",
        "completed",
        "cancelled",
      ],
    },
  },
} as const

