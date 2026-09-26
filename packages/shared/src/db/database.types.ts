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
      agent_runs: {
        Row: {
          created_at: string
          error: Json | null
          finished_at: string | null
          handles: Json
          id: string
          lease_expires_at: string | null
          model: string
          provider: string
          replayed: boolean
          requester_member_id: string | null
          seed_batch: string | null
          started_at: string | null
          status: string
          step_count: number
          trigger: string
          trigger_message_id: string | null
          trip_id: string
          updated_at: string
          usage: Json | null
        }
        Insert: {
          created_at?: string
          error?: Json | null
          finished_at?: string | null
          handles?: Json
          id?: string
          lease_expires_at?: string | null
          model: string
          provider: string
          replayed?: boolean
          requester_member_id?: string | null
          seed_batch?: string | null
          started_at?: string | null
          status?: string
          step_count?: number
          trigger: string
          trigger_message_id?: string | null
          trip_id: string
          updated_at?: string
          usage?: Json | null
        }
        Update: {
          created_at?: string
          error?: Json | null
          finished_at?: string | null
          handles?: Json
          id?: string
          lease_expires_at?: string | null
          model?: string
          provider?: string
          replayed?: boolean
          requester_member_id?: string | null
          seed_batch?: string | null
          started_at?: string | null
          status?: string
          step_count?: number
          trigger?: string
          trigger_message_id?: string | null
          trip_id?: string
          updated_at?: string
          usage?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "agent_runs_requester_member_id_fkey"
            columns: ["requester_member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_trigger_message_id_fkey"
            columns: ["trigger_message_id"]
            isOneToOne: true
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agent_runs_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          confirmation_code: string | null
          confirmed_at: string | null
          created_at: string
          currency: string
          details: Json
          id: string
          idempotency_key: string
          item_id: string
          mandate_id: string | null
          option_id: string | null
          payer: string
          provider: string
          provider_ref: string | null
          seed_batch: string | null
          status: string
          total_cents: number | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          confirmation_code?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency: string
          details: Json
          id?: string
          idempotency_key: string
          item_id: string
          mandate_id?: string | null
          option_id?: string | null
          payer: string
          provider: string
          provider_ref?: string | null
          seed_batch?: string | null
          status?: string
          total_cents?: number | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          confirmation_code?: string | null
          confirmed_at?: string | null
          created_at?: string
          currency?: string
          details?: Json
          id?: string
          idempotency_key?: string
          item_id?: string
          mandate_id?: string | null
          option_id?: string | null
          payer?: string
          provider?: string
          provider_ref?: string | null
          seed_batch?: string | null
          status?: string
          total_cents?: number | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "item_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      item_attendees: {
        Row: {
          created_at: string
          item_id: string
          member_id: string
          seed_batch: string | null
          trip_id: string
        }
        Insert: {
          created_at?: string
          item_id: string
          member_id: string
          seed_batch?: string | null
          trip_id: string
        }
        Update: {
          created_at?: string
          item_id?: string
          member_id?: string
          seed_batch?: string | null
          trip_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_attendees_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_attendees_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_attendees_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      item_options: {
        Row: {
          created_at: string
          id: string
          item_id: string
          place_id: string
          price_cents: number
          rank: number
          reasoning: string | null
          score: number
          score_breakdown: Json
          seed_batch: string | null
          source: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          item_id: string
          place_id: string
          price_cents: number
          rank: number
          reasoning?: string | null
          score: number
          score_breakdown: Json
          seed_batch?: string | null
          source: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          item_id?: string
          place_id?: string
          price_cents?: number
          rank?: number
          reasoning?: string | null
          score?: number
          score_breakdown?: Json
          seed_batch?: string | null
          source?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "item_options_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_options_place_id_fkey"
            columns: ["place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "item_options_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      itinerary_items: {
        Row: {
          area_label: string | null
          area_lat: number | null
          area_lng: number | null
          category: string
          chosen_option_id: string | null
          created_at: string
          created_by_run_id: string | null
          ends_at: string
          id: string
          label: string
          pinned: boolean
          position: number
          seed_batch: string | null
          shifted_min: number
          slot_key: string
          starts_at: string
          status: string
          supersedes_item_id: string | null
          together: boolean
          trip_id: string
          updated_at: string
        }
        Insert: {
          area_label?: string | null
          area_lat?: number | null
          area_lng?: number | null
          category: string
          chosen_option_id?: string | null
          created_at?: string
          created_by_run_id?: string | null
          ends_at: string
          id?: string
          label: string
          pinned?: boolean
          position: number
          seed_batch?: string | null
          shifted_min?: number
          slot_key: string
          starts_at: string
          status?: string
          supersedes_item_id?: string | null
          together?: boolean
          trip_id: string
          updated_at?: string
        }
        Update: {
          area_label?: string | null
          area_lat?: number | null
          area_lng?: number | null
          category?: string
          chosen_option_id?: string | null
          created_at?: string
          created_by_run_id?: string | null
          ends_at?: string
          id?: string
          label?: string
          pinned?: boolean
          position?: number
          seed_batch?: string | null
          shifted_min?: number
          slot_key?: string
          starts_at?: string
          status?: string
          supersedes_item_id?: string | null
          together?: boolean
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "itinerary_items_chosen_option_id_fkey"
            columns: ["chosen_option_id"]
            isOneToOne: false
            referencedRelation: "item_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_created_by_run_id_fkey"
            columns: ["created_by_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_supersedes_item_id_fkey"
            columns: ["supersedes_item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itinerary_items_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      mandates: {
        Row: {
          booking_confirmation_code: string | null
          booking_provider_ref: string | null
          booking_quote_id: string | null
          cancel_reason: string | null
          cap_cents: number
          created_at: string
          currency: string
          expires_at: string
          final_cents: number | null
          id: string
          idempotency_key: string
          item_id: string
          lease_expires_at: string | null
          merchant: string
          option_id: string
          proposed_by_run_id: string | null
          quote_cents: number
          quote_id: string
          seed_batch: string | null
          status: string
          supersedes_mandate_id: string | null
          title: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          booking_confirmation_code?: string | null
          booking_provider_ref?: string | null
          booking_quote_id?: string | null
          cancel_reason?: string | null
          cap_cents: number
          created_at?: string
          currency: string
          expires_at: string
          final_cents?: number | null
          id?: string
          idempotency_key: string
          item_id: string
          lease_expires_at?: string | null
          merchant: string
          option_id: string
          proposed_by_run_id?: string | null
          quote_cents: number
          quote_id: string
          seed_batch?: string | null
          status?: string
          supersedes_mandate_id?: string | null
          title: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          booking_confirmation_code?: string | null
          booking_provider_ref?: string | null
          booking_quote_id?: string | null
          cancel_reason?: string | null
          cap_cents?: number
          created_at?: string
          currency?: string
          expires_at?: string
          final_cents?: number | null
          id?: string
          idempotency_key?: string
          item_id?: string
          lease_expires_at?: string | null
          merchant?: string
          option_id?: string
          proposed_by_run_id?: string | null
          quote_cents?: number
          quote_id?: string
          seed_batch?: string | null
          status?: string
          supersedes_mandate_id?: string | null
          title?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mandates_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_option_id_fkey"
            columns: ["option_id"]
            isOneToOne: false
            referencedRelation: "item_options"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_proposed_by_run_id_fkey"
            columns: ["proposed_by_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_supersedes_mandate_id_fkey"
            columns: ["supersedes_mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mandates_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      member_constraints: {
        Row: {
          budget_cents: number | null
          created_at: string
          dietary: string[]
          id: string
          interests: string[]
          member_id: string
          notes: string | null
          seed_batch: string | null
          set_by_member_id: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          budget_cents?: number | null
          created_at?: string
          dietary?: string[]
          id?: string
          interests?: string[]
          member_id: string
          notes?: string | null
          seed_batch?: string | null
          set_by_member_id?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          budget_cents?: number | null
          created_at?: string
          dietary?: string[]
          id?: string
          interests?: string[]
          member_id?: string
          notes?: string | null
          seed_batch?: string | null
          set_by_member_id?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_constraints_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: true
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_constraints_set_by_member_id_fkey"
            columns: ["set_by_member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_constraints_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          agent_run_id: string | null
          body: string | null
          card_payload: Json | null
          card_type: string | null
          client_id: string | null
          created_at: string
          id: string
          item_id: string | null
          kind: string
          mentions_agent: boolean
          reply_to_message_id: string | null
          seed_batch: string | null
          sender_member_id: string | null
          sender_type: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          body?: string | null
          card_payload?: Json | null
          card_type?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          kind: string
          mentions_agent?: boolean
          reply_to_message_id?: string | null
          seed_batch?: string | null
          sender_member_id?: string | null
          sender_type: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          body?: string | null
          card_payload?: Json | null
          card_type?: string | null
          client_id?: string | null
          created_at?: string
          id?: string
          item_id?: string | null
          kind?: string
          mentions_agent?: boolean
          reply_to_message_id?: string | null
          seed_batch?: string | null
          sender_member_id?: string | null
          sender_type?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "itinerary_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_reply_to_message_id_fkey"
            columns: ["reply_to_message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_member_id_fkey"
            columns: ["sender_member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_holds: {
        Row: {
          authorized_at: string | null
          cap_cents: number
          captured_at: string | null
          captured_cents: number | null
          created_at: string
          decline_code: string | null
          id: string
          idempotency_key: string
          kind: string
          lease_expires_at: string | null
          mandate_id: string
          payer_member_id: string | null
          pays_share: boolean | null
          refunded_cents: number | null
          seed_batch: string | null
          share_cents: number
          share_member_id: string
          status: string
          stripe_payment_intent_id: string | null
          trip_id: string
          updated_at: string
        }
        Insert: {
          authorized_at?: string | null
          cap_cents: number
          captured_at?: string | null
          captured_cents?: number | null
          created_at?: string
          decline_code?: string | null
          id?: string
          idempotency_key: string
          kind: string
          lease_expires_at?: string | null
          mandate_id: string
          payer_member_id?: string | null
          pays_share?: boolean | null
          refunded_cents?: number | null
          seed_batch?: string | null
          share_cents: number
          share_member_id: string
          status: string
          stripe_payment_intent_id?: string | null
          trip_id: string
          updated_at?: string
        }
        Update: {
          authorized_at?: string | null
          cap_cents?: number
          captured_at?: string | null
          captured_cents?: number | null
          created_at?: string
          decline_code?: string | null
          id?: string
          idempotency_key?: string
          kind?: string
          lease_expires_at?: string | null
          mandate_id?: string
          payer_member_id?: string | null
          pays_share?: boolean | null
          refunded_cents?: number | null
          seed_batch?: string | null
          share_cents?: number
          share_member_id?: string
          status?: string
          stripe_payment_intent_id?: string | null
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_holds_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_holds_payer_member_id_fkey"
            columns: ["payer_member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_holds_share_member_id_fkey"
            columns: ["share_member_id"]
            isOneToOne: false
            referencedRelation: "trip_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_holds_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      person_preferences: {
        Row: {
          created_at: string
          dietary: string[]
          interests: string[]
          notes: Json
          profile_id: string
          seed_batch: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dietary?: string[]
          interests?: string[]
          notes?: Json
          profile_id: string
          seed_batch?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dietary?: string[]
          interests?: string[]
          notes?: Json
          profile_id?: string
          seed_batch?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      places: {
        Row: {
          address: string | null
          category: string
          created_at: string
          dietary_tags: string[]
          fetched_at: string
          hours: Json | null
          id: string
          lat: number
          lng: number
          name: string
          phone: string | null
          photo_url: string | null
          price_level: number | null
          provider: string
          provider_place_id: string
          rating: number | null
          raw: Json | null
          seed_batch: string | null
          tags: string[]
          updated_at: string
        }
        Insert: {
          address?: string | null
          category: string
          created_at?: string
          dietary_tags?: string[]
          fetched_at: string
          hours?: Json | null
          id?: string
          lat: number
          lng: number
          name: string
          phone?: string | null
          photo_url?: string | null
          price_level?: number | null
          provider: string
          provider_place_id: string
          rating?: number | null
          raw?: Json | null
          seed_batch?: string | null
          tags?: string[]
          updated_at?: string
        }
        Update: {
          address?: string | null
          category?: string
          created_at?: string
          dietary_tags?: string[]
          fetched_at?: string
          hours?: Json | null
          id?: string
          lat?: number
          lng?: number
          name?: string
          phone?: string | null
          photo_url?: string | null
          price_level?: number | null
          provider?: string
          provider_place_id?: string
          rating?: number | null
          raw?: Json | null
          seed_batch?: string | null
          tags?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      price_changes: {
        Row: {
          action: string
          booking_id: string | null
          created_at: string
          id: string
          mandate_id: string | null
          new_cents: number
          new_mandate_id: string | null
          old_cents: number
          seed_batch: string | null
          source: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          action: string
          booking_id?: string | null
          created_at?: string
          id?: string
          mandate_id?: string | null
          new_cents: number
          new_mandate_id?: string | null
          old_cents: number
          seed_batch?: string | null
          source: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          action?: string
          booking_id?: string | null
          created_at?: string
          id?: string
          mandate_id?: string | null
          new_cents?: number
          new_mandate_id?: string | null
          old_cents?: number
          seed_batch?: string | null
          source?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "price_changes_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_changes_mandate_id_fkey"
            columns: ["mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_changes_new_mandate_id_fkey"
            columns: ["new_mandate_id"]
            isOneToOne: false
            referencedRelation: "mandates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "price_changes_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          default_payment_method_id: string | null
          display_name: string
          id: string
          seed_batch: string | null
          stripe_customer_id: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          default_payment_method_id?: string | null
          display_name: string
          id: string
          seed_batch?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          default_payment_method_id?: string | null
          display_name?: string
          id?: string
          seed_batch?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      routes: {
        Row: {
          created_at: string
          distance_m: number
          duration_s: number
          fetched_at: string
          from_place_id: string
          geometry: Json
          id: string
          mode: string
          provider: string
          seed_batch: string | null
          to_place_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          distance_m: number
          duration_s: number
          fetched_at: string
          from_place_id: string
          geometry: Json
          id?: string
          mode: string
          provider: string
          seed_batch?: string | null
          to_place_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          distance_m?: number
          duration_s?: number
          fetched_at?: string
          from_place_id?: string
          geometry?: Json
          id?: string
          mode?: string
          provider?: string
          seed_batch?: string | null
          to_place_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routes_from_place_id_fkey"
            columns: ["from_place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routes_to_place_id_fkey"
            columns: ["to_place_id"]
            isOneToOne: false
            referencedRelation: "places"
            referencedColumns: ["id"]
          },
        ]
      }
      tool_calls: {
        Row: {
          created_at: string
          duration_ms: number | null
          error: Json | null
          id: string
          input: Json
          message_id: string | null
          output: Json | null
          run_id: string
          seed_batch: string | null
          status: string
          tool_call_id: string
          tool_name: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_ms?: number | null
          error?: Json | null
          id?: string
          input: Json
          message_id?: string | null
          output?: Json | null
          run_id: string
          seed_batch?: string | null
          status: string
          tool_call_id: string
          tool_name: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_ms?: number | null
          error?: Json | null
          id?: string
          input?: Json
          message_id?: string | null
          output?: Json | null
          run_id?: string
          seed_batch?: string | null
          status?: string
          tool_call_id?: string
          tool_name?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tool_calls_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_calls_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tool_calls_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trip_members: {
        Row: {
          claimed_at: string | null
          claimed_token_hash: string | null
          created_at: string
          display_name: string
          id: string
          invite_token: string | null
          lane_color: string
          profile_id: string | null
          role: string
          seed_batch: string | null
          sort_order: number
          status: string
          trip_id: string
          updated_at: string
        }
        Insert: {
          claimed_at?: string | null
          claimed_token_hash?: string | null
          created_at?: string
          display_name: string
          id?: string
          invite_token?: string | null
          lane_color: string
          profile_id?: string | null
          role?: string
          seed_batch?: string | null
          sort_order: number
          status?: string
          trip_id: string
          updated_at?: string
        }
        Update: {
          claimed_at?: string | null
          claimed_token_hash?: string | null
          created_at?: string
          display_name?: string
          id?: string
          invite_token?: string | null
          lane_color?: string
          profile_id?: string | null
          role?: string
          seed_batch?: string | null
          sort_order?: number
          status?: string
          trip_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trip_members_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "trip_members_trip_id_fkey"
            columns: ["trip_id"]
            isOneToOne: false
            referencedRelation: "trips"
            referencedColumns: ["id"]
          },
        ]
      }
      trips: {
        Row: {
          city: string
          created_at: string
          currency: string
          id: string
          organizer_attending: boolean
          organizer_profile_id: string
          price_threshold_percent: number
          seed_batch: string | null
          slug: string
          status: string
          timezone: string
          title: string
          trip_date: string
          updated_at: string
        }
        Insert: {
          city: string
          created_at?: string
          currency?: string
          id?: string
          organizer_attending?: boolean
          organizer_profile_id: string
          price_threshold_percent?: number
          seed_batch?: string | null
          slug: string
          status?: string
          timezone?: string
          title: string
          trip_date: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          currency?: string
          id?: string
          organizer_attending?: boolean
          organizer_profile_id?: string
          price_threshold_percent?: number
          seed_batch?: string | null
          slug?: string
          status?: string
          timezone?: string
          title?: string
          trip_date?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "trips_organizer_profile_id_fkey"
            columns: ["organizer_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_events: {
        Row: {
          attempts: number
          created_at: string
          error: string | null
          event_id: string
          payload: Json | null
          processed_at: string | null
          provider: string
          received_at: string
          seed_batch: string | null
          status: string
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          error?: string | null
          event_id: string
          payload?: Json | null
          processed_at?: string | null
          provider: string
          received_at: string
          seed_batch?: string | null
          status?: string
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          error?: string | null
          event_id?: string
          payload?: Json | null
          processed_at?: string | null
          provider?: string
          received_at?: string
          seed_batch?: string | null
          status?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_item_change: { Args: { payload: Json }; Returns: Json }
      apply_plan: { Args: { payload: Json }; Returns: Json }
      audit_definer_functions: {
        Args: never
        Returns: {
          client_can_execute: boolean
          name: string
          search_path_pinned: boolean
        }[]
      }
      claim_invite: { Args: { p_token: string }; Returns: Json }
      complete_mandate: { Args: { payload: Json }; Returns: Json }
      cover_shortfall: { Args: { payload: Json }; Returns: Json }
      create_mandate: { Args: { payload: Json }; Returns: Json }
      finish_agent_run: { Args: { payload: Json }; Returns: Json }
      is_trip_member: { Args: { p_trip_id: string }; Returns: boolean }
      is_trip_organizer: { Args: { p_trip_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
    Enums: {},
  },
} as const

