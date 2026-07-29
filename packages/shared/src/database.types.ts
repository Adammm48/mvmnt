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
      badges: {
        Row: {
          hint: string | null
          is_secret: boolean
          key: string
          label: string
          runs_required: number
          sort_order: number
        }
        Insert: {
          hint?: string | null
          is_secret?: boolean
          key: string
          label: string
          runs_required: number
          sort_order?: number
        }
        Update: {
          hint?: string | null
          is_secret?: boolean
          key?: string
          label?: string
          runs_required?: number
          sort_order?: number
        }
        Relationships: []
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
      consent_events: {
        Row: {
          age_confirmed: boolean | null
          document_version: string
          event: string
          id: string
          occurred_at: string
          user_id: string
        }
        Insert: {
          age_confirmed?: boolean | null
          document_version: string
          event: string
          id?: string
          occurred_at?: string
          user_id: string
        }
        Update: {
          age_confirmed?: boolean | null
          document_version?: string
          event?: string
          id?: string
          occurred_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      content_reports: {
        Row: {
          created_at: string
          id: string
          kind: string
          reason: string
          reporter_id: string | null
          resolved_at: string | null
          resolved_by: string | null
          target_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          reason: string
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          target_id: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          reason?: string
          reporter_id?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          target_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "content_reports_resolved_by_fkey"
            columns: ["resolved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      face_optins: {
        Row: {
          created_at: string
          provider_face_id: string | null
          storage_path: string
          user_id: string
        }
        Insert: {
          created_at?: string
          provider_face_id?: string | null
          storage_path: string
          user_id: string
        }
        Update: {
          created_at?: string
          provider_face_id?: string | null
          storage_path?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "face_optins_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
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
      friend_qr_tokens: {
        Row: {
          created_at: string
          expires_at: string
          revoked_at: string | null
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          revoked_at?: string | null
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          revoked_at?: string | null
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "friend_qr_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      friendships: {
        Row: {
          created_at: string
          initiated_by: string | null
          user_high: string
          user_low: string
        }
        Insert: {
          created_at?: string
          initiated_by?: string | null
          user_high: string
          user_low: string
        }
        Update: {
          created_at?: string
          initiated_by?: string | null
          user_high?: string
          user_low?: string
        }
        Relationships: [
          {
            foreignKeyName: "friendships_initiated_by_fkey"
            columns: ["initiated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_high_fkey"
            columns: ["user_high"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "friendships_user_low_fkey"
            columns: ["user_low"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      live_positions: {
        Row: {
          lat: number
          lng: number
          run_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          lat: number
          lng: number
          run_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          lat?: number
          lng?: number
          run_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "live_positions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "live_positions_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "live_positions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_badges: {
        Row: {
          badge_key: string
          earned_at: string
          user_id: string
        }
        Insert: {
          badge_key: string
          earned_at?: string
          user_id: string
        }
        Update: {
          badge_key?: string
          earned_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_badges_badge_key_fkey"
            columns: ["badge_key"]
            isOneToOne: false
            referencedRelation: "badges"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "member_badges_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      member_tier_reached: {
        Row: {
          acknowledged_at: string | null
          reached_at: string
          tier: Database["public"]["Enums"]["member_tier"]
          user_id: string
        }
        Insert: {
          acknowledged_at?: string | null
          reached_at?: string
          tier: Database["public"]["Enums"]["member_tier"]
          user_id: string
        }
        Update: {
          acknowledged_at?: string | null
          reached_at?: string
          tier?: Database["public"]["Enums"]["member_tier"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_tier_reached_user_id_fkey"
            columns: ["user_id"]
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
      orders: {
        Row: {
          buyer_id: string | null
          created_at: string
          currency: string
          delivery_note: string | null
          discount_minor: number
          gift_message: string | null
          id: string
          is_gift: boolean
          points_spent: number
          product_id: string | null
          product_name: string
          quantity: number
          recipient_id: string | null
          redeemed_at: string | null
          size: string | null
          status: Database["public"]["Enums"]["order_status"]
          total_minor: number
          unit_price_minor: number
          updated_at: string
        }
        Insert: {
          buyer_id?: string | null
          created_at?: string
          currency?: string
          delivery_note?: string | null
          discount_minor?: number
          gift_message?: string | null
          id?: string
          is_gift?: boolean
          points_spent?: number
          product_id?: string | null
          product_name: string
          quantity?: number
          recipient_id?: string | null
          redeemed_at?: string | null
          size?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total_minor: number
          unit_price_minor: number
          updated_at?: string
        }
        Update: {
          buyer_id?: string | null
          created_at?: string
          currency?: string
          delivery_note?: string | null
          discount_minor?: number
          gift_message?: string | null
          id?: string
          is_gift?: boolean
          points_spent?: number
          product_id?: string | null
          product_name?: string
          quantity?: number
          recipient_id?: string | null
          redeemed_at?: string | null
          size?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          total_minor?: number
          unit_price_minor?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_buyer_id_fkey"
            columns: ["buyer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_matches: {
        Row: {
          confidence: number
          created_at: string
          photo_id: string
          user_id: string
        }
        Insert: {
          confidence: number
          created_at?: string
          photo_id: string
          user_id: string
        }
        Update: {
          confidence?: number
          created_at?: string
          photo_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_matches_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "run_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_matches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      point_events: {
        Row: {
          awarded_at: string
          created_at: string
          id: number
          kind: Database["public"]["Enums"]["point_kind"]
          note: string | null
          points: number
          run_id: string | null
          source: string
          user_id: string | null
        }
        Insert: {
          awarded_at?: string
          created_at?: string
          id?: never
          kind: Database["public"]["Enums"]["point_kind"]
          note?: string | null
          points: number
          run_id?: string | null
          source?: string
          user_id?: string | null
        }
        Update: {
          awarded_at?: string
          created_at?: string
          id?: never
          kind?: Database["public"]["Enums"]["point_kind"]
          note?: string | null
          points?: number
          run_id?: string | null
          source?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "point_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pokes: {
        Row: {
          created_at: string
          from_user: string | null
          id: number
          run_id: string
          to_user: string | null
        }
        Insert: {
          created_at?: string
          from_user?: string | null
          id?: never
          run_id: string
          to_user?: string | null
        }
        Update: {
          created_at?: string
          from_user?: string | null
          id?: never
          run_id?: string
          to_user?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pokes_from_user_fkey"
            columns: ["from_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pokes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "pokes_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pokes_to_user_fkey"
            columns: ["to_user"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      product_waitlist: {
        Row: {
          joined_at: string
          product_id: string
          user_id: string
        }
        Insert: {
          joined_at?: string
          product_id: string
          user_id: string
        }
        Update: {
          joined_at?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_waitlist_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_waitlist_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          currency: string
          description: string | null
          id: string
          image_url: string | null
          name: string
          price_minor: number
          sizes: string[]
          sort_order: number
          status: Database["public"]["Enums"]["product_status"]
          stock: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name: string
          price_minor: number
          sizes?: string[]
          sort_order?: number
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price_minor?: number
          sizes?: string[]
          sort_order?: number
          status?: Database["public"]["Enums"]["product_status"]
          stock?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          age_confirmed: boolean
          avatar_url: string | null
          consent_version: string | null
          consented_at: string | null
          created_at: string
          display_name: string
          id: string
          is_founder: boolean
          leaderboard_opt_out: boolean
          photo_objection: boolean
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
        }
        Insert: {
          age_confirmed?: boolean
          avatar_url?: string | null
          consent_version?: string | null
          consented_at?: string | null
          created_at?: string
          display_name: string
          id: string
          is_founder?: boolean
          leaderboard_opt_out?: boolean
          photo_objection?: boolean
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
        }
        Update: {
          age_confirmed?: boolean
          avatar_url?: string | null
          consent_version?: string | null
          consented_at?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_founder?: boolean
          leaderboard_opt_out?: boolean
          photo_objection?: boolean
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
      run_photos: {
        Row: {
          category: Database["public"]["Enums"]["photo_category"]
          created_at: string
          id: string
          run_id: string
          storage_path: string
          uploaded_by: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["photo_category"]
          created_at?: string
          id?: string
          run_id: string
          storage_path: string
          uploaded_by?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["photo_category"]
          created_at?: string
          id?: string
          run_id?: string
          storage_path?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "run_photos_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "run_photos_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "run_photos_uploaded_by_fkey"
            columns: ["uploaded_by"]
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
          photos_published_at: string | null
          published_at: string | null
          route: Json | null
          route_published_at: string | null
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
          photos_published_at?: string | null
          published_at?: string | null
          route?: Json | null
          route_published_at?: string | null
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
          photos_published_at?: string | null
          published_at?: string | null
          route?: Json | null
          route_published_at?: string | null
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
      sponsor_impressions: {
        Row: {
          placement_id: string
          seen_on: string
          taps: number
          user_id: string
        }
        Insert: {
          placement_id: string
          seen_on: string
          taps?: number
          user_id: string
        }
        Update: {
          placement_id?: string
          seen_on?: string
          taps?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_impressions_placement_id_fkey"
            columns: ["placement_id"]
            isOneToOne: false
            referencedRelation: "sponsor_placements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_impressions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsor_placements: {
        Row: {
          created_at: string
          id: string
          run_id: string | null
          sponsor_id: string
          type: Database["public"]["Enums"]["placement_type"]
        }
        Insert: {
          created_at?: string
          id?: string
          run_id?: string | null
          sponsor_id: string
          type: Database["public"]["Enums"]["placement_type"]
        }
        Update: {
          created_at?: string
          id?: string
          run_id?: string | null
          sponsor_id?: string
          type?: Database["public"]["Enums"]["placement_type"]
        }
        Relationships: [
          {
            foreignKeyName: "sponsor_placements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "sponsor_placements_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sponsor_placements_sponsor_id_fkey"
            columns: ["sponsor_id"]
            isOneToOne: false
            referencedRelation: "sponsors"
            referencedColumns: ["id"]
          },
        ]
      }
      sponsors: {
        Row: {
          active_from: string
          active_to: string | null
          created_at: string
          created_by: string | null
          id: string
          logo_url: string | null
          name: string
          url: string | null
        }
        Insert: {
          active_from?: string
          active_to?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name: string
          url?: string | null
        }
        Update: {
          active_from?: string
          active_to?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          logo_url?: string | null
          name?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sponsors_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      tier_rewards: {
        Row: {
          is_placeholder: boolean
          reward: string
          tier: Database["public"]["Enums"]["member_tier"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          is_placeholder?: boolean
          reward: string
          tier: Database["public"]["Enums"]["member_tier"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          is_placeholder?: boolean
          reward?: string
          tier?: Database["public"]["Enums"]["member_tier"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tier_rewards_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      effective_point_events: {
        Row: {
          awarded_at: string | null
          created_at: string | null
          id: number | null
          kind: Database["public"]["Enums"]["point_kind"] | null
          note: string | null
          points: number | null
          run_id: string | null
          source: string | null
          user_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "point_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "run_attendance_counts"
            referencedColumns: ["run_id"]
          },
          {
            foreignKeyName: "point_events_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "point_events_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
      accept_consent: {
        Args: {
          p_age_confirmed: boolean
          p_photo_ok?: boolean
          p_version: string
        }
        Returns: undefined
      }
      acknowledge_tier: {
        Args: { p_tier: Database["public"]["Enums"]["member_tier"] }
        Returns: undefined
      }
      active_placements: {
        Args: { p_run_id?: string }
        Returns: {
          logo_url: string
          name: string
          placement_id: string
          sponsor_id: string
          type: Database["public"]["Enums"]["placement_type"]
          url: string
        }[]
      }
      add_friend_by_token: { Args: { p_token: string }; Returns: string }
      admin_adjust_points: {
        Args: { p_note: string; p_points: number; p_user_id: string }
        Returns: undefined
      }
      admin_check_in: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      admin_disable_member_qr: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      admin_mark_paid: { Args: { p_order_id: string }; Returns: undefined }
      admin_member_detail: { Args: { p_user_id: string }; Returns: Json }
      admin_members: {
        Args: { p_limit?: number; p_search?: string }
        Returns: {
          avatar_url: string
          display_name: string
          email: string
          friend_code_active: boolean
          friend_count: number
          is_founder: boolean
          joined_at: string
          last_run_at: string
          leaderboard_opt_out: boolean
          photo_objection: boolean
          points: number
          role: Database["public"]["Enums"]["member_role"]
          runs_attended: number
          streak_weeks: number
          tier: Database["public"]["Enums"]["member_tier"]
          user_id: string
        }[]
      }
      admin_publish_gallery: { Args: { p_run_id: string }; Returns: string }
      admin_publish_route: { Args: { p_run_id: string }; Returns: string }
      admin_remove_check_in: {
        Args: { p_run_id: string; p_user_id: string }
        Returns: undefined
      }
      admin_resolve_report: {
        Args: { p_report_id: string }
        Returns: undefined
      }
      admin_send_sponsor_shoutout: {
        Args: { p_message: string; p_run_id?: string; p_sponsor_id: string }
        Returns: string
      }
      admin_set_member_role: {
        Args: {
          p_role: Database["public"]["Enums"]["member_role"]
          p_user_id: string
        }
        Returns: undefined
      }
      admin_set_route: {
        Args: { p_route: Json; p_run_id: string }
        Returns: undefined
      }
      admin_set_tier_reward: {
        Args: {
          p_is_placeholder?: boolean
          p_reward: string
          p_tier: Database["public"]["Enums"]["member_tier"]
        }
        Returns: undefined
      }
      admin_sponsor_report: {
        Args: { p_from?: string; p_sponsor_id?: string; p_to?: string }
        Returns: {
          first_seen: string
          last_seen: string
          placement_id: string
          reach: number
          run_date: string
          run_title: string
          sponsor_id: string
          sponsor_name: string
          taps: number
          type: Database["public"]["Enums"]["placement_type"]
        }[]
      }
      are_friends: { Args: { a: string; b: string }; Returns: boolean }
      attendance_state: {
        Args: {
          checked_in_at: string
          signed_up_at: string
          withdrawn_at: string
        }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      backfill_loyalty: { Args: never; Returns: Json }
      cancel_order: { Args: { p_order_id: string }; Returns: undefined }
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
      consecutive_missed_runs: {
        Args: { p_as_of?: string; p_user_id: string }
        Returns: number
      }
      current_streak_weeks: {
        Args: { p_now?: string; p_user_id: string }
        Returns: number
      }
      dev_mark_paid: { Args: { p_order_id: string }; Returns: undefined }
      disable_photo_matching: { Args: never; Returns: undefined }
      enable_photo_matching: { Args: never; Returns: undefined }
      end_run: { Args: { p_run_id: string }; Returns: undefined }
      erase_member: { Args: { p_user_id: string }; Returns: undefined }
      is_admin: { Args: { uid?: string }; Returns: boolean }
      join_run: {
        Args: { p_pace_group?: string; p_run_id: string }
        Returns: Database["public"]["Enums"]["attendance_state"]
      }
      leaderboard: {
        Args: { p_window?: string }
        Returns: {
          avatar_url: string
          display_name: string
          is_me: boolean
          points: number
          rank: number
          tier: Database["public"]["Enums"]["member_tier"]
          user_id: string
        }[]
      }
      my_badges: {
        Args: never
        Returns: {
          earned_at: string
          hint: string
          is_secret: boolean
          key: string
          label: string
          runs_required: number
          sort_order: number
        }[]
      }
      my_distance_meters: { Args: never; Returns: number }
      my_friend_qr: {
        Args: never
        Returns: {
          expires_at: string
          token: string
        }[]
      }
      my_friends: {
        Args: { p_run_id?: string }
        Returns: {
          already_poked: boolean
          avatar_url: string
          display_name: string
          friend_id: string
          friends_since: string
          state: Database["public"]["Enums"]["attendance_state"]
        }[]
      }
      my_orders: {
        Args: never
        Returns: {
          created_at: string
          currency: string
          direction: string
          gift_message: string
          id: string
          image_url: string
          is_gift: boolean
          other_party: string
          points_spent: number
          product_name: string
          quantity: number
          redeemed_at: string
          size: string
          status: Database["public"]["Enums"]["order_status"]
          total_minor: number
        }[]
      }
      my_photo_matches: {
        Args: { p_run_id: string }
        Returns: {
          confidence: number
          photo_id: string
        }[]
      }
      my_standing: {
        Args: { p_window?: string }
        Returns: {
          percentile: number
          points: number
          points_to_next_rank: number
          points_to_next_tier: number
          rank: number
          runs_attended: number
          streak_weeks: number
          tier: Database["public"]["Enums"]["member_tier"]
          total_members: number
        }[]
      }
      my_unclaimed_tiers: {
        Args: never
        Returns: {
          is_placeholder: boolean
          reached_at: string
          reward: string
          tier: Database["public"]["Enums"]["member_tier"]
        }[]
      }
      place_order: {
        Args: {
          p_gift_message?: string
          p_product_id: string
          p_quantity?: number
          p_recipient_id?: string
          p_size?: string
          p_use_points?: number
        }
        Returns: string
      }
      points_discount_minor: { Args: { p_points: number }; Returns: number }
      points_to_next_tier: { Args: { p_points: number }; Returns: number }
      points_total: {
        Args: { p_since?: string; p_user_id: string }
        Returns: number
      }
      poke_friend: {
        Args: { p_friend_id: string; p_run_id: string }
        Returns: undefined
      }
      publish_run: { Args: { p_run_id: string }; Returns: undefined }
      purge_expired_location_data: { Args: never; Returns: number }
      purge_stale_live_positions: { Args: never; Returns: number }
      record_placement_seen: {
        Args: { p_placement_id: string }
        Returns: undefined
      }
      record_placement_tap: {
        Args: { p_placement_id: string }
        Returns: undefined
      }
      redeem_gift: {
        Args: { p_delivery_note?: string; p_order_id: string; p_size?: string }
        Returns: undefined
      }
      register_push_token: {
        Args: { p_platform: string; p_token: string }
        Returns: undefined
      }
      remove_friend: { Args: { p_friend_id: string }; Returns: undefined }
      report_content: {
        Args: { p_kind: string; p_reason: string; p_target_id: string }
        Returns: undefined
      }
      revoke_my_friend_qr: { Args: never; Returns: undefined }
      runs_attended: { Args: { p_user_id: string }; Returns: number }
      scheduler_tick: { Args: never; Returns: Json }
      set_avatar: { Args: { p_path: string }; Returns: undefined }
      set_leaderboard_visibility: {
        Args: { p_visible: boolean }
        Returns: undefined
      }
      set_photo_objection: { Args: { p_objects: boolean }; Returns: undefined }
      share_live_position: {
        Args: { p_lat: number; p_lng: number; p_run_id: string }
        Returns: undefined
      }
      start_run: { Args: { p_run_id: string }; Returns: undefined }
      stop_sharing_live_position: {
        Args: { p_run_id: string }
        Returns: undefined
      }
      tier_for_points: {
        Args: { p_points: number }
        Returns: Database["public"]["Enums"]["member_tier"]
      }
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
      member_tier: "rookie" | "runner" | "competitor" | "elite" | "legend"
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
        | "friend_poke"
        | "badge_earned"
        | "sponsor_shoutout"
        | "gift_received"
        | "route_published"
        | "photos_ready"
      order_status:
        | "awaiting_payment"
        | "paid"
        | "ready"
        | "fulfilled"
        | "cancelled"
      photo_category: "pre_run" | "run" | "after" | "camera"
      placement_type: "home_banner" | "run_badge" | "push_mention"
      point_kind:
        | "check_in"
        | "streak_bonus"
        | "adjustment"
        | "absence"
        | "redemption"
      product_status: "in_stock" | "coming_soon" | "retired" | "sold_out"
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
      member_tier: ["rookie", "runner", "competitor", "elite", "legend"],
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
        "friend_poke",
        "badge_earned",
        "sponsor_shoutout",
        "gift_received",
        "route_published",
        "photos_ready",
      ],
      order_status: [
        "awaiting_payment",
        "paid",
        "ready",
        "fulfilled",
        "cancelled",
      ],
      photo_category: ["pre_run", "run", "after", "camera"],
      placement_type: ["home_banner", "run_badge", "push_mention"],
      point_kind: [
        "check_in",
        "streak_bonus",
        "adjustment",
        "absence",
        "redemption",
      ],
      product_status: ["in_stock", "coming_soon", "retired", "sold_out"],
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

