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
    PostgrestVersion: "14.17"
  }
  public: {
    Tables: {
      academic_sections: {
        Row: {
          body: string
          brief: string
          citations: Json
          created_at: string
          heading: string
          id: string
          key: string
          owner_id: string
          position: number
          status: string
          updated_at: string
          words: number
          work_id: string
        }
        Insert: {
          body?: string
          brief?: string
          citations?: Json
          created_at?: string
          heading: string
          id?: string
          key: string
          owner_id: string
          position: number
          status?: string
          updated_at?: string
          words?: number
          work_id: string
        }
        Update: {
          body?: string
          brief?: string
          citations?: Json
          created_at?: string
          heading?: string
          id?: string
          key?: string
          owner_id?: string
          position?: number
          status?: string
          updated_at?: string
          words?: number
          work_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academic_sections_work_id_fkey"
            columns: ["work_id"]
            isOneToOne: false
            referencedRelation: "academic_works"
            referencedColumns: ["id"]
          },
        ]
      }
      academic_works: {
        Row: {
          created_at: string
          empirical: boolean
          estimated_credits: number
          failure_reason: string | null
          field: string
          id: string
          kind: string
          owner_id: string
          paused_reason: string | null
          requirements: string
          sources: Json
          spent_credits: number
          status: string
          topic: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          empirical?: boolean
          estimated_credits?: number
          failure_reason?: string | null
          field?: string
          id?: string
          kind: string
          owner_id: string
          paused_reason?: string | null
          requirements?: string
          sources?: Json
          spent_credits?: number
          status?: string
          topic: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          empirical?: boolean
          estimated_credits?: number
          failure_reason?: string | null
          field?: string
          id?: string
          kind?: string
          owner_id?: string
          paused_reason?: string | null
          requirements?: string
          sources?: Json
          spent_credits?: number
          status?: string
          topic?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_audit_logs: {
        Row: {
          action: string
          admin_id: string
          after_data: Json | null
          before_data: Json | null
          created_at: string
          id: string
          reason: string | null
          request_id: string | null
          target_id: string
          target_type: string
        }
        Insert: {
          action: string
          admin_id: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          request_id?: string | null
          target_id: string
          target_type: string
        }
        Update: {
          action?: string
          admin_id?: string
          after_data?: Json | null
          before_data?: Json | null
          created_at?: string
          id?: string
          reason?: string | null
          request_id?: string | null
          target_id?: string
          target_type?: string
        }
        Relationships: []
      }
      ai_usage: {
        Row: {
          created_at: string
          generated_images: number
          id: string
          input_tokens: number
          job_id: string | null
          latency_ms: number | null
          metadata: Json
          model: string
          operation: string
          output_tokens: number
          owner_id: string
          presentation_id: string | null
          provider: string
          provider_cost_usd: number
          request_id: string | null
        }
        Insert: {
          created_at?: string
          generated_images?: number
          id?: string
          input_tokens?: number
          job_id?: string | null
          latency_ms?: number | null
          metadata?: Json
          model: string
          operation: string
          output_tokens?: number
          owner_id: string
          presentation_id?: string | null
          provider: string
          provider_cost_usd?: number
          request_id?: string | null
        }
        Update: {
          created_at?: string
          generated_images?: number
          id?: string
          input_tokens?: number
          job_id?: string | null
          latency_ms?: number | null
          metadata?: Json
          model?: string
          operation?: string
          output_tokens?: number
          owner_id?: string
          presentation_id?: string | null
          provider?: string
          provider_cost_usd?: number
          request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_usage_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      api_rate_limits: {
        Row: {
          key: string
          request_count: number
          updated_at: string
          window_started_at: string
        }
        Insert: {
          key: string
          request_count?: number
          updated_at?: string
          window_started_at: string
        }
        Update: {
          key?: string
          request_count?: number
          updated_at?: string
          window_started_at?: string
        }
        Relationships: []
      }
      app_settings: {
        Row: {
          created_at: string
          description: string | null
          key: string
          public_read: boolean
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          created_at?: string
          description?: string | null
          key: string
          public_read?: boolean
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          created_at?: string
          description?: string | null
          key?: string
          public_read?: boolean
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      coin_packages: {
        Row: {
          bonus_coins: number
          code: string
          coins: number
          created_at: string
          currency: string
          description: string
          id: string
          is_active: boolean
          label: string
          price_amount: number
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          bonus_coins?: number
          code: string
          coins: number
          created_at?: string
          currency?: string
          description?: string
          id?: string
          is_active?: boolean
          label: string
          price_amount: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          bonus_coins?: number
          code?: string
          coins?: number
          created_at?: string
          currency?: string
          description?: string
          id?: string
          is_active?: boolean
          label?: string
          price_amount?: number
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      commission_config: {
        Row: {
          buyer_fee_rate: number
          created_at: string
          scope: string
          seller_fee_rate: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          buyer_fee_rate: number
          created_at?: string
          scope: string
          seller_fee_rate: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          buyer_fee_rate?: number
          created_at?: string
          scope?: string
          seller_fee_rate?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      commission_history: {
        Row: {
          changed_by: string | null
          created_at: string
          id: string
          new_buyer_fee_rate: number
          new_seller_fee_rate: number
          old_buyer_fee_rate: number | null
          old_seller_fee_rate: number | null
          reason: string
          scope: string
        }
        Insert: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_buyer_fee_rate: number
          new_seller_fee_rate: number
          old_buyer_fee_rate?: number | null
          old_seller_fee_rate?: number | null
          reason?: string
          scope: string
        }
        Update: {
          changed_by?: string | null
          created_at?: string
          id?: string
          new_buyer_fee_rate?: number
          new_seller_fee_rate?: number
          old_buyer_fee_rate?: number | null
          old_seller_fee_rate?: number | null
          reason?: string
          scope?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          balance_after: number
          created_at: string
          created_by: string | null
          description: string
          id: string
          idempotency_key: string
          job_id: string | null
          metadata: Json
          reservation_delta: number
          reserved_after: number
          type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string
        }
        Insert: {
          amount?: number
          balance_after: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          idempotency_key: string
          job_id?: string | null
          metadata?: Json
          reservation_delta?: number
          reserved_after: number
          type: Database["public"]["Enums"]["credit_transaction_type"]
          user_id: string
        }
        Update: {
          amount?: number
          balance_after?: number
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          idempotency_key?: string
          job_id?: string | null
          metadata?: Json
          reservation_delta?: number
          reserved_after?: number
          type?: Database["public"]["Enums"]["credit_transaction_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_wallets: {
        Row: {
          balance: number
          created_at: string
          lifetime_granted: number
          lifetime_spent: number
          reserved: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          balance?: number
          created_at?: string
          lifetime_granted?: number
          lifetime_spent?: number
          reserved?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          balance?: number
          created_at?: string
          lifetime_granted?: number
          lifetime_spent?: number
          reserved?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      design_font_usage: {
        Row: {
          design_id: string
          family_id: string
          requested_name: string
          resolved: boolean
        }
        Insert: {
          design_id: string
          family_id: string
          requested_name?: string
          resolved?: boolean
        }
        Update: {
          design_id?: string
          family_id?: string
          requested_name?: string
          resolved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "design_font_usage_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "presentation_designs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "design_font_usage_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "font_families"
            referencedColumns: ["id"]
          },
        ]
      }
      design_slide_profiles: {
        Row: {
          alternative_roles: Database["public"]["Enums"]["slide_story_role"][]
          archetype_id: string
          created_at: string
          density: string
          design_id: string
          design_version: number
          id: string
          is_terminal: boolean
          layout_signature: string
          recommended_story_position: number
          role: Database["public"]["Enums"]["slide_story_role"]
          source_index: number
          source_slide_part: string
          supports_chart: boolean
          supports_image: boolean
          supports_quote: boolean
          supports_stats: boolean
          supports_table: boolean
          text_capacity: string
          text_map: Json
          visual_weight: string
        }
        Insert: {
          alternative_roles?: Database["public"]["Enums"]["slide_story_role"][]
          archetype_id: string
          created_at?: string
          density?: string
          design_id: string
          design_version?: number
          id?: string
          is_terminal?: boolean
          layout_signature?: string
          recommended_story_position?: number
          role: Database["public"]["Enums"]["slide_story_role"]
          source_index?: number
          source_slide_part?: string
          supports_chart?: boolean
          supports_image?: boolean
          supports_quote?: boolean
          supports_stats?: boolean
          supports_table?: boolean
          text_capacity?: string
          text_map?: Json
          visual_weight?: string
        }
        Update: {
          alternative_roles?: Database["public"]["Enums"]["slide_story_role"][]
          archetype_id?: string
          created_at?: string
          density?: string
          design_id?: string
          design_version?: number
          id?: string
          is_terminal?: boolean
          layout_signature?: string
          recommended_story_position?: number
          role?: Database["public"]["Enums"]["slide_story_role"]
          source_index?: number
          source_slide_part?: string
          supports_chart?: boolean
          supports_image?: boolean
          supports_quote?: boolean
          supports_stats?: boolean
          supports_table?: boolean
          text_capacity?: string
          text_map?: Json
          visual_weight?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_slide_profiles_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "presentation_designs"
            referencedColumns: ["id"]
          },
        ]
      }
      design_source_assets: {
        Row: {
          byte_size: number
          content_hash: string
          created_at: string
          design_id: string
          id: string
          image_count: number
          original_filename: string
          slide_count: number
          source: Database["public"]["Enums"]["design_source"]
          storage_path: string
          text_node_count: number
          uploaded_by: string | null
        }
        Insert: {
          byte_size?: number
          content_hash: string
          created_at?: string
          design_id: string
          id?: string
          image_count?: number
          original_filename?: string
          slide_count?: number
          source: Database["public"]["Enums"]["design_source"]
          storage_path: string
          text_node_count?: number
          uploaded_by?: string | null
        }
        Update: {
          byte_size?: number
          content_hash?: string
          created_at?: string
          design_id?: string
          id?: string
          image_count?: number
          original_filename?: string
          slide_count?: number
          source?: Database["public"]["Enums"]["design_source"]
          storage_path?: string
          text_node_count?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "design_source_assets_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "presentation_designs"
            referencedColumns: ["id"]
          },
        ]
      }
      design_topic_synonyms: {
        Row: {
          id: string
          normalized: string
          term: string
          topic_id: string
        }
        Insert: {
          id?: string
          normalized: string
          term: string
          topic_id: string
        }
        Update: {
          id?: string
          normalized?: string
          term?: string
          topic_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "design_topic_synonyms_topic_id_fkey"
            columns: ["topic_id"]
            isOneToOne: false
            referencedRelation: "design_topics"
            referencedColumns: ["id"]
          },
        ]
      }
      design_topics: {
        Row: {
          created_at: string
          family: string
          id: string
          label_uz: string
          slug: string
          sort_order: number
        }
        Insert: {
          created_at?: string
          family?: string
          id?: string
          label_uz: string
          slug: string
          sort_order?: number
        }
        Update: {
          created_at?: string
          family?: string
          id?: string
          label_uz?: string
          slug?: string
          sort_order?: number
        }
        Relationships: []
      }
      export_jobs: {
        Row: {
          completed_at: string | null
          created_at: string
          error_message: string | null
          expires_at: string | null
          file_name: string | null
          format: Database["public"]["Enums"]["export_format"]
          id: string
          options: Json
          owner_id: string
          presentation_id: string
          progress: number
          size_bytes: number | null
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          storage_path: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          file_name?: string | null
          format: Database["public"]["Enums"]["export_format"]
          id?: string
          options?: Json
          owner_id: string
          presentation_id: string
          progress?: number
          size_bytes?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          error_message?: string | null
          expires_at?: string | null
          file_name?: string | null
          format?: Database["public"]["Enums"]["export_format"]
          id?: string
          options?: Json
          owner_id?: string
          presentation_id?: string
          progress?: number
          size_bytes?: number | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          storage_path?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "export_jobs_presentation_id_owner_id_fkey"
            columns: ["presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      finance_entries: {
        Row: {
          amount_usd: number
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["finance_kind"]
          note: string
          occurred_on: string
          period: Database["public"]["Enums"]["finance_period"]
          source: Database["public"]["Enums"]["finance_source"]
        }
        Insert: {
          amount_usd: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["finance_kind"]
          note?: string
          occurred_on?: string
          period?: Database["public"]["Enums"]["finance_period"]
          source: Database["public"]["Enums"]["finance_source"]
        }
        Update: {
          amount_usd?: number
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["finance_kind"]
          note?: string
          occurred_on?: string
          period?: Database["public"]["Enums"]["finance_period"]
          source?: Database["public"]["Enums"]["finance_source"]
        }
        Relationships: []
      }
      font_faces: {
        Row: {
          byte_size: number
          content_hash: string
          created_at: string
          family_id: string
          format: string
          id: string
          italic: boolean
          storage_path: string
          style_name: string
          weight: number
        }
        Insert: {
          byte_size?: number
          content_hash: string
          created_at?: string
          family_id: string
          format?: string
          id?: string
          italic?: boolean
          storage_path: string
          style_name?: string
          weight?: number
        }
        Update: {
          byte_size?: number
          content_hash?: string
          created_at?: string
          family_id?: string
          format?: string
          id?: string
          italic?: boolean
          storage_path?: string
          style_name?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "font_faces_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "font_families"
            referencedColumns: ["id"]
          },
        ]
      }
      font_families: {
        Row: {
          canonical_name: string
          category: string
          created_at: string
          id: string
          is_active: boolean
          is_featured: boolean
          is_variable: boolean
          license_metadata: Json
          normalized_name: string
          source: string
          updated_at: string
        }
        Insert: {
          canonical_name: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_featured?: boolean
          is_variable?: boolean
          license_metadata?: Json
          normalized_name: string
          source?: string
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          category?: string
          created_at?: string
          id?: string
          is_active?: boolean
          is_featured?: boolean
          is_variable?: boolean
          license_metadata?: Json
          normalized_name?: string
          source?: string
          updated_at?: string
        }
        Relationships: []
      }
      game_answers: {
        Row: {
          ai_confidence: number | null
          id: string
          is_correct: boolean | null
          payload: Json
          player_id: string
          question_id: string
          question_index: number
          response_ms: number
          reviewed_by_host: boolean
          score_awarded: number
          session_id: string
          submitted_at: string
        }
        Insert: {
          ai_confidence?: number | null
          id?: string
          is_correct?: boolean | null
          payload?: Json
          player_id: string
          question_id: string
          question_index: number
          response_ms?: number
          reviewed_by_host?: boolean
          score_awarded?: number
          session_id: string
          submitted_at?: string
        }
        Update: {
          ai_confidence?: number | null
          id?: string
          is_correct?: boolean | null
          payload?: Json
          player_id?: string
          question_id?: string
          question_index?: number
          response_ms?: number
          reviewed_by_host?: boolean
          score_awarded?: number
          session_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_answers_player_id_fkey"
            columns: ["player_id"]
            isOneToOne: false
            referencedRelation: "game_players"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "game_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "game_answers_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      game_categories: {
        Row: {
          code: string
          created_at: string
          icon: string
          id: string
          is_active: boolean
          label: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          label: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          icon?: string
          id?: string
          is_active?: boolean
          label?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "game_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      game_pairing_tokens: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          expires_at: string
          session_id: string
          token: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          expires_at: string
          session_id: string
          token: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          expires_at?: string
          session_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_pairing_tokens_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      game_players: {
        Row: {
          avatar_id: number
          correct_count: number
          id: string
          joined_at: string
          last_seen_at: string
          nickname: string
          rank: number | null
          reward_eligible: boolean
          session_id: string
          status: Database["public"]["Enums"]["game_player_status"]
          team: string | null
          total_score: number
          user_id: string
        }
        Insert: {
          avatar_id?: number
          correct_count?: number
          id?: string
          joined_at?: string
          last_seen_at?: string
          nickname: string
          rank?: number | null
          reward_eligible?: boolean
          session_id: string
          status?: Database["public"]["Enums"]["game_player_status"]
          team?: string | null
          total_score?: number
          user_id: string
        }
        Update: {
          avatar_id?: number
          correct_count?: number
          id?: string
          joined_at?: string
          last_seen_at?: string
          nickname?: string
          rank?: number | null
          reward_eligible?: boolean
          session_id?: string
          status?: Database["public"]["Enums"]["game_player_status"]
          team?: string | null
          total_score?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_players_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "game_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      game_questions: {
        Row: {
          base_points: number
          config: Json
          created_at: string
          explanation: string
          game_id: string
          id: string
          media_path: string | null
          owner_id: string
          position: number
          prompt: string
          time_limit_seconds: number
          type: Database["public"]["Enums"]["game_question_type"]
          updated_at: string
        }
        Insert: {
          base_points?: number
          config?: Json
          created_at?: string
          explanation?: string
          game_id: string
          id?: string
          media_path?: string | null
          owner_id: string
          position?: number
          prompt?: string
          time_limit_seconds?: number
          type: Database["public"]["Enums"]["game_question_type"]
          updated_at?: string
        }
        Update: {
          base_points?: number
          config?: Json
          created_at?: string
          explanation?: string
          game_id?: string
          id?: string
          media_path?: string | null
          owner_id?: string
          position?: number
          prompt?: string
          time_limit_seconds?: number
          type?: Database["public"]["Enums"]["game_question_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "game_questions_game_owner_fkey"
            columns: ["game_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      game_sessions: {
        Row: {
          created_at: string
          current_index: number
          ended_at: string | null
          expires_at: string
          game_id: string | null
          host_user_id: string | null
          id: string
          join_code: string
          join_token: string
          last_advance_at: string | null
          phase_deadline: string | null
          player_count: number
          question_ids: string[]
          question_started_at: string | null
          realtime_token: string
          reward_plan: Json
          reward_reserved: number
          reward_state: string
          screen_token_hash: string | null
          show_on_phones: boolean
          sound_enabled: boolean
          started_at: string | null
          state_version: number
          status: Database["public"]["Enums"]["game_session_status"]
          team_mode: boolean
          teams: Json
        }
        Insert: {
          created_at?: string
          current_index?: number
          ended_at?: string | null
          expires_at?: string
          game_id?: string | null
          host_user_id?: string | null
          id?: string
          join_code: string
          join_token: string
          last_advance_at?: string | null
          phase_deadline?: string | null
          player_count?: number
          question_ids?: string[]
          question_started_at?: string | null
          realtime_token: string
          reward_plan?: Json
          reward_reserved?: number
          reward_state?: string
          screen_token_hash?: string | null
          show_on_phones?: boolean
          sound_enabled?: boolean
          started_at?: string | null
          state_version?: number
          status?: Database["public"]["Enums"]["game_session_status"]
          team_mode?: boolean
          teams?: Json
        }
        Update: {
          created_at?: string
          current_index?: number
          ended_at?: string | null
          expires_at?: string
          game_id?: string | null
          host_user_id?: string | null
          id?: string
          join_code?: string
          join_token?: string
          last_advance_at?: string | null
          phase_deadline?: string | null
          player_count?: number
          question_ids?: string[]
          question_started_at?: string | null
          realtime_token?: string
          reward_plan?: Json
          reward_reserved?: number
          reward_state?: string
          screen_token_hash?: string | null
          show_on_phones?: boolean
          sound_enabled?: boolean
          started_at?: string | null
          state_version?: number
          status?: Database["public"]["Enums"]["game_session_status"]
          team_mode?: boolean
          teams?: Json
        }
        Relationships: [
          {
            foreignKeyName: "game_sessions_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
        ]
      }
      games: {
        Row: {
          audience: string
          category_id: string | null
          cover_path: string | null
          created_at: string
          description: string
          difficulty: string
          failure_code: string | null
          failure_detail: string | null
          failure_reason: string | null
          featured_at: string | null
          id: string
          is_free: boolean
          owner_id: string
          question_count: number
          sessions_count: number
          source_presentation_id: string | null
          source_type: Database["public"]["Enums"]["game_source"]
          status: Database["public"]["Enums"]["game_status"]
          title: string
          updated_at: string
        }
        Insert: {
          audience?: string
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          description?: string
          difficulty?: string
          failure_code?: string | null
          failure_detail?: string | null
          failure_reason?: string | null
          featured_at?: string | null
          id?: string
          is_free?: boolean
          owner_id: string
          question_count?: number
          sessions_count?: number
          source_presentation_id?: string | null
          source_type?: Database["public"]["Enums"]["game_source"]
          status?: Database["public"]["Enums"]["game_status"]
          title?: string
          updated_at?: string
        }
        Update: {
          audience?: string
          category_id?: string | null
          cover_path?: string | null
          created_at?: string
          description?: string
          difficulty?: string
          failure_code?: string | null
          failure_detail?: string | null
          failure_reason?: string | null
          featured_at?: string | null
          id?: string
          is_free?: boolean
          owner_id?: string
          question_count?: number
          sessions_count?: number
          source_presentation_id?: string | null
          source_type?: Database["public"]["Enums"]["game_source"]
          status?: Database["public"]["Enums"]["game_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "games_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "game_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "games_source_presentation_id_fkey"
            columns: ["source_presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      generation_jobs: {
        Row: {
          actual_credits: number
          attempt_count: number
          completed_at: string | null
          context: Json
          created_at: string
          error_code: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          idempotency_key: string
          owner_id: string
          presentation_id: string
          progress: number
          provider: string | null
          provider_job_id: string | null
          reserved_credits: number
          stage: string
          started_at: string | null
          status: Database["public"]["Enums"]["job_status"]
          updated_at: string
        }
        Insert: {
          actual_credits?: number
          attempt_count?: number
          completed_at?: string | null
          context?: Json
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key: string
          owner_id: string
          presentation_id: string
          progress?: number
          provider?: string | null
          provider_job_id?: string | null
          reserved_credits?: number
          stage?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Update: {
          actual_credits?: number
          attempt_count?: number
          completed_at?: string | null
          context?: Json
          created_at?: string
          error_code?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          idempotency_key?: string
          owner_id?: string
          presentation_id?: string
          progress?: number
          provider?: string | null
          provider_job_id?: string | null
          reserved_credits?: number
          stage?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["job_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_jobs_presentation_id_owner_id_fkey"
            columns: ["presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      generation_steps: {
        Row: {
          completed_at: string | null
          created_at: string
          details: Json
          duration_ms: number | null
          error_code: string | null
          id: string
          job_id: string
          key: string
          label: string
          message: string | null
          owner_id: string
          presentation_id: string
          progress: number
          sequence: number
          started_at: string | null
          status: Database["public"]["Enums"]["step_status"]
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          created_at?: string
          details?: Json
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          job_id: string
          key: string
          label: string
          message?: string | null
          owner_id: string
          presentation_id: string
          progress?: number
          sequence: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["step_status"]
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          created_at?: string
          details?: Json
          duration_ms?: number | null
          error_code?: string | null
          id?: string
          job_id?: string
          key?: string
          label?: string
          message?: string | null
          owner_id?: string
          presentation_id?: string
          progress?: number
          sequence?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["step_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "generation_steps_job_id_presentation_id_owner_id_fkey"
            columns: ["job_id", "presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "generation_jobs"
            referencedColumns: ["id", "presentation_id", "owner_id"]
          },
        ]
      }
      jelement_aliases: {
        Row: {
          alias: string
          element_id: string
          id: string
          kind: string
          language: string
          normalized: string
        }
        Insert: {
          alias: string
          element_id: string
          id?: string
          kind?: string
          language?: string
          normalized: string
        }
        Update: {
          alias?: string
          element_id?: string
          id?: string
          kind?: string
          language?: string
          normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "jelement_aliases_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "jelements"
            referencedColumns: ["id"]
          },
        ]
      }
      jelement_families: {
        Row: {
          category: string
          color_tokens: Json
          content_hash: string | null
          created_at: string
          created_by: string | null
          description: string
          format_version: string
          id: string
          name: string
          published_at: string | null
          published_version: number
          search_metadata: Json
          slug: string
          source_prompt: string
          status: Database["public"]["Enums"]["jelement_status"]
          style: string
          subcategory: string
          thumbnail_path: string | null
          updated_at: string
          visual_dna: Json
        }
        Insert: {
          category?: string
          color_tokens?: Json
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          format_version?: string
          id?: string
          name: string
          published_at?: string | null
          published_version?: number
          search_metadata?: Json
          slug: string
          source_prompt?: string
          status?: Database["public"]["Enums"]["jelement_status"]
          style?: string
          subcategory?: string
          thumbnail_path?: string | null
          updated_at?: string
          visual_dna?: Json
        }
        Update: {
          category?: string
          color_tokens?: Json
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          format_version?: string
          id?: string
          name?: string
          published_at?: string | null
          published_version?: number
          search_metadata?: Json
          slug?: string
          source_prompt?: string
          status?: Database["public"]["Enums"]["jelement_status"]
          style?: string
          subcategory?: string
          thumbnail_path?: string | null
          updated_at?: string
          visual_dna?: Json
        }
        Relationships: []
      }
      jelement_usage: {
        Row: {
          created_at: string
          element_id: string
          id: string
          presentation_id: string | null
          query: string | null
          slide_id: string | null
          slide_role: string | null
        }
        Insert: {
          created_at?: string
          element_id: string
          id?: string
          presentation_id?: string | null
          query?: string | null
          slide_id?: string | null
          slide_role?: string | null
        }
        Update: {
          created_at?: string
          element_id?: string
          id?: string
          presentation_id?: string | null
          query?: string | null
          slide_id?: string | null
          slide_role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jelement_usage_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "jelements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jelement_usage_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jelement_usage_slide_id_fkey"
            columns: ["slide_id"]
            isOneToOne: false
            referencedRelation: "slides"
            referencedColumns: ["id"]
          },
        ]
      }
      jelement_versions: {
        Row: {
          content_hash: string
          element_id: string
          id: string
          published_at: string
          published_by: string | null
          spec: Json
          version: number
        }
        Insert: {
          content_hash: string
          element_id: string
          id?: string
          published_at?: string
          published_by?: string | null
          spec: Json
          version: number
        }
        Update: {
          content_hash?: string
          element_id?: string
          id?: string
          published_at?: string
          published_by?: string | null
          spec?: Json
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "jelement_versions_element_id_fkey"
            columns: ["element_id"]
            isOneToOne: false
            referencedRelation: "jelements"
            referencedColumns: ["id"]
          },
        ]
      }
      jelements: {
        Row: {
          appearance: Json
          asset_accent_hue: number | null
          asset_path: string | null
          asset_recolorable: boolean
          asset_variants: Json
          canonical_name: string
          category: string
          created_at: string
          display_name: string
          family_id: string
          geometry: Json
          id: string
          object_class: string
          position: number
          published_at: string | null
          published_version: number
          render_spec: Json | null
          semantic: Json
          status: Database["public"]["Enums"]["jelement_status"]
          subcategory: string
          thumbnail_path: string | null
          transform_rules: Json
          updated_at: string
          usage_count: number
          usage_rules: Json
        }
        Insert: {
          appearance?: Json
          asset_accent_hue?: number | null
          asset_path?: string | null
          asset_recolorable?: boolean
          asset_variants?: Json
          canonical_name: string
          category?: string
          created_at?: string
          display_name?: string
          family_id: string
          geometry?: Json
          id?: string
          object_class?: string
          position?: number
          published_at?: string | null
          published_version?: number
          render_spec?: Json | null
          semantic?: Json
          status?: Database["public"]["Enums"]["jelement_status"]
          subcategory?: string
          thumbnail_path?: string | null
          transform_rules?: Json
          updated_at?: string
          usage_count?: number
          usage_rules?: Json
        }
        Update: {
          appearance?: Json
          asset_accent_hue?: number | null
          asset_path?: string | null
          asset_recolorable?: boolean
          asset_variants?: Json
          canonical_name?: string
          category?: string
          created_at?: string
          display_name?: string
          family_id?: string
          geometry?: Json
          id?: string
          object_class?: string
          position?: number
          published_at?: string | null
          published_version?: number
          render_spec?: Json | null
          semantic?: Json
          status?: Database["public"]["Enums"]["jelement_status"]
          subcategory?: string
          thumbnail_path?: string | null
          transform_rules?: Json
          updated_at?: string
          usage_count?: number
          usage_rules?: Json
        }
        Relationships: [
          {
            foreignKeyName: "jelements_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "jelement_families"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_categories: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          label: string
          parent_id: string | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          is_active?: boolean
          label: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string
          parent_id?: string | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_categories_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "marketplace_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_favorites: {
        Row: {
          created_at: string
          product_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          product_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          product_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_favorites_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_licenses: {
        Row: {
          download_allowed: boolean
          editable: boolean
          granted_at: string
          id: string
          license_type: string
          presentable: boolean
          presentation_id: string | null
          product_id: string
          resale_allowed: boolean
          source_type: string
          user_id: string
        }
        Insert: {
          download_allowed?: boolean
          editable?: boolean
          granted_at?: string
          id?: string
          license_type: string
          presentable?: boolean
          presentation_id?: string | null
          product_id: string
          resale_allowed?: boolean
          source_type?: string
          user_id: string
        }
        Update: {
          download_allowed?: boolean
          editable?: boolean
          granted_at?: string
          id?: string
          license_type?: string
          presentable?: boolean
          presentation_id?: string | null
          product_id?: string
          resale_allowed?: boolean
          source_type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_licenses_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_licenses_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_material_types: {
        Row: {
          allowed_mime_types: string[]
          code: string
          created_at: string
          description: string
          is_active: boolean
          label: string
          max_file_bytes: number
          sort_order: number
          supports_editor_import: boolean
          supports_study_guide: boolean
          updated_at: string
        }
        Insert: {
          allowed_mime_types: string[]
          code: string
          created_at?: string
          description?: string
          is_active?: boolean
          label: string
          max_file_bytes?: number
          sort_order?: number
          supports_editor_import?: boolean
          supports_study_guide?: boolean
          updated_at?: string
        }
        Update: {
          allowed_mime_types?: string[]
          code?: string
          created_at?: string
          description?: string
          is_active?: boolean
          label?: string
          max_file_bytes?: number
          sort_order?: number
          supports_editor_import?: boolean
          supports_study_guide?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      marketplace_product_files: {
        Row: {
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["marketplace_file_kind"]
          mime_type: string
          original_name: string
          position: number
          product_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["marketplace_file_kind"]
          mime_type: string
          original_name?: string
          position?: number
          product_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["marketplace_file_kind"]
          mime_type?: string
          original_name?: string
          position?: number
          product_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_product_files_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_product_tags: {
        Row: {
          product_id: string
          tag_id: string
        }
        Insert: {
          product_id: string
          tag_id: string
        }
        Update: {
          product_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_product_tags_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_product_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "marketplace_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_products: {
        Row: {
          base_price: number
          category_id: string | null
          content_units: number | null
          cover_path: string | null
          created_at: string
          currency: string
          description: string
          file_format: string | null
          game_id: string | null
          has_study_guide: boolean
          id: string
          material_type: string
          moderated_at: string | null
          moderated_by: string | null
          published_at: string | null
          rating_count: number
          rating_sum: number
          rejection_reason: string | null
          sales_count: number
          search_text: unknown
          seller_id: string
          status: Database["public"]["Enums"]["marketplace_product_status"]
          title: string
          updated_at: string
        }
        Insert: {
          base_price: number
          category_id?: string | null
          content_units?: number | null
          cover_path?: string | null
          created_at?: string
          currency?: string
          description?: string
          file_format?: string | null
          game_id?: string | null
          has_study_guide?: boolean
          id?: string
          material_type: string
          moderated_at?: string | null
          moderated_by?: string | null
          published_at?: string | null
          rating_count?: number
          rating_sum?: number
          rejection_reason?: string | null
          sales_count?: number
          search_text?: unknown
          seller_id: string
          status?: Database["public"]["Enums"]["marketplace_product_status"]
          title: string
          updated_at?: string
        }
        Update: {
          base_price?: number
          category_id?: string | null
          content_units?: number | null
          cover_path?: string | null
          created_at?: string
          currency?: string
          description?: string
          file_format?: string | null
          game_id?: string | null
          has_study_guide?: boolean
          id?: string
          material_type?: string
          moderated_at?: string | null
          moderated_by?: string | null
          published_at?: string | null
          rating_count?: number
          rating_sum?: number
          rejection_reason?: string | null
          sales_count?: number
          search_text?: unknown
          seller_id?: string
          status?: Database["public"]["Enums"]["marketplace_product_status"]
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "marketplace_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_products_game_id_fkey"
            columns: ["game_id"]
            isOneToOne: false
            referencedRelation: "games"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_products_material_type_fkey"
            columns: ["material_type"]
            isOneToOne: false
            referencedRelation: "marketplace_material_types"
            referencedColumns: ["code"]
          },
        ]
      }
      marketplace_purchases: {
        Row: {
          base_price: number
          buyer_fee_amount: number
          buyer_fee_rate: number
          buyer_id: string
          buyer_total: number
          currency: string
          id: string
          is_sandbox: boolean
          platform_gross: number
          product_id: string
          provider_cost: number
          purchased_at: string
          refund_status: string
          refunded_amount: number
          refunded_at: string | null
          seller_fee_amount: number
          seller_fee_rate: number
          seller_id: string
          seller_net: number
          transaction_id: string
        }
        Insert: {
          base_price: number
          buyer_fee_amount: number
          buyer_fee_rate: number
          buyer_id: string
          buyer_total: number
          currency?: string
          id?: string
          is_sandbox?: boolean
          platform_gross: number
          product_id: string
          provider_cost?: number
          purchased_at?: string
          refund_status?: string
          refunded_amount?: number
          refunded_at?: string | null
          seller_fee_amount: number
          seller_fee_rate: number
          seller_id: string
          seller_net: number
          transaction_id: string
        }
        Update: {
          base_price?: number
          buyer_fee_amount?: number
          buyer_fee_rate?: number
          buyer_id?: string
          buyer_total?: number
          currency?: string
          id?: string
          is_sandbox?: boolean
          platform_gross?: number
          product_id?: string
          provider_cost?: number
          purchased_at?: string
          refund_status?: string
          refunded_amount?: number
          refunded_at?: string | null
          seller_fee_amount?: number
          seller_fee_rate?: number
          seller_id?: string
          seller_net?: number
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_purchases_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_purchases_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: true
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_reports: {
        Row: {
          created_at: string
          detail: string
          id: string
          product_id: string
          reason: Database["public"]["Enums"]["marketplace_report_reason"]
          reporter_id: string
          resolution_note: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["marketplace_report_status"]
        }
        Insert: {
          created_at?: string
          detail?: string
          id?: string
          product_id: string
          reason: Database["public"]["Enums"]["marketplace_report_reason"]
          reporter_id: string
          resolution_note?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["marketplace_report_status"]
        }
        Update: {
          created_at?: string
          detail?: string
          id?: string
          product_id?: string
          reason?: Database["public"]["Enums"]["marketplace_report_reason"]
          reporter_id?: string
          resolution_note?: string
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["marketplace_report_status"]
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_reports_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_reviews: {
        Row: {
          body: string
          buyer_id: string
          created_at: string
          id: string
          product_id: string
          rating: number
          updated_at: string
        }
        Insert: {
          body?: string
          buyer_id: string
          created_at?: string
          id?: string
          product_id: string
          rating: number
          updated_at?: string
        }
        Update: {
          body?: string
          buyer_id?: string
          created_at?: string
          id?: string
          product_id?: string
          rating?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_tags: {
        Row: {
          created_at: string
          id: string
          label: string
          slug: string
          usage_count: number
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          slug: string
          usage_count?: number
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          slug?: string
          usage_count?: number
        }
        Relationships: []
      }
      module_entitlements: {
        Row: {
          created_at: string
          currency: string
          expires_at: string
          granted_by: string | null
          id: string
          metadata: Json
          module_code: string
          payment_reference: string | null
          purchased_amount: number
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["entitlement_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          expires_at: string
          granted_by?: string | null
          id?: string
          metadata?: Json
          module_code: string
          payment_reference?: string | null
          purchased_amount?: number
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          expires_at?: string
          granted_by?: string | null
          id?: string
          metadata?: Json
          module_code?: string
          payment_reference?: string | null
          purchased_amount?: number
          source?: string
          starts_at?: string
          status?: Database["public"]["Enums"]["entitlement_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          body: string
          created_at: string
          deep_link: string | null
          entity_id: string | null
          id: string
          kind: Database["public"]["Enums"]["notification_kind"]
          payload: Json
          read_at: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          deep_link?: string | null
          entity_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          read_at?: string | null
          title: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          deep_link?: string | null
          entity_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["notification_kind"]
          payload?: Json
          read_at?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      objective_documents: {
        Row: {
          created_at: string
          fields: Json
          full_name: string
          id: string
          owner_id: string
          portrait_id: string | null
          relatives: Json
          updated_at: string
          work: Json
        }
        Insert: {
          created_at?: string
          fields?: Json
          full_name?: string
          id?: string
          owner_id: string
          portrait_id?: string | null
          relatives?: Json
          updated_at?: string
          work?: Json
        }
        Update: {
          created_at?: string
          fields?: Json
          full_name?: string
          id?: string
          owner_id?: string
          portrait_id?: string | null
          relatives?: Json
          updated_at?: string
          work?: Json
        }
        Relationships: [
          {
            foreignKeyName: "objective_documents_portrait_id_fkey"
            columns: ["portrait_id"]
            isOneToOne: false
            referencedRelation: "portrait_sheets"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          attempt_expires_at: string | null
          buyer_fee: number
          buyer_fee_rate: number
          cancelled_at: string | null
          coin_package_id: string | null
          created_at: string
          currency: string
          expires_at: string
          failure_code: string | null
          failure_message: string | null
          id: string
          is_test: boolean
          metadata: Json
          order_number: string
          paid_at: string | null
          payme_receipt_id: string | null
          payme_transaction_id: string | null
          platform_revenue: number
          product_id: string | null
          provider_card_token: string | null
          purpose: Database["public"]["Enums"]["order_purpose"]
          reference_code: string | null
          seller_fee: number
          seller_fee_rate: number
          seller_id: string | null
          seller_net: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_expires_at?: string | null
          buyer_fee?: number
          buyer_fee_rate?: number
          cancelled_at?: string | null
          coin_package_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          is_test?: boolean
          metadata?: Json
          order_number?: string
          paid_at?: string | null
          payme_receipt_id?: string | null
          payme_transaction_id?: string | null
          platform_revenue?: number
          product_id?: string | null
          provider_card_token?: string | null
          purpose: Database["public"]["Enums"]["order_purpose"]
          reference_code?: string | null
          seller_fee?: number
          seller_fee_rate?: number
          seller_id?: string | null
          seller_net?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_expires_at?: string | null
          buyer_fee?: number
          buyer_fee_rate?: number
          cancelled_at?: string | null
          coin_package_id?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          failure_code?: string | null
          failure_message?: string | null
          id?: string
          is_test?: boolean
          metadata?: Json
          order_number?: string
          paid_at?: string | null
          payme_receipt_id?: string | null
          payme_transaction_id?: string | null
          platform_revenue?: number
          product_id?: string | null
          provider_card_token?: string | null
          purpose?: Database["public"]["Enums"]["order_purpose"]
          reference_code?: string | null
          seller_fee?: number
          seller_fee_rate?: number
          seller_id?: string | null
          seller_net?: number
          status?: Database["public"]["Enums"]["order_status"]
          subtotal?: number
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "orders_coin_package_id_fkey"
            columns: ["coin_package_id"]
            isOneToOne: false
            referencedRelation: "coin_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      palette_families: {
        Row: {
          code: string
          created_at: string
          is_active: boolean
          name: string
          sort_order: number
          tokens: Json
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          is_active?: boolean
          name: string
          sort_order?: number
          tokens: Json
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          sort_order?: number
          tokens?: Json
          updated_at?: string
        }
        Relationships: []
      }
      partial_cards: {
        Row: {
          created_at: string
          display_pan: string
          expiry_month: number
          expiry_year: number
          id: string
          is_active: boolean
          last_used_at: string | null
          last4: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_pan: string
          expiry_month: number
          expiry_year: number
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          last4: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_pan?: string
          expiry_month?: number
          expiry_year?: number
          id?: string
          is_active?: boolean
          last_used_at?: string | null
          last4?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_audit_events: {
        Row: {
          created_at: string
          event: string
          id: string
          message: string
          metadata: Json
          provider_code: string | null
          state_from: Database["public"]["Enums"]["payment_state"] | null
          state_to: Database["public"]["Enums"]["payment_state"] | null
          transaction_id: string
        }
        Insert: {
          created_at?: string
          event: string
          id?: string
          message?: string
          metadata?: Json
          provider_code?: string | null
          state_from?: Database["public"]["Enums"]["payment_state"] | null
          state_to?: Database["public"]["Enums"]["payment_state"] | null
          transaction_id: string
        }
        Update: {
          created_at?: string
          event?: string
          id?: string
          message?: string
          metadata?: Json
          provider_code?: string | null
          state_from?: Database["public"]["Enums"]["payment_state"] | null
          state_to?: Database["public"]["Enums"]["payment_state"] | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_audit_events_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_card_attempts: {
        Row: {
          consumed_at: string | null
          created_at: string
          display_pan: string
          expires_at: string
          expiry_month: number
          expiry_year: number
          id: string
          provider_token: string | null
          subject_id: string
          subject_kind: string
          updated_at: string
          user_id: string
        }
        Insert: {
          consumed_at?: string | null
          created_at?: string
          display_pan: string
          expires_at: string
          expiry_month: number
          expiry_year: number
          id?: string
          provider_token?: string | null
          subject_id: string
          subject_kind: string
          updated_at?: string
          user_id: string
        }
        Update: {
          consumed_at?: string | null
          created_at?: string
          display_pan?: string
          expires_at?: string
          expiry_month?: number
          expiry_year?: number
          id?: string
          provider_token?: string | null
          subject_id?: string
          subject_kind?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          attempt_expires_at: string | null
          base_price: number
          buyer_fee_amount: number
          buyer_fee_rate: number
          buyer_id: string
          buyer_total: number
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          is_sandbox: boolean
          order_id: string | null
          paid_at: string | null
          partial_card_id: string | null
          platform_gross: number
          product_id: string
          provider: string
          provider_card_token: string | null
          provider_cost: number
          provider_error_code: string | null
          provider_error_message: string | null
          provider_receipt_id: string | null
          seller_fee_amount: number
          seller_fee_rate: number
          seller_id: string
          seller_net: number
          state: Database["public"]["Enums"]["payment_state"]
          updated_at: string
        }
        Insert: {
          attempt_expires_at?: string | null
          base_price: number
          buyer_fee_amount: number
          buyer_fee_rate: number
          buyer_id: string
          buyer_total: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          id?: string
          idempotency_key: string
          is_sandbox?: boolean
          order_id?: string | null
          paid_at?: string | null
          partial_card_id?: string | null
          platform_gross: number
          product_id: string
          provider?: string
          provider_card_token?: string | null
          provider_cost?: number
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_receipt_id?: string | null
          seller_fee_amount: number
          seller_fee_rate: number
          seller_id: string
          seller_net: number
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
        }
        Update: {
          attempt_expires_at?: string | null
          base_price?: number
          buyer_fee_amount?: number
          buyer_fee_rate?: number
          buyer_id?: string
          buyer_total?: number
          created_at?: string
          currency?: string
          failed_at?: string | null
          id?: string
          idempotency_key?: string
          is_sandbox?: boolean
          order_id?: string | null
          paid_at?: string | null
          partial_card_id?: string | null
          platform_gross?: number
          product_id?: string
          provider?: string
          provider_card_token?: string | null
          provider_cost?: number
          provider_error_code?: string | null
          provider_error_message?: string | null
          provider_receipt_id?: string | null
          seller_fee_amount?: number
          seller_fee_rate?: number
          seller_id?: string
          seller_net?: number
          state?: Database["public"]["Enums"]["payment_state"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_partial_card_id_fkey"
            columns: ["partial_card_id"]
            isOneToOne: false
            referencedRelation: "partial_cards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
        ]
      }
      portrait_sheets: {
        Row: {
          created_at: string
          id: string
          owner_id: string
          sheet_path: string | null
          source_height: number | null
          source_path: string
          source_width: number | null
          warnings: Json
        }
        Insert: {
          created_at?: string
          id?: string
          owner_id: string
          sheet_path?: string | null
          source_height?: number | null
          source_path: string
          source_width?: number | null
          warnings?: Json
        }
        Update: {
          created_at?: string
          id?: string
          owner_id?: string
          sheet_path?: string | null
          source_height?: number | null
          source_path?: string
          source_width?: number | null
          warnings?: Json
        }
        Relationships: []
      }
      presentation_assets: {
        Row: {
          alt_text: string | null
          attribution: string | null
          byte_size: number | null
          created_at: string
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          license_name: string | null
          license_url: string | null
          metadata: Json
          mime_type: string | null
          owner_id: string
          presentation_id: string
          provider: string | null
          provider_asset_id: string | null
          source_url: string | null
          storage_bucket: string | null
          storage_path: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          alt_text?: string | null
          attribution?: string | null
          byte_size?: number | null
          created_at?: string
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["asset_kind"]
          license_name?: string | null
          license_url?: string | null
          metadata?: Json
          mime_type?: string | null
          owner_id: string
          presentation_id: string
          provider?: string | null
          provider_asset_id?: string | null
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          alt_text?: string | null
          attribution?: string | null
          byte_size?: number | null
          created_at?: string
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          license_name?: string | null
          license_url?: string | null
          metadata?: Json
          mime_type?: string | null
          owner_id?: string
          presentation_id?: string
          provider?: string | null
          provider_asset_id?: string | null
          source_url?: string | null
          storage_bucket?: string | null
          storage_path?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "presentation_assets_presentation_id_owner_id_fkey"
            columns: ["presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      presentation_defenses: {
        Row: {
          conclusion: string
          created_at: string
          failure_reason: string | null
          introduction: string
          owner_id: string
          presentation_id: string
          sections: Json
          status: string
          updated_at: string
          written_for: string | null
        }
        Insert: {
          conclusion?: string
          created_at?: string
          failure_reason?: string | null
          introduction?: string
          owner_id: string
          presentation_id: string
          sections?: Json
          status?: string
          updated_at?: string
          written_for?: string | null
        }
        Update: {
          conclusion?: string
          created_at?: string
          failure_reason?: string | null
          introduction?: string
          owner_id?: string
          presentation_id?: string
          sections?: Json
          status?: string
          updated_at?: string
          written_for?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "presentation_defenses_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: true
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_design_fonts: {
        Row: {
          asset_path: string | null
          byte_size: number | null
          checksum: string | null
          created_at: string
          design_id: string
          fallback: string
          font_id: string
          format: string | null
          id: string
          italic: boolean
          name: string
          roles: string[]
          weight: number
        }
        Insert: {
          asset_path?: string | null
          byte_size?: number | null
          checksum?: string | null
          created_at?: string
          design_id: string
          fallback?: string
          font_id: string
          format?: string | null
          id?: string
          italic?: boolean
          name?: string
          roles?: string[]
          weight?: number
        }
        Update: {
          asset_path?: string | null
          byte_size?: number | null
          checksum?: string | null
          created_at?: string
          design_id?: string
          fallback?: string
          font_id?: string
          format?: string | null
          id?: string
          italic?: boolean
          name?: string
          roles?: string[]
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "presentation_design_fonts_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "presentation_designs"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_design_versions: {
        Row: {
          compiled_config: Json
          content_hash: string
          design_id: string
          health_score: number | null
          id: string
          published_at: string
          published_by: string | null
          source_prompt: string
          version: number
        }
        Insert: {
          compiled_config: Json
          content_hash: string
          design_id: string
          health_score?: number | null
          id?: string
          published_at?: string
          published_by?: string | null
          source_prompt?: string
          version: number
        }
        Update: {
          compiled_config?: Json
          content_hash?: string
          design_id?: string
          health_score?: number | null
          id?: string
          published_at?: string
          published_by?: string | null
          source_prompt?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "presentation_design_versions_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "presentation_designs"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_designs: {
        Row: {
          compiled_config: Json | null
          content_hash: string | null
          created_at: string
          created_by: string | null
          description: string
          design_source: Database["public"]["Enums"]["design_source"]
          format_version: string
          health_score: number | null
          id: string
          is_featured: boolean
          is_premium: boolean
          keywords: Json
          name: string
          preview: Json
          published_at: string | null
          published_version: number
          slug: string
          sort_order: number
          source_asset_path: string | null
          source_prompt: string
          status: Database["public"]["Enums"]["jslayd_design_status"]
          thumbnail_path: string | null
          tier: Database["public"]["Enums"]["presentation_style"]
          updated_at: string
        }
        Insert: {
          compiled_config?: Json | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          design_source?: Database["public"]["Enums"]["design_source"]
          format_version?: string
          health_score?: number | null
          id?: string
          is_featured?: boolean
          is_premium?: boolean
          keywords?: Json
          name: string
          preview?: Json
          published_at?: string | null
          published_version?: number
          slug: string
          sort_order?: number
          source_asset_path?: string | null
          source_prompt?: string
          status?: Database["public"]["Enums"]["jslayd_design_status"]
          thumbnail_path?: string | null
          tier: Database["public"]["Enums"]["presentation_style"]
          updated_at?: string
        }
        Update: {
          compiled_config?: Json | null
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          design_source?: Database["public"]["Enums"]["design_source"]
          format_version?: string
          health_score?: number | null
          id?: string
          is_featured?: boolean
          is_premium?: boolean
          keywords?: Json
          name?: string
          preview?: Json
          published_at?: string | null
          published_version?: number
          slug?: string
          sort_order?: number
          source_asset_path?: string | null
          source_prompt?: string
          status?: Database["public"]["Enums"]["jslayd_design_status"]
          thumbnail_path?: string | null
          tier?: Database["public"]["Enums"]["presentation_style"]
          updated_at?: string
        }
        Relationships: []
      }
      presentation_edit_history: {
        Row: {
          actor_id: string
          created_at: string
          id: string
          inverse_operation: Json
          operation: Json
          owner_id: string
          presentation_id: string
          slide_id: string | null
          version: number
        }
        Insert: {
          actor_id: string
          created_at?: string
          id?: string
          inverse_operation: Json
          operation: Json
          owner_id: string
          presentation_id: string
          slide_id?: string | null
          version: number
        }
        Update: {
          actor_id?: string
          created_at?: string
          id?: string
          inverse_operation?: Json
          operation?: Json
          owner_id?: string
          presentation_id?: string
          slide_id?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "presentation_edit_history_presentation_id_owner_id_fkey"
            columns: ["presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "presentation_edit_history_slide_id_fkey"
            columns: ["slide_id"]
            isOneToOne: false
            referencedRelation: "slides"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentation_edit_history_slide_id_presentation_id_owner_i_fkey"
            columns: ["slide_id", "presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "slides"
            referencedColumns: ["id", "presentation_id", "owner_id"]
          },
        ]
      }
      presentation_pairing_tokens: {
        Row: {
          consumed_at: string | null
          consumed_by: string | null
          created_at: string
          expires_at: string
          session_id: string
          token: string
        }
        Insert: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          expires_at: string
          session_id: string
          token: string
        }
        Update: {
          consumed_at?: string | null
          consumed_by?: string | null
          created_at?: string
          expires_at?: string
          session_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "presentation_pairing_tokens_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "presentation_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_sessions: {
        Row: {
          created_at: string
          current_slide: number
          deck_revision: number
          ended_at: string | null
          expires_at: string
          host_user_id: string | null
          id: string
          last_command_at: string | null
          paired_at: string | null
          presentation_id: string | null
          realtime_token: string
          screen_token_hash: string
          slide_count: number
          state_version: number
          status: Database["public"]["Enums"]["presentation_session_status"]
          translate_x: number
          translate_y: number
          zoom: number
        }
        Insert: {
          created_at?: string
          current_slide?: number
          deck_revision?: number
          ended_at?: string | null
          expires_at?: string
          host_user_id?: string | null
          id?: string
          last_command_at?: string | null
          paired_at?: string | null
          presentation_id?: string | null
          realtime_token: string
          screen_token_hash: string
          slide_count?: number
          state_version?: number
          status?: Database["public"]["Enums"]["presentation_session_status"]
          translate_x?: number
          translate_y?: number
          zoom?: number
        }
        Update: {
          created_at?: string
          current_slide?: number
          deck_revision?: number
          ended_at?: string | null
          expires_at?: string
          host_user_id?: string | null
          id?: string
          last_command_at?: string | null
          paired_at?: string | null
          presentation_id?: string | null
          realtime_token?: string
          screen_token_hash?: string
          slide_count?: number
          state_version?: number
          status?: Database["public"]["Enums"]["presentation_session_status"]
          translate_x?: number
          translate_y?: number
          zoom?: number
        }
        Relationships: [
          {
            foreignKeyName: "presentation_sessions_presentation_id_fkey"
            columns: ["presentation_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id"]
          },
        ]
      }
      presentation_sources: {
        Row: {
          created_at: string
          id: string
          label: string
          metadata: Json
          owner_id: string
          position: number
          presentation_id: string
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          metadata?: Json
          owner_id: string
          position?: number
          presentation_id: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          metadata?: Json
          owner_id?: string
          position?: number
          presentation_id?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "presentation_sources_presentation_id_owner_id_fkey"
            columns: ["presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      presentations: {
        Row: {
          actual_credits: number
          author_name: string | null
          created_at: string
          current_version: number
          design_dna: Json | null
          design_engine: string | null
          design_id: string | null
          design_version: number | null
          error_message: string | null
          estimated_credits: number
          generated_slide_count: number
          generation_cost_usd: number
          id: string
          owner_id: string
          palette_code: string | null
          requested_slide_count: number
          reserved_credits: number
          status: Database["public"]["Enums"]["presentation_status"]
          style: Database["public"]["Enums"]["presentation_style"]
          teacher_name: string | null
          template_code: string | null
          thumbnail_path: string | null
          title: string
          topic: string
          updated_at: string
          visual_dna: Json
        }
        Insert: {
          actual_credits?: number
          author_name?: string | null
          created_at?: string
          current_version?: number
          design_dna?: Json | null
          design_engine?: string | null
          design_id?: string | null
          design_version?: number | null
          error_message?: string | null
          estimated_credits?: number
          generated_slide_count?: number
          generation_cost_usd?: number
          id?: string
          owner_id: string
          palette_code?: string | null
          requested_slide_count: number
          reserved_credits?: number
          status?: Database["public"]["Enums"]["presentation_status"]
          style: Database["public"]["Enums"]["presentation_style"]
          teacher_name?: string | null
          template_code?: string | null
          thumbnail_path?: string | null
          title: string
          topic: string
          updated_at?: string
          visual_dna?: Json
        }
        Update: {
          actual_credits?: number
          author_name?: string | null
          created_at?: string
          current_version?: number
          design_dna?: Json | null
          design_engine?: string | null
          design_id?: string | null
          design_version?: number | null
          error_message?: string | null
          estimated_credits?: number
          generated_slide_count?: number
          generation_cost_usd?: number
          id?: string
          owner_id?: string
          palette_code?: string | null
          requested_slide_count?: number
          reserved_credits?: number
          status?: Database["public"]["Enums"]["presentation_status"]
          style?: Database["public"]["Enums"]["presentation_style"]
          teacher_name?: string | null
          template_code?: string | null
          thumbnail_path?: string | null
          title?: string
          topic?: string
          updated_at?: string
          visual_dna?: Json
        }
        Relationships: [
          {
            foreignKeyName: "presentations_design_id_fkey"
            columns: ["design_id"]
            isOneToOne: false
            referencedRelation: "presentation_designs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "presentations_template_code_fkey"
            columns: ["template_code"]
            isOneToOne: false
            referencedRelation: "slide_templates"
            referencedColumns: ["code"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string
          created_at: string
          field_of_study: string | null
          first_name: string
          full_name: string
          id: string
          last_name: string
          last_seen_at: string | null
          organization: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string
          updated_at: string
          username: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          field_of_study?: string | null
          first_name?: string
          full_name?: string
          id: string
          last_name?: string
          last_seen_at?: string | null
          organization?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          timezone?: string
          updated_at?: string
          username?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string
          created_at?: string
          field_of_study?: string | null
          first_name?: string
          full_name?: string
          id?: string
          last_name?: string
          last_seen_at?: string | null
          organization?: string | null
          status?: Database["public"]["Enums"]["user_status"]
          timezone?: string
          updated_at?: string
          username?: string | null
        }
        Relationships: []
      }
      purchase_entitlements: {
        Row: {
          granted_at: string
          id: string
          product_id: string
          purchase_id: string
          revoked_at: string | null
          user_id: string
        }
        Insert: {
          granted_at?: string
          id?: string
          product_id: string
          purchase_id: string
          revoked_at?: string | null
          user_id: string
        }
        Update: {
          granted_at?: string
          id?: string
          product_id?: string
          purchase_id?: string
          revoked_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_entitlements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_entitlements_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "marketplace_purchases"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_video_experiences: {
        Row: {
          glow: number
          gradient_from: string
          gradient_to: string
          gradient_via: string
          intro_path: string | null
          is_enabled: boolean
          loop_path: string | null
          qr_appear_ms: number
          qr_background: string
          qr_size: number
          qr_x: number
          qr_y: number
          surface: Database["public"]["Enums"]["qr_video_surface"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          glow?: number
          gradient_from?: string
          gradient_to?: string
          gradient_via?: string
          intro_path?: string | null
          is_enabled?: boolean
          loop_path?: string | null
          qr_appear_ms?: number
          qr_background?: string
          qr_size?: number
          qr_x?: number
          qr_y?: number
          surface: Database["public"]["Enums"]["qr_video_surface"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          glow?: number
          gradient_from?: string
          gradient_to?: string
          gradient_via?: string
          intro_path?: string | null
          is_enabled?: boolean
          loop_path?: string | null
          qr_appear_ms?: number
          qr_background?: string
          qr_size?: number
          qr_x?: number
          qr_y?: number
          surface?: Database["public"]["Enums"]["qr_video_surface"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      seller_ledger_entries: {
        Row: {
          created_at: string
          currency: string
          fee_amount: number
          gross_amount: number
          id: string
          is_sandbox: boolean
          net_amount: number
          product_id: string
          purchase_id: string
          seller_id: string
          settlement_id: string | null
          status: Database["public"]["Enums"]["seller_ledger_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          fee_amount: number
          gross_amount: number
          id?: string
          is_sandbox?: boolean
          net_amount: number
          product_id: string
          purchase_id: string
          seller_id: string
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["seller_ledger_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          fee_amount?: number
          gross_amount?: number
          id?: string
          is_sandbox?: boolean
          net_amount?: number
          product_id?: string
          purchase_id?: string
          seller_id?: string
          settlement_id?: string | null
          status?: Database["public"]["Enums"]["seller_ledger_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_ledger_entries_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_ledger_entries_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: true
            referencedRelation: "marketplace_purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_ledger_settlement_fk"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "seller_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_payout_contacts: {
        Row: {
          created_at: string
          note: string
          phone: string
          telegram_username: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          note?: string
          phone: string
          telegram_username?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          note?: string
          phone?: string
          telegram_username?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      seller_settlement_items: {
        Row: {
          ledger_entry_id: string
          settlement_id: string
        }
        Insert: {
          ledger_entry_id: string
          settlement_id: string
        }
        Update: {
          ledger_entry_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_settlement_items_ledger_entry_id_fkey"
            columns: ["ledger_entry_id"]
            isOneToOne: true
            referencedRelation: "seller_ledger_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "seller_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_settlements: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          destination_note: string
          gross_sales: number
          id: string
          notified_upcoming_at: string | null
          paid_at: string | null
          paid_by: string | null
          payable_amount: number
          period_end: string
          period_start: string
          reference: string
          seller_fees: number
          seller_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          destination_note?: string
          gross_sales?: number
          id?: string
          notified_upcoming_at?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payable_amount?: number
          period_end: string
          period_start: string
          reference?: string
          seller_fees?: number
          seller_id: string
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          destination_note?: string
          gross_sales?: number
          id?: string
          notified_upcoming_at?: string | null
          paid_at?: string | null
          paid_by?: string | null
          payable_amount?: number
          period_end?: string
          period_start?: string
          reference?: string
          seller_fees?: number
          seller_id?: string
          status?: Database["public"]["Enums"]["settlement_status"]
          updated_at?: string
        }
        Relationships: []
      }
      slide_elements: {
        Row: {
          content: Json
          created_at: string
          height: number
          id: string
          locked: boolean
          opacity: number
          owner_id: string
          presentation_id: string
          rotation: number
          slide_id: string
          style: Json
          type: Database["public"]["Enums"]["element_type"]
          updated_at: string
          width: number
          x: number
          y: number
          z_index: number
        }
        Insert: {
          content?: Json
          created_at?: string
          height: number
          id?: string
          locked?: boolean
          opacity?: number
          owner_id: string
          presentation_id: string
          rotation?: number
          slide_id: string
          style?: Json
          type: Database["public"]["Enums"]["element_type"]
          updated_at?: string
          width: number
          x: number
          y: number
          z_index?: number
        }
        Update: {
          content?: Json
          created_at?: string
          height?: number
          id?: string
          locked?: boolean
          opacity?: number
          owner_id?: string
          presentation_id?: string
          rotation?: number
          slide_id?: string
          style?: Json
          type?: Database["public"]["Enums"]["element_type"]
          updated_at?: string
          width?: number
          x?: number
          y?: number
          z_index?: number
        }
        Relationships: [
          {
            foreignKeyName: "slide_elements_slide_id_presentation_id_owner_id_fkey"
            columns: ["slide_id", "presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "slides"
            referencedColumns: ["id", "presentation_id", "owner_id"]
          },
        ]
      }
      slide_templates: {
        Row: {
          art_direction: Json
          code: string
          created_at: string
          is_active: boolean
          name: string
          preview: Json
          sort_order: number
          style: Database["public"]["Enums"]["presentation_style"]
          tagline: string
          updated_at: string
        }
        Insert: {
          art_direction?: Json
          code: string
          created_at?: string
          is_active?: boolean
          name: string
          preview?: Json
          sort_order?: number
          style: Database["public"]["Enums"]["presentation_style"]
          tagline?: string
          updated_at?: string
        }
        Update: {
          art_direction?: Json
          code?: string
          created_at?: string
          is_active?: boolean
          name?: string
          preview?: Json
          sort_order?: number
          style?: Database["public"]["Enums"]["presentation_style"]
          tagline?: string
          updated_at?: string
        }
        Relationships: []
      }
      slides: {
        Row: {
          background: Json
          created_at: string
          id: string
          layout: string
          owner_id: string
          position: number
          presentation_id: string
          quality_report: Json
          quality_score: number | null
          speaker_notes: string | null
          title: string | null
          updated_at: string
          version: number
        }
        Insert: {
          background?: Json
          created_at?: string
          id?: string
          layout?: string
          owner_id: string
          position: number
          presentation_id: string
          quality_report?: Json
          quality_score?: number | null
          speaker_notes?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Update: {
          background?: Json
          created_at?: string
          id?: string
          layout?: string
          owner_id?: string
          position?: number
          presentation_id?: string
          quality_report?: Json
          quality_score?: number | null
          speaker_notes?: string | null
          title?: string | null
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "slides_presentation_id_owner_id_fkey"
            columns: ["presentation_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
        ]
      }
      style_configs: {
        Row: {
          base_credits: number
          config: Json
          created_at: string
          credits_per_image: number
          credits_per_slide: number
          description: string
          expected_image_ratio: number
          is_active: boolean
          label: string
          style: Database["public"]["Enums"]["presentation_style"]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          base_credits: number
          config?: Json
          created_at?: string
          credits_per_image?: number
          credits_per_slide: number
          description?: string
          expected_image_ratio?: number
          is_active?: boolean
          label: string
          style: Database["public"]["Enums"]["presentation_style"]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          base_credits?: number
          config?: Json
          created_at?: string
          credits_per_image?: number
          credits_per_slide?: number
          description?: string
          expected_image_ratio?: number
          is_active?: boolean
          label?: string
          style?: Database["public"]["Enums"]["presentation_style"]
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          badge: string
          code: string
          compare_at_amount: number
          created_at: string
          cta_label: string
          currency: string
          description: string
          estimated_cost_amount: number
          features: Json
          id: string
          is_active: boolean
          is_featured: boolean
          name: string
          period_days: number
          price_amount: number
          sort_order: number
          subtitle: string
          updated_at: string
        }
        Insert: {
          badge?: string
          code: string
          compare_at_amount?: number
          created_at?: string
          cta_label?: string
          currency?: string
          description?: string
          estimated_cost_amount?: number
          features?: Json
          id?: string
          is_active?: boolean
          is_featured?: boolean
          name: string
          period_days?: number
          price_amount: number
          sort_order?: number
          subtitle?: string
          updated_at?: string
        }
        Update: {
          badge?: string
          code?: string
          compare_at_amount?: number
          created_at?: string
          cta_label?: string
          currency?: string
          description?: string
          estimated_cost_amount?: number
          features?: Json
          id?: string
          is_active?: boolean
          is_featured?: boolean
          name?: string
          period_days?: number
          price_amount?: number
          sort_order?: number
          subtitle?: string
          updated_at?: string
        }
        Relationships: []
      }
      subscription_restarts: {
        Row: {
          created_at: string
          discarded_days: number
          discarded_usage: Json
          id: string
          new_subscription_id: string | null
          order_id: string | null
          plan_code: string
          previous_subscription_id: string | null
          reason: string
          user_id: string
        }
        Insert: {
          created_at?: string
          discarded_days?: number
          discarded_usage?: Json
          id?: string
          new_subscription_id?: string | null
          order_id?: string | null
          plan_code: string
          previous_subscription_id?: string | null
          reason?: string
          user_id: string
        }
        Update: {
          created_at?: string
          discarded_days?: number
          discarded_usage?: Json
          id?: string
          new_subscription_id?: string | null
          order_id?: string | null
          plan_code?: string
          previous_subscription_id?: string | null
          reason?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "subscription_restarts_new_subscription_id_fkey"
            columns: ["new_subscription_id"]
            isOneToOne: false
            referencedRelation: "user_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_restarts_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "subscription_restarts_previous_subscription_id_fkey"
            columns: ["previous_subscription_id"]
            isOneToOne: false
            referencedRelation: "user_subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_usage: {
        Row: {
          feature_key: string
          id: string
          period_start: string
          updated_at: string
          used: number
          user_id: string
        }
        Insert: {
          feature_key: string
          id?: string
          period_start: string
          updated_at?: string
          used?: number
          user_id: string
        }
        Update: {
          feature_key?: string
          id?: string
          period_start?: string
          updated_at?: string
          used?: number
          user_id?: string
        }
        Relationships: []
      }
      survey_answer_files: {
        Row: {
          answer_id: string
          bucket_id: string
          created_at: string
          id: string
          mime_type: string
          response_id: string
          size_bytes: number
          storage_path: string
        }
        Insert: {
          answer_id: string
          bucket_id?: string
          created_at?: string
          id?: string
          mime_type: string
          response_id: string
          size_bytes: number
          storage_path: string
        }
        Update: {
          answer_id?: string
          bucket_id?: string
          created_at?: string
          id?: string
          mime_type?: string
          response_id?: string
          size_bytes?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_answer_files_answer_id_fkey"
            columns: ["answer_id"]
            isOneToOne: false
            referencedRelation: "survey_answers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answer_files_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_answers: {
        Row: {
          id: string
          question_id: string
          response_id: string
          selected_option_ids: string[]
          value_date: string | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          id?: string
          question_id: string
          response_id: string
          selected_option_ids?: string[]
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          id?: string
          question_id?: string
          response_id?: string
          selected_option_ids?: string[]
          value_date?: string | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "survey_answers_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "survey_answers_response_id_fkey"
            columns: ["response_id"]
            isOneToOne: false
            referencedRelation: "survey_responses"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_exports: {
        Row: {
          created_at: string
          form_id: string
          format: string
          id: string
          owner_id: string
          row_count: number
          storage_path: string
        }
        Insert: {
          created_at?: string
          form_id: string
          format: string
          id?: string
          owner_id: string
          row_count?: number
          storage_path: string
        }
        Update: {
          created_at?: string
          form_id?: string
          format?: string
          id?: string
          owner_id?: string
          row_count?: number
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_exports_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "survey_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_forms: {
        Row: {
          closed_at: string | null
          created_at: string
          deadline: string | null
          description: string
          expected_participants: number | null
          id: string
          opened_at: string | null
          owner_id: string
          privacy_note: string
          response_retention_hours: number
          status: Database["public"]["Enums"]["survey_status"]
          submitted_count: number
          title: string
          updated_at: string
        }
        Insert: {
          closed_at?: string | null
          created_at?: string
          deadline?: string | null
          description?: string
          expected_participants?: number | null
          id?: string
          opened_at?: string | null
          owner_id: string
          privacy_note?: string
          response_retention_hours?: number
          status?: Database["public"]["Enums"]["survey_status"]
          submitted_count?: number
          title: string
          updated_at?: string
        }
        Update: {
          closed_at?: string | null
          created_at?: string
          deadline?: string | null
          description?: string
          expected_participants?: number | null
          id?: string
          opened_at?: string | null
          owner_id?: string
          privacy_note?: string
          response_retention_hours?: number
          status?: Database["public"]["Enums"]["survey_status"]
          submitted_count?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      survey_participants: {
        Row: {
          first_viewed_at: string
          form_id: string
          id: string
          status: Database["public"]["Enums"]["survey_participant_status"]
          submitted_at: string | null
          user_id: string
        }
        Insert: {
          first_viewed_at?: string
          form_id: string
          id?: string
          status?: Database["public"]["Enums"]["survey_participant_status"]
          submitted_at?: string | null
          user_id: string
        }
        Update: {
          first_viewed_at?: string
          form_id?: string
          id?: string
          status?: Database["public"]["Enums"]["survey_participant_status"]
          submitted_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_participants_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "survey_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_purge_audit: {
        Row: {
          files_purged: number
          form_id: string | null
          id: string
          purged_at: string
          responses_purged: number
        }
        Insert: {
          files_purged?: number
          form_id?: string | null
          id?: string
          purged_at?: string
          responses_purged?: number
        }
        Update: {
          files_purged?: number
          form_id?: string | null
          id?: string
          purged_at?: string
          responses_purged?: number
        }
        Relationships: [
          {
            foreignKeyName: "survey_purge_audit_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "survey_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_question_options: {
        Row: {
          id: string
          label: string
          position: number
          question_id: string
        }
        Insert: {
          id?: string
          label: string
          position: number
          question_id: string
        }
        Update: {
          id?: string
          label?: string
          position?: number
          question_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_question_options_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "survey_questions"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_questions: {
        Row: {
          config: Json
          created_at: string
          form_id: string
          helper_text: string
          id: string
          is_required: boolean
          label: string
          latin_only: boolean
          position: number
          type: Database["public"]["Enums"]["survey_question_type"]
        }
        Insert: {
          config?: Json
          created_at?: string
          form_id: string
          helper_text?: string
          id?: string
          is_required?: boolean
          label: string
          latin_only?: boolean
          position: number
          type: Database["public"]["Enums"]["survey_question_type"]
        }
        Update: {
          config?: Json
          created_at?: string
          form_id?: string
          helper_text?: string
          id?: string
          is_required?: boolean
          label?: string
          latin_only?: boolean
          position?: number
          type?: Database["public"]["Enums"]["survey_question_type"]
        }
        Relationships: [
          {
            foreignKeyName: "survey_questions_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "survey_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_responses: {
        Row: {
          created_at: string
          expires_at: string
          form_id: string
          id: string
          idempotency_key: string
          respondent_id: string
          submitted_at: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          form_id: string
          id?: string
          idempotency_key: string
          respondent_id: string
          submitted_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          form_id?: string
          id?: string
          idempotency_key?: string
          respondent_id?: string
          submitted_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "survey_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "survey_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_template_questions: {
        Row: {
          config: Json
          helper_text: string
          id: string
          is_required: boolean
          label: string
          latin_only: boolean
          options: Json
          position: number
          template_id: string
          type: Database["public"]["Enums"]["survey_question_type"]
        }
        Insert: {
          config?: Json
          helper_text?: string
          id?: string
          is_required?: boolean
          label: string
          latin_only?: boolean
          options?: Json
          position: number
          template_id: string
          type: Database["public"]["Enums"]["survey_question_type"]
        }
        Update: {
          config?: Json
          helper_text?: string
          id?: string
          is_required?: boolean
          label?: string
          latin_only?: boolean
          options?: Json
          position?: number
          template_id?: string
          type?: Database["public"]["Enums"]["survey_question_type"]
        }
        Relationships: [
          {
            foreignKeyName: "survey_template_questions_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "survey_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      survey_templates: {
        Row: {
          created_at: string
          description: string
          id: string
          name: string
          owner_id: string
          updated_at: string
          use_count: number
        }
        Insert: {
          created_at?: string
          description?: string
          id?: string
          name: string
          owner_id: string
          updated_at?: string
          use_count?: number
        }
        Update: {
          created_at?: string
          description?: string
          id?: string
          name?: string
          owner_id?: string
          updated_at?: string
          use_count?: number
        }
        Relationships: []
      }
      telegram_image_candidates: {
        Row: {
          attribution: Json
          confidence: number
          created_at: string
          download_url: string | null
          height: number
          mime_type: string | null
          opaque_id: string
          original_url: string | null
          provider: string
          selected_at: string | null
          session_id: string
          storage_bucket: string | null
          storage_path: string | null
          width: number
        }
        Insert: {
          attribution?: Json
          confidence?: number
          created_at?: string
          download_url?: string | null
          height?: number
          mime_type?: string | null
          opaque_id: string
          original_url?: string | null
          provider: string
          selected_at?: string | null
          session_id: string
          storage_bucket?: string | null
          storage_path?: string | null
          width?: number
        }
        Update: {
          attribution?: Json
          confidence?: number
          created_at?: string
          download_url?: string | null
          height?: number
          mime_type?: string | null
          opaque_id?: string
          original_url?: string | null
          provider?: string
          selected_at?: string | null
          session_id?: string
          storage_bucket?: string | null
          storage_path?: string | null
          width?: number
        }
        Relationships: [
          {
            foreignKeyName: "telegram_image_candidates_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "telegram_image_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      telegram_image_sessions: {
        Row: {
          cancelled_at: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          image_element_id: string
          image_slot: string
          initial_query: string | null
          intent: string | null
          latest_query: string | null
          presentation_id: string
          slide_id: string
          slide_index: number
          status: string
          telegram_chat_id: number | null
          telegram_user_id: number | null
          token_hash: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          image_element_id: string
          image_slot: string
          initial_query?: string | null
          intent?: string | null
          latest_query?: string | null
          presentation_id: string
          slide_id: string
          slide_index: number
          status?: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          token_hash: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          image_element_id?: string
          image_slot?: string
          initial_query?: string | null
          intent?: string | null
          latest_query?: string | null
          presentation_id?: string
          slide_id?: string
          slide_index?: number
          status?: string
          telegram_chat_id?: number | null
          telegram_user_id?: number | null
          token_hash?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "telegram_image_sessions_image_element_id_fkey"
            columns: ["image_element_id"]
            isOneToOne: false
            referencedRelation: "slide_elements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "telegram_image_sessions_presentation_id_user_id_fkey"
            columns: ["presentation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "presentations"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "telegram_image_sessions_slide_id_presentation_id_user_id_fkey"
            columns: ["slide_id", "presentation_id", "user_id"]
            isOneToOne: false
            referencedRelation: "slides"
            referencedColumns: ["id", "presentation_id", "owner_id"]
          },
        ]
      }
      telegram_image_updates: {
        Row: {
          completed_at: string | null
          error_code: string | null
          received_at: string
          status: string
          update_id: number
        }
        Insert: {
          completed_at?: string | null
          error_code?: string | null
          received_at?: string
          status?: string
          update_id: number
        }
        Update: {
          completed_at?: string | null
          error_code?: string | null
          received_at?: string
          status?: string
          update_id?: number
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_subscriptions: {
        Row: {
          cancelled_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          order_id: string | null
          plan_id: string
          plan_snapshot: Json
          started_at: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          order_id?: string | null
          plan_id: string
          plan_snapshot?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          order_id?: string | null
          plan_id?: string
          plan_snapshot?: Json
          started_at?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_subscriptions_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      verified_images: {
        Row: {
          confidence: number
          created_at: string
          creator: string | null
          display_name: string
          entity_type: string
          id: string
          image_storage_path: string
          last_checked_at: string | null
          license: string | null
          license_url: string | null
          metadata: Json
          normalized_entity: string
          original_url: string | null
          provider: string
          source_url: string | null
          updated_at: string
          verified: boolean
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          confidence?: number
          created_at?: string
          creator?: string | null
          display_name: string
          entity_type?: string
          id?: string
          image_storage_path: string
          last_checked_at?: string | null
          license?: string | null
          license_url?: string | null
          metadata?: Json
          normalized_entity: string
          original_url?: string | null
          provider: string
          source_url?: string | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          confidence?: number
          created_at?: string
          creator?: string | null
          display_name?: string
          entity_type?: string
          id?: string
          image_storage_path?: string
          last_checked_at?: string | null
          license?: string | null
          license_url?: string | null
          metadata?: Json
          normalized_entity?: string
          original_url?: string | null
          provider?: string
          source_url?: string | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      account_retention_reasons: { Args: { p_user: string }; Returns: string[] }
      admin_adjust_credits: {
        Args: {
          p_amount: number
          p_idempotency_key: string
          p_reason: string
          p_user_id: string
        }
        Returns: {
          balance: number
          created_at: string
          lifetime_granted: number
          lifetime_spent: number
          reserved: number
          updated_at: string
          user_id: string
          version: number
        }
        SetofOptions: {
          from: "*"
          to: "credit_wallets"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_append_jelement_family: {
        Args: { p_family_id: string; p_spec: Json }
        Returns: number
      }
      admin_archive_design: {
        Args: { p_design_id: string; p_reason?: string }
        Returns: undefined
      }
      admin_archive_jelement_family: {
        Args: { p_family_id: string; p_restore?: boolean }
        Returns: {
          category: string
          color_tokens: Json
          content_hash: string | null
          created_at: string
          created_by: string | null
          description: string
          format_version: string
          id: string
          name: string
          published_at: string | null
          published_version: number
          search_metadata: Json
          slug: string
          source_prompt: string
          status: Database["public"]["Enums"]["jelement_status"]
          style: string
          subcategory: string
          thumbnail_path: string | null
          updated_at: string
          visual_dna: Json
        }
        SetofOptions: {
          from: "*"
          to: "jelement_families"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_create_settlement: {
        Args: {
          p_period_end: string
          p_period_start: string
          p_seller_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          currency: string
          destination_note: string
          gross_sales: number
          id: string
          notified_upcoming_at: string | null
          paid_at: string | null
          paid_by: string | null
          payable_amount: number
          period_end: string
          period_start: string
          reference: string
          seller_fees: number
          seller_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "seller_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_dashboard_metrics: { Args: never; Returns: Json }
      admin_delete_coin_package: { Args: { p_code: string }; Returns: boolean }
      admin_delete_design: {
        Args: { p_design_id: string; p_force?: boolean }
        Returns: Json
      }
      admin_delete_design_font: {
        Args: { p_design_id: string; p_font_id: string }
        Returns: undefined
      }
      admin_delete_finance_entry: { Args: { p_id: string }; Returns: boolean }
      admin_delete_game_category: { Args: { p_id: string }; Returns: boolean }
      admin_delete_jelement: {
        Args: { p_element_id: string }
        Returns: string[]
      }
      admin_delete_jelement_family: {
        Args: { p_family_id: string }
        Returns: string[]
      }
      admin_duplicate_design: {
        Args: { p_design_id: string; p_name: string; p_slug: string }
        Returns: string
      }
      admin_finance_overview: { Args: never; Returns: Json }
      admin_game_overview: { Args: { p_days?: number }; Returns: Json }
      admin_gift_credits: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_message?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_grant_credits_by_email: {
        Args: {
          p_actor_email?: string
          p_amount: number
          p_email: string
          p_idempotency_key: string
          p_reason: string
        }
        Returns: Json
      }
      admin_grant_module_access: {
        Args: {
          p_amount?: number
          p_currency?: string
          p_module_code: string
          p_months?: number
          p_reason?: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_grant_module_access_by_email: {
        Args: {
          p_amount?: number
          p_currency?: string
          p_email: string
          p_module_code?: string
          p_months?: number
          p_reason?: string
        }
        Returns: Json
      }
      admin_list_designs: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_query?: string
          p_source?: Database["public"]["Enums"]["design_source"]
          p_status?: Database["public"]["Enums"]["jslayd_design_status"]
          p_tier?: Database["public"]["Enums"]["presentation_style"]
        }
        Returns: {
          archetype_count: number
          created_at: string
          description: string
          design_source: Database["public"]["Enums"]["design_source"]
          font_count: number
          health_score: number
          id: string
          is_featured: boolean
          is_premium: boolean
          keywords: Json
          name: string
          page_count: number
          published_at: string
          published_version: number
          slug: string
          sort_order: number
          source_asset_path: string
          status: Database["public"]["Enums"]["jslayd_design_status"]
          thumbnail_path: string
          tier: Database["public"]["Enums"]["presentation_style"]
          updated_at: string
          used_by: number
        }[]
      }
      admin_list_finance_entries: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          amount_usd: number
          created_at: string
          created_by_email: string
          id: string
          kind: Database["public"]["Enums"]["finance_kind"]
          note: string
          occurred_on: string
          period: Database["public"]["Enums"]["finance_period"]
          source: Database["public"]["Enums"]["finance_source"]
        }[]
      }
      admin_list_game_sessions: {
        Args: { p_live_only?: boolean }
        Returns: {
          created_at: string
          current_index: number
          game_title: string
          host_email: string
          id: string
          player_count: number
          question_count: number
          reward_reserved: number
          started_at: string
          status: Database["public"]["Enums"]["game_session_status"]
        }[]
      }
      admin_list_games: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          category_label: string
          created_at: string
          featured: boolean
          id: string
          is_free: boolean
          marketplace_status: string
          owner_email: string
          question_count: number
          sessions_count: number
          source_type: Database["public"]["Enums"]["game_source"]
          status: Database["public"]["Enums"]["game_status"]
          title: string
        }[]
      }
      admin_list_jelement_families: { Args: never; Returns: Json }
      admin_list_marketplace_products: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: Database["public"]["Enums"]["marketplace_product_status"]
        }
        Returns: {
          base_price: number
          created_at: string
          currency: string
          has_main_file: boolean
          id: string
          material_type: string
          open_reports: number
          published_at: string
          rating: number
          rating_count: number
          rejection_reason: string
          sales_count: number
          seller_email: string
          seller_id: string
          seller_name: string
          status: Database["public"]["Enums"]["marketplace_product_status"]
          title: string
        }[]
      }
      admin_list_marketplace_reports: {
        Args: {
          p_limit?: number
          p_status?: Database["public"]["Enums"]["marketplace_report_status"]
        }
        Returns: {
          created_at: string
          detail: string
          id: string
          product_id: string
          product_title: string
          reason: Database["public"]["Enums"]["marketplace_report_reason"]
          reporter_email: string
          resolution_note: string
          resolved_at: string
          seller_email: string
          status: Database["public"]["Enums"]["marketplace_report_status"]
        }[]
      }
      admin_list_module_entitlements: {
        Args: {
          p_limit?: number
          p_module_code?: string
          p_offset?: number
          p_search?: string
        }
        Returns: {
          created_at: string
          currency: string
          email: string
          expires_at: string
          full_name: string
          id: string
          module_code: string
          purchased_amount: number
          source: string
          starts_at: string
          status: Database["public"]["Enums"]["entitlement_status"]
          user_id: string
        }[]
      }
      admin_list_presentations: {
        Args: { p_limit?: number; p_offset?: number }
        Returns: {
          cost_usd: number
          created_at: string
          credits_charged: number
          error_message: string
          owner_email: string
          owner_id: string
          presentation_id: string
          slide_count: number
          status: Database["public"]["Enums"]["presentation_status"]
          style: Database["public"]["Enums"]["presentation_style"]
          title: string
        }[]
      }
      admin_list_surveys: {
        Args: {
          p_limit?: number
          p_offset?: number
          p_search?: string
          p_status?: Database["public"]["Enums"]["survey_status"]
        }
        Returns: {
          created_at: string
          deadline: string
          expected_participants: number
          id: string
          live_responses: number
          owner_email: string
          owner_id: string
          owner_name: string
          participant_count: number
          question_count: number
          retention_hours: number
          status: Database["public"]["Enums"]["survey_status"]
          submitted_count: number
          title: string
        }[]
      }
      admin_list_users: {
        Args: { p_limit?: number; p_offset?: number; p_search?: string }
        Returns: {
          created_at: string
          credits: number
          email: string
          full_name: string
          last_seen_at: string
          presentation_count: number
          reserved_credits: number
          status: Database["public"]["Enums"]["user_status"]
          user_id: string
        }[]
      }
      admin_mark_settlement_paid: {
        Args: {
          p_destination_note: string
          p_reference?: string
          p_settlement_id: string
        }
        Returns: {
          created_at: string
          created_by: string | null
          currency: string
          destination_note: string
          gross_sales: number
          id: string
          notified_upcoming_at: string | null
          paid_at: string | null
          paid_by: string | null
          payable_amount: number
          period_end: string
          period_start: string
          reference: string
          seller_fees: number
          seller_id: string
          status: Database["public"]["Enums"]["settlement_status"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "seller_settlements"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_marketplace_finance: { Args: never; Returns: Json }
      admin_moderate_game: {
        Args: { p_action: string; p_game_id: string; p_reason?: string }
        Returns: Json
      }
      admin_moderate_product: {
        Args: { p_action: string; p_product_id: string; p_reason?: string }
        Returns: {
          base_price: number
          category_id: string | null
          content_units: number | null
          cover_path: string | null
          created_at: string
          currency: string
          description: string
          file_format: string | null
          game_id: string | null
          has_study_guide: boolean
          id: string
          material_type: string
          moderated_at: string | null
          moderated_by: string | null
          published_at: string | null
          rating_count: number
          rating_sum: number
          rejection_reason: string | null
          sales_count: number
          search_text: unknown
          seller_id: string
          status: Database["public"]["Enums"]["marketplace_product_status"]
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "marketplace_products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_module_overview: { Args: { p_module_code?: string }; Returns: Json }
      admin_order_reconciliation: {
        Args: never
        Returns: {
          concern: string
          created_at: string
          id: string
          order_number: string
          payme_receipt_id: string
          purpose: Database["public"]["Enums"]["order_purpose"]
          status: Database["public"]["Enums"]["order_status"]
          total_amount: number
          user_email: string
        }[]
      }
      admin_payment_test_mode: { Args: never; Returns: Json }
      admin_pending_payouts: {
        Args: never
        Returns: {
          payable_amount: number
          phone: string
          sales_count: number
          seller_email: string
          seller_id: string
          seller_name: string
          telegram_username: string
        }[]
      }
      admin_publish_design: { Args: { p_design_id: string }; Returns: number }
      admin_publish_jelement_family: {
        Args: { p_family_id: string }
        Returns: number
      }
      admin_reclaim_credits: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_reason: string
          p_user_id: string
        }
        Returns: Json
      }
      admin_recolor_jelement_family: {
        Args: { p_color_tokens: Json; p_family_id: string }
        Returns: {
          category: string
          color_tokens: Json
          content_hash: string | null
          created_at: string
          created_by: string | null
          description: string
          format_version: string
          id: string
          name: string
          published_at: string | null
          published_version: number
          search_metadata: Json
          slug: string
          source_prompt: string
          status: Database["public"]["Enums"]["jelement_status"]
          style: string
          subcategory: string
          thumbnail_path: string | null
          updated_at: string
          visual_dna: Json
        }
        SetofOptions: {
          from: "*"
          to: "jelement_families"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_record_finance_entry: {
        Args: {
          p_amount_usd: number
          p_kind: Database["public"]["Enums"]["finance_kind"]
          p_note?: string
          p_occurred_on?: string
          p_period?: Database["public"]["Enums"]["finance_period"]
          p_source: Database["public"]["Enums"]["finance_source"]
        }
        Returns: Json
      }
      admin_remove_design_font: {
        Args: {
          p_design_id: string
          p_font_id: string
          p_italic?: boolean
          p_weight: number
        }
        Returns: string
      }
      admin_resolve_report: {
        Args: {
          p_note?: string
          p_report_id: string
          p_status: Database["public"]["Enums"]["marketplace_report_status"]
        }
        Returns: {
          created_at: string
          detail: string
          id: string
          product_id: string
          reason: Database["public"]["Enums"]["marketplace_report_reason"]
          reporter_id: string
          resolution_note: string
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["marketplace_report_status"]
        }
        SetofOptions: {
          from: "*"
          to: "marketplace_reports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_restore_design: {
        Args: { p_design_id: string }
        Returns: undefined
      }
      admin_revoke_module_access: {
        Args: { p_module_code: string; p_reason?: string; p_user_id: string }
        Returns: Json
      }
      admin_save_design: {
        Args: {
          p_compiled_config?: Json
          p_content_hash?: string
          p_description?: string
          p_health_score?: number
          p_id?: string
          p_is_premium?: boolean
          p_name: string
          p_preview?: Json
          p_slug: string
          p_source_prompt?: string
          p_thumbnail_path?: string
          p_tier: Database["public"]["Enums"]["presentation_style"]
        }
        Returns: string
      }
      admin_save_design_font: {
        Args: {
          p_byte_size?: number
          p_checksum?: string
          p_design_id: string
          p_fallback?: string
          p_file_name: string
          p_font_id: string
          p_format: string
          p_italic?: boolean
          p_name: string
          p_roles: string[]
          p_weight?: number
        }
        Returns: string
      }
      admin_save_game_category: {
        Args: {
          p_code: string
          p_icon?: string
          p_id?: string
          p_is_active?: boolean
          p_label: string
          p_parent_id?: string
          p_sort_order?: number
        }
        Returns: string
      }
      admin_save_jelement_family: {
        Args: { p_family_id?: string; p_source_prompt?: string; p_spec: Json }
        Returns: {
          category: string
          color_tokens: Json
          content_hash: string | null
          created_at: string
          created_by: string | null
          description: string
          format_version: string
          id: string
          name: string
          published_at: string | null
          published_version: number
          search_metadata: Json
          slug: string
          source_prompt: string
          status: Database["public"]["Enums"]["jelement_status"]
          style: string
          subcategory: string
          thumbnail_path: string | null
          updated_at: string
          visual_dna: Json
        }
        SetofOptions: {
          from: "*"
          to: "jelement_families"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_qr_video_experience: {
        Args: {
          p_glow?: number
          p_gradient_from?: string
          p_gradient_to?: string
          p_gradient_via?: string
          p_intro_path?: string
          p_is_enabled: boolean
          p_loop_path?: string
          p_qr_appear_ms?: number
          p_qr_background?: string
          p_qr_size?: number
          p_qr_x?: number
          p_qr_y?: number
          p_surface: Database["public"]["Enums"]["qr_video_surface"]
        }
        Returns: {
          glow: number
          gradient_from: string
          gradient_to: string
          gradient_via: string
          intro_path: string | null
          is_enabled: boolean
          loop_path: string | null
          qr_appear_ms: number
          qr_background: string
          qr_size: number
          qr_x: number
          qr_y: number
          surface: Database["public"]["Enums"]["qr_video_surface"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "qr_video_experiences"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_save_subscription_plan: {
        Args: {
          p_badge?: string
          p_code: string
          p_compare_at_amount?: number
          p_cta_label?: string
          p_currency?: string
          p_description?: string
          p_estimated_cost_amount?: number
          p_features: Json
          p_id: string
          p_is_active?: boolean
          p_is_featured?: boolean
          p_name: string
          p_period_days?: number
          p_price_amount: number
          p_sort_order?: number
          p_subtitle?: string
        }
        Returns: {
          badge: string
          code: string
          compare_at_amount: number
          created_at: string
          cta_label: string
          currency: string
          description: string
          estimated_cost_amount: number
          features: Json
          id: string
          is_active: boolean
          is_featured: boolean
          name: string
          period_days: number
          price_amount: number
          sort_order: number
          subtitle: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "subscription_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_commission: {
        Args: {
          p_buyer_fee_rate: number
          p_reason?: string
          p_scope?: string
          p_seller_fee_rate: number
        }
        Returns: {
          buyer_fee_rate: number
          created_at: string
          scope: string
          seller_fee_rate: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "commission_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_design_engine: {
        Args: {
          p_generative: boolean
          p_legacy_restricted: boolean
          p_reason?: string
        }
        Returns: Json
      }
      admin_set_font_family: {
        Args: {
          p_category?: string
          p_family_id: string
          p_is_active?: boolean
          p_is_featured?: boolean
        }
        Returns: undefined
      }
      admin_set_ios_payment_policy: {
        Args: { p_copy?: Json; p_reason?: string; p_review_mode: boolean }
        Returns: Json
      }
      admin_set_jelement_asset: {
        Args: {
          p_accent_hue?: number
          p_aspect_ratio?: number
          p_asset_path: string
          p_element_id: string
          p_recolorable?: boolean
          p_variants?: Json
        }
        Returns: undefined
      }
      admin_set_payment_test_mode: {
        Args: {
          p_emails?: string[]
          p_enabled: boolean
          p_max_amount?: number
          p_reason?: string
        }
        Returns: Json
      }
      admin_set_subscription_plans: {
        Args: { p_currency?: string; p_plans: Json; p_reason?: string }
        Returns: Json
      }
      admin_set_survey_status: {
        Args: {
          p_form_id: string
          p_reason?: string
          p_status: Database["public"]["Enums"]["survey_status"]
        }
        Returns: {
          closed_at: string | null
          created_at: string
          deadline: string | null
          description: string
          expected_participants: number | null
          id: string
          opened_at: string | null
          owner_id: string
          privacy_note: string
          response_retention_hours: number
          status: Database["public"]["Enums"]["survey_status"]
          submitted_count: number
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "survey_forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_set_usd_rate: {
        Args: { p_rate: number; p_source?: string }
        Returns: Json
      }
      admin_set_user_status: {
        Args: {
          p_reason: string
          p_status: Database["public"]["Enums"]["user_status"]
          p_user_id: string
        }
        Returns: {
          avatar_url: string | null
          bio: string
          created_at: string
          field_of_study: string | null
          first_name: string
          full_name: string
          id: string
          last_name: string
          last_seen_at: string | null
          organization: string | null
          status: Database["public"]["Enums"]["user_status"]
          timezone: string
          updated_at: string
          username: string | null
        }
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_settle_ai_cost: { Args: { p_note?: string }; Returns: Json }
      admin_subscription_overview: { Args: never; Returns: Json }
      admin_terminate_game_session: {
        Args: { p_reason: string; p_session_id: string }
        Returns: boolean
      }
      admin_update_app_setting: {
        Args: { p_key: string; p_reason: string; p_value: Json }
        Returns: {
          created_at: string
          description: string | null
          key: string
          public_read: boolean
          updated_at: string
          updated_by: string | null
          value: Json
        }
        SetofOptions: {
          from: "*"
          to: "app_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_style_config: {
        Args: {
          p_base_credits: number
          p_credits_per_image: number
          p_credits_per_slide: number
          p_expected_image_ratio: number
          p_is_active: boolean
          p_reason: string
          p_style: Database["public"]["Enums"]["presentation_style"]
        }
        Returns: {
          base_credits: number
          config: Json
          created_at: string
          credits_per_image: number
          credits_per_slide: number
          description: string
          expected_image_ratio: number
          is_active: boolean
          label: string
          style: Database["public"]["Enums"]["presentation_style"]
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "style_configs"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_update_template: {
        Args: {
          p_description?: string
          p_design_id: string
          p_is_premium?: boolean
          p_keywords?: Json
          p_name?: string
          p_pages?: Json
          p_tier?: Database["public"]["Enums"]["presentation_style"]
        }
        Returns: undefined
      }
      admin_upsert_coin_package: {
        Args: {
          p_bonus_coins?: number
          p_code: string
          p_coins: number
          p_currency?: string
          p_description?: string
          p_is_active?: boolean
          p_label: string
          p_price_amount: number
          p_sort_order?: number
        }
        Returns: {
          bonus_coins: number
          code: string
          coins: number
          created_at: string
          currency: string
          description: string
          id: string
          is_active: boolean
          label: string
          price_amount: number
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "coin_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      apply_editor_operation: {
        Args: {
          p_inverse_operation: Json
          p_operation: Json
          p_presentation_id: string
          p_slide_id: string
        }
        Returns: number
      }
      apply_subscription_restart: {
        Args: { p_order_id: string; p_plan_id: string; p_user_id: string }
        Returns: string
      }
      assert_marketplace_member: {
        Args: { p_action: string }
        Returns: undefined
      }
      assert_module_access: {
        Args: { p_module_code: string; p_role: string }
        Returns: undefined
      }
      assert_payment_allowed: {
        Args: { p_context?: string; p_platform?: string }
        Returns: undefined
      }
      assert_reads_own_entitlements: {
        Args: { p_user_id: string }
        Returns: undefined
      }
      bind_telegram_image_session: {
        Args: {
          p_telegram_chat_id: number
          p_telegram_user_id: number
          p_token_hash: string
        }
        Returns: {
          cancelled_at: string | null
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          image_element_id: string
          image_slot: string
          initial_query: string | null
          intent: string | null
          latest_query: string | null
          presentation_id: string
          slide_id: string
          slide_index: number
          status: string
          telegram_chat_id: number | null
          telegram_user_id: number | null
          token_hash: string
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "telegram_image_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      claim_telegram_image_update: {
        Args: { p_update_id: number }
        Returns: boolean
      }
      cleanup_telegram_image_sessions: { Args: never; Returns: Json }
      commit_telegram_image_selection: {
        Args: {
          p_byte_size: number
          p_candidate_id: string
          p_height: number
          p_mime_type: string
          p_session_id: string
          p_storage_bucket: string
          p_storage_path: string
          p_telegram_user_id: number
          p_width: number
        }
        Returns: Json
      }
      create_survey_from_template: {
        Args: { p_template_id: string; p_title?: string }
        Returns: string
      }
      current_app_role: {
        Args: never
        Returns: Database["public"]["Enums"]["app_role"]
      }
      current_subscription: {
        Args: { p_user_id?: string }
        Returns: {
          cancelled_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          order_id: string | null
          plan_id: string
          plan_snapshot: Json
          started_at: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "user_subscriptions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      estimate_presentation_credits: {
        Args: {
          p_slide_count: number
          p_style: Database["public"]["Enums"]["presentation_style"]
        }
        Returns: number
      }
      fail_generation: {
        Args: {
          p_error_code: string
          p_error_message: string
          p_job_id: string
        }
        Returns: undefined
      }
      fail_stale_generations: {
        Args: { p_stale_minutes?: number }
        Returns: number
      }
      finance_month_days: { Args: never; Returns: number }
      finance_period_total: {
        Args: {
          p_from: string
          p_kind: Database["public"]["Enums"]["finance_kind"]
          p_scale: Database["public"]["Enums"]["finance_period"]
        }
        Returns: number
      }
      game_can_host: {
        Args: { p_game_id: string; p_user_id?: string }
        Returns: boolean
      }
      game_grade_answer: {
        Args: {
          p_payload: Json
          p_question: Database["public"]["Tables"]["game_questions"]["Row"]
          p_response_ms: number
        }
        Returns: {
          is_correct: boolean
          score: number
        }[]
      }
      game_host_review_answer: {
        Args: { p_answer_id: string; p_is_correct: boolean }
        Returns: Json
      }
      game_host_state: { Args: { p_session_id: string }; Returns: Json }
      game_hostable_list: {
        Args: never
        Returns: {
          category_label: string
          difficulty: string
          id: string
          question_count: number
          source: string
          title: string
        }[]
      }
      game_is_host: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: boolean
      }
      game_is_participant: {
        Args: { p_session_id: string; p_user_id: string }
        Returns: boolean
      }
      game_join: {
        Args: { p_avatar_id?: number; p_join_token: string; p_nickname: string }
        Returns: Json
      }
      game_join_by_code: {
        Args: { p_avatar_id?: number; p_code: string; p_nickname: string }
        Returns: Json
      }
      game_join_info: { Args: { p_join_token: string }; Returns: Json }
      game_leaderboard_rows: { Args: { p_session_id: string }; Returns: Json }
      game_listing_preview: { Args: { p_product_id: string }; Returns: Json }
      game_my_stats: { Args: never; Returns: Json }
      game_new_join_code: { Args: never; Returns: string }
      game_normalize_text: { Args: { p_value: string }; Returns: string }
      game_pair_info: { Args: { p_token: string }; Returns: Json }
      game_pairing_claim: {
        Args: { p_game_id?: string; p_token: string }
        Returns: Json
      }
      game_pairing_rotate: {
        Args: { p_current_token: string; p_session_id: string }
        Returns: Json
      }
      game_player_state: { Args: { p_session_id: string }; Returns: Json }
      game_question_stats: {
        Args: { p_question_index: number; p_session_id: string }
        Returns: Json
      }
      game_reward_liability: {
        Args: { p_plan: Json; p_player_count: number }
        Returns: number
      }
      game_reward_pay: {
        Args: {
          p_amount: number
          p_kind: string
          p_session: Database["public"]["Tables"]["game_sessions"]["Row"]
          p_user_id: string
        }
        Returns: boolean
      }
      game_reward_plan_check: { Args: { p_plan: Json }; Returns: Json }
      game_rewards_refund: { Args: { p_session_id: string }; Returns: number }
      game_rewards_reserve: {
        Args: {
          p_session: Database["public"]["Tables"]["game_sessions"]["Row"]
        }
        Returns: number
      }
      game_rewards_settle: { Args: { p_session_id: string }; Returns: Json }
      game_sanitized_question: {
        Args: {
          p_question: Database["public"]["Tables"]["game_questions"]["Row"]
          p_session_id: string
        }
        Returns: Json
      }
      game_screen_open: { Args: never; Returns: Json }
      game_screen_snapshot: {
        Args: { p_screen_token: string; p_session_id: string }
        Returns: Json
      }
      game_session_advance: {
        Args: { p_action?: string; p_session_id: string }
        Returns: Json
      }
      game_session_configure: {
        Args: {
          p_game_id?: string
          p_reward_plan?: Json
          p_session_id: string
          p_show_on_phones?: boolean
          p_sound_enabled?: boolean
          p_team_mode?: boolean
          p_teams?: Json
        }
        Returns: Json
      }
      game_session_create: { Args: { p_game_id: string }; Returns: Json }
      game_set_status: {
        Args: {
          p_game_id: string
          p_status: Database["public"]["Enums"]["game_status"]
        }
        Returns: Json
      }
      game_submit_answer: {
        Args: {
          p_payload: Json
          p_question_index: number
          p_session_id: string
        }
        Returns: Json
      }
      game_to_result: {
        Args: {
          p_session: Database["public"]["Tables"]["game_sessions"]["Row"]
        }
        Returns: undefined
      }
      has_module_access: {
        Args: { p_module_code: string; p_user_id?: string }
        Returns: boolean
      }
      is_admin: { Args: { p_user_id?: string }; Returns: boolean }
      is_latin_text: { Args: { p_value: string }; Returns: boolean }
      is_super_admin: { Args: { p_user_id?: string }; Returns: boolean }
      jcoin_refund: {
        Args: {
          p_idempotency_key: string
          p_reason?: string
          p_user_id?: string
        }
        Returns: Json
      }
      jcoin_reserve: {
        Args: {
          p_idempotency_key: string
          p_metadata?: Json
          p_operation: string
          p_reference_id?: string
          p_user_id?: string
        }
        Returns: Json
      }
      jcoin_settle: {
        Args: { p_idempotency_key: string; p_user_id?: string }
        Returns: Json
      }
      jelement_in_use: { Args: { p_element_id: string }; Returns: boolean }
      jelement_normalize: { Args: { p_term: string }; Returns: string }
      jelement_record_usage: {
        Args: {
          p_element_id: string
          p_presentation_id?: string
          p_query?: string
          p_slide_id?: string
          p_slide_role?: string
        }
        Returns: undefined
      }
      jelement_reindex_aliases: {
        Args: { p_element_id: string }
        Returns: undefined
      }
      jelement_resolve: {
        Args: { p_element_id: string; p_version?: number }
        Returns: Json
      }
      jelement_search: {
        Args: { p_limit?: number; p_query: string; p_slide_role?: string }
        Returns: Json
      }
      mark_notifications_read: { Args: { p_id?: string }; Returns: number }
      marketplace_attach_file: {
        Args: {
          p_kind: Database["public"]["Enums"]["marketplace_file_kind"]
          p_mime_type: string
          p_original_name?: string
          p_position?: number
          p_product_id: string
          p_size_bytes: number
          p_storage_path: string
        }
        Returns: string
      }
      marketplace_can_see_product: {
        Args: { p_product_id: string; p_user_id?: string }
        Returns: boolean
      }
      marketplace_create_checkout: {
        Args: {
          p_idempotency_key: string
          p_partial_card_id?: string
          p_platform?: string
          p_product_id: string
          p_refund_acknowledged?: boolean
        }
        Returns: Json
      }
      marketplace_has_entitlement: {
        Args: { p_product_id: string; p_user_id?: string }
        Returns: boolean
      }
      marketplace_is_seller: {
        Args: { p_product_id: string; p_user_id?: string }
        Returns: boolean
      }
      marketplace_may_download: {
        Args: { p_product_id: string; p_user_id?: string }
        Returns: boolean
      }
      marketplace_product_detail: {
        Args: { p_product_id: string }
        Returns: Json
      }
      marketplace_quote: {
        Args: { p_base_price: number; p_scope?: string }
        Returns: Json
      }
      marketplace_refund_ack: {
        Args: { p_acknowledged: boolean }
        Returns: Json
      }
      marketplace_save_product: {
        Args: {
          p_base_price?: number
          p_category_id?: string
          p_content_units?: number
          p_cover_path?: string
          p_description?: string
          p_file_format?: string
          p_game_id?: string
          p_material_type: string
          p_product_id: string
          p_submit?: boolean
          p_title: string
        }
        Returns: string
      }
      marketplace_search: {
        Args: {
          p_category_id?: string
          p_limit?: number
          p_material_type?: string
          p_max_price?: number
          p_min_price?: number
          p_offset?: number
          p_query?: string
          p_seller_id?: string
          p_sort?: string
        }
        Returns: Json
      }
      marketplace_settle_and_remember_card: {
        Args: {
          p_attempt_id: string
          p_provider_cost?: number
          p_transaction_id: string
        }
        Returns: Json
      }
      marketplace_settle_payment: {
        Args: { p_provider_cost?: number; p_transaction_id: string }
        Returns: Json
      }
      marketplace_unlock_with_subscription: {
        Args: { p_product_id: string }
        Returns: Json
      }
      module_access_state: { Args: { p_module_code?: string }; Returns: Json }
      my_entitlements: { Args: { p_user_id?: string }; Returns: Json }
      my_orders: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          currency: string
          order_number: string
          paid_at: string
          purpose: Database["public"]["Enums"]["order_purpose"]
          status: Database["public"]["Enums"]["order_status"]
          title: string
          total_amount: number
        }[]
      }
      my_surveys: { Args: never; Returns: Json }
      my_usage: { Args: { p_user_id?: string }; Returns: Json }
      next_order_number: { Args: never; Returns: string }
      normalize_uz_phone: { Args: { p_value: string }; Returns: string }
      notify_upcoming_settlements: {
        Args: { p_days_ahead?: number }
        Returns: number
      }
      open_survey: { Args: { p_form_id: string }; Returns: Json }
      order_advance: {
        Args: {
          p_failure_code?: string
          p_failure_message?: string
          p_order_id: string
          p_to: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      order_clear_attempt_token: {
        Args: { p_order_id: string }
        Returns: undefined
      }
      order_create_jcoin: {
        Args: { p_package_id: string; p_platform?: string }
        Returns: Json
      }
      order_create_marketplace: {
        Args: {
          p_platform?: string
          p_product_id: string
          p_refund_acknowledged?: boolean
        }
        Returns: Json
      }
      order_create_module: {
        Args: { p_module_code?: string; p_platform?: string }
        Returns: Json
      }
      order_create_subscription:
        | { Args: { p_plan_code: string; p_platform?: string }; Returns: Json }
        | {
            Args: {
              p_plan_code: string
              p_platform?: string
              p_restart?: boolean
            }
            Returns: Json
          }
      order_fail: {
        Args: { p_code: string; p_message: string; p_order_id: string }
        Returns: boolean
      }
      order_find_open: {
        Args: {
          p_coin_package_id?: string
          p_product_id?: string
          p_purpose: Database["public"]["Enums"]["order_purpose"]
          p_reference_code?: string
          p_user_id: string
        }
        Returns: {
          attempt_expires_at: string | null
          buyer_fee: number
          buyer_fee_rate: number
          cancelled_at: string | null
          coin_package_id: string | null
          created_at: string
          currency: string
          expires_at: string
          failure_code: string | null
          failure_message: string | null
          id: string
          is_test: boolean
          metadata: Json
          order_number: string
          paid_at: string | null
          payme_receipt_id: string | null
          payme_transaction_id: string | null
          platform_revenue: number
          product_id: string | null
          provider_card_token: string | null
          purpose: Database["public"]["Enums"]["order_purpose"]
          reference_code: string | null
          seller_fee: number
          seller_fee_rate: number
          seller_id: string | null
          seller_net: number
          status: Database["public"]["Enums"]["order_status"]
          subtotal: number
          total_amount: number
          updated_at: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "orders"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      order_fulfil: {
        Args: {
          p_order_id: string
          p_payme_receipt_id?: string
          p_payme_transaction_id?: string
          p_provider_cost?: number
        }
        Returns: Json
      }
      order_fulfil_and_remember_card: {
        Args: {
          p_attempt_id: string
          p_order_id: string
          p_payme_receipt_id?: string
          p_payme_transaction_id?: string
          p_provider_cost?: number
        }
        Returns: Json
      }
      order_mark_processing: {
        Args: { p_order_id: string; p_payme_receipt_id: string }
        Returns: boolean
      }
      order_mark_test: { Args: { p_order_id: string }; Returns: undefined }
      order_purpose_for_material: {
        Args: { p_material_type: string }
        Returns: Database["public"]["Enums"]["order_purpose"]
      }
      order_set_attempt_token: {
        Args: { p_minutes?: number; p_order_id: string; p_token: string }
        Returns: undefined
      }
      order_summary: {
        Args: { p_order: Database["public"]["Tables"]["orders"]["Row"] }
        Returns: Json
      }
      order_take_attempt_token: {
        Args: { p_order_id: string }
        Returns: string
      }
      order_transition_allowed: {
        Args: {
          p_from: Database["public"]["Enums"]["order_status"]
          p_to: Database["public"]["Enums"]["order_status"]
        }
        Returns: boolean
      }
      payment_advance: {
        Args: {
          p_event?: string
          p_provider_error_code?: string
          p_provider_error_message?: string
          p_provider_receipt_id?: string
          p_to: Database["public"]["Enums"]["payment_state"]
          p_transaction_id: string
        }
        Returns: {
          attempt_expires_at: string | null
          base_price: number
          buyer_fee_amount: number
          buyer_fee_rate: number
          buyer_id: string
          buyer_total: number
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          is_sandbox: boolean
          order_id: string | null
          paid_at: string | null
          partial_card_id: string | null
          platform_gross: number
          product_id: string
          provider: string
          provider_card_token: string | null
          provider_cost: number
          provider_error_code: string | null
          provider_error_message: string | null
          provider_receipt_id: string | null
          seller_fee_amount: number
          seller_fee_rate: number
          seller_id: string
          seller_net: number
          state: Database["public"]["Enums"]["payment_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payment_begin_sandbox: {
        Args: { p_transaction_id: string }
        Returns: {
          attempt_expires_at: string | null
          base_price: number
          buyer_fee_amount: number
          buyer_fee_rate: number
          buyer_id: string
          buyer_total: number
          created_at: string
          currency: string
          failed_at: string | null
          id: string
          idempotency_key: string
          is_sandbox: boolean
          order_id: string | null
          paid_at: string | null
          partial_card_id: string | null
          platform_gross: number
          product_id: string
          provider: string
          provider_card_token: string | null
          provider_cost: number
          provider_error_code: string | null
          provider_error_message: string | null
          provider_receipt_id: string | null
          seller_fee_amount: number
          seller_fee_rate: number
          seller_id: string
          seller_net: number
          state: Database["public"]["Enums"]["payment_state"]
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "payment_transactions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      payment_card_attempt_active: {
        Args: { p_subject_id: string; p_subject_kind: string }
        Returns: Json
      }
      payment_card_attempt_clear: {
        Args: {
          p_attempt_id: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: boolean
      }
      payment_card_attempt_set: {
        Args: {
          p_display_pan: string
          p_expiry_month: number
          p_expiry_year: number
          p_minutes?: number
          p_subject_id: string
          p_subject_kind: string
          p_token: string
        }
        Returns: string
      }
      payment_card_attempt_take: {
        Args: {
          p_attempt_id: string
          p_subject_id: string
          p_subject_kind: string
        }
        Returns: Json
      }
      payment_clear_attempt_token: {
        Args: { p_transaction_id: string }
        Returns: undefined
      }
      payment_policy: { Args: { p_platform?: string }; Returns: Json }
      payment_set_attempt_token: {
        Args: { p_minutes?: number; p_token: string; p_transaction_id: string }
        Returns: undefined
      }
      payment_take_attempt_token: {
        Args: { p_transaction_id: string }
        Returns: string
      }
      payment_test_mode_for: {
        Args: { p_amount: number; p_user_id: string }
        Returns: boolean
      }
      payment_transition_allowed: {
        Args: {
          p_from: Database["public"]["Enums"]["payment_state"]
          p_to: Database["public"]["Enums"]["payment_state"]
        }
        Returns: boolean
      }
      payments_blocked_for_platform: {
        Args: { p_platform?: string }
        Returns: boolean
      }
      pptx_import_fail: {
        Args: { p_message: string; p_presentation_id: string }
        Returns: undefined
      }
      pptx_import_finish: {
        Args: { p_presentation_id: string; p_slide_count: number }
        Returns: {
          actual_credits: number
          author_name: string | null
          created_at: string
          current_version: number
          design_dna: Json | null
          design_engine: string | null
          design_id: string | null
          design_version: number | null
          error_message: string | null
          estimated_credits: number
          generated_slide_count: number
          generation_cost_usd: number
          id: string
          owner_id: string
          palette_code: string | null
          requested_slide_count: number
          reserved_credits: number
          status: Database["public"]["Enums"]["presentation_status"]
          style: Database["public"]["Enums"]["presentation_style"]
          teacher_name: string | null
          template_code: string | null
          thumbnail_path: string | null
          title: string
          topic: string
          updated_at: string
          visual_dna: Json
        }
        SetofOptions: {
          from: "*"
          to: "presentations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      pptx_import_start: {
        Args: { p_source_name: string; p_title: string }
        Returns: string
      }
      pptx_literal_text: { Args: { p_document: Json }; Returns: string }
      presentation_apply_command: {
        Args: { p_command: string; p_session_id: string; p_value?: number }
        Returns: {
          created_at: string
          current_slide: number
          deck_revision: number
          ended_at: string | null
          expires_at: string
          host_user_id: string | null
          id: string
          last_command_at: string | null
          paired_at: string | null
          presentation_id: string | null
          realtime_token: string
          screen_token_hash: string
          slide_count: number
          state_version: number
          status: Database["public"]["Enums"]["presentation_session_status"]
          translate_x: number
          translate_y: number
          zoom: number
        }
        SetofOptions: {
          from: "*"
          to: "presentation_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      presentation_command: {
        Args: { p_command: string; p_session_id: string; p_value?: number }
        Returns: {
          created_at: string
          current_slide: number
          deck_revision: number
          ended_at: string | null
          expires_at: string
          host_user_id: string | null
          id: string
          last_command_at: string | null
          paired_at: string | null
          presentation_id: string | null
          realtime_token: string
          screen_token_hash: string
          slide_count: number
          state_version: number
          status: Database["public"]["Enums"]["presentation_session_status"]
          translate_x: number
          translate_y: number
          zoom: number
        }
        SetofOptions: {
          from: "*"
          to: "presentation_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      presentation_has_game: {
        Args: { p_presentation_id: string }
        Returns: boolean
      }
      presentation_launch_game: {
        Args: { p_presentation_session_id: string }
        Returns: Json
      }
      presentation_new_token: { Args: never; Returns: string }
      presentation_pair_info: { Args: { p_token: string }; Returns: Json }
      presentation_pairing_claim: {
        Args: { p_presentation_id?: string; p_token: string }
        Returns: Json
      }
      presentation_pairing_rotate: {
        Args: { p_current_token: string; p_session_id: string }
        Returns: Json
      }
      presentation_screen_command: {
        Args: {
          p_command: string
          p_screen_token: string
          p_session_id: string
          p_value?: number
        }
        Returns: Json
      }
      presentation_screen_snapshot: {
        Args: { p_screen_token: string; p_session_id: string }
        Returns: Json
      }
      presentation_session_open: { Args: never; Returns: Json }
      presentation_session_set_deck: {
        Args: { p_presentation_id: string; p_session_id: string }
        Returns: {
          created_at: string
          current_slide: number
          deck_revision: number
          ended_at: string | null
          expires_at: string
          host_user_id: string | null
          id: string
          last_command_at: string | null
          paired_at: string | null
          presentation_id: string | null
          realtime_token: string
          screen_token_hash: string
          slide_count: number
          state_version: number
          status: Database["public"]["Enums"]["presentation_session_status"]
          translate_x: number
          translate_y: number
          zoom: number
        }
        SetofOptions: {
          from: "*"
          to: "presentation_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      presentation_viewport_commit: {
        Args: {
          p_scale: number
          p_session_id: string
          p_slide?: number
          p_translate_x: number
          p_translate_y: number
        }
        Returns: {
          created_at: string
          current_slide: number
          deck_revision: number
          ended_at: string | null
          expires_at: string
          host_user_id: string | null
          id: string
          last_command_at: string | null
          paired_at: string | null
          presentation_id: string | null
          realtime_token: string
          screen_token_hash: string
          slide_count: number
          state_version: number
          status: Database["public"]["Enums"]["presentation_session_status"]
          translate_x: number
          translate_y: number
          zoom: number
        }
        SetofOptions: {
          from: "*"
          to: "presentation_sessions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      purge_account_data: { Args: { p_user: string }; Returns: Json }
      purge_expired_game_sessions: { Args: never; Returns: number }
      purge_expired_presentation_sessions: { Args: never; Returns: number }
      purge_expired_survey_responses: {
        Args: { p_limit?: number }
        Returns: Json
      }
      purge_stale_orders: { Args: never; Returns: number }
      quota_consume: {
        Args: { p_amount?: number; p_feature_key: string; p_user_id?: string }
        Returns: Json
      }
      quota_release: {
        Args: { p_amount?: number; p_feature_key: string; p_user_id?: string }
        Returns: undefined
      }
      quota_status: {
        Args: { p_feature_key: string; p_user_id?: string }
        Returns: Json
      }
      reap_stale_export_jobs: { Args: { p_owner_id?: string }; Returns: number }
      reconcile_credit_reservations: { Args: never; Returns: number }
      record_survey_export: {
        Args: {
          p_form_id: string
          p_format: string
          p_row_count: number
          p_storage_path: string
        }
        Returns: {
          created_at: string
          form_id: string
          format: string
          id: string
          owner_id: string
          row_count: number
          storage_path: string
        }
        SetofOptions: {
          from: "*"
          to: "survey_exports"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      remember_partial_card: {
        Args: {
          p_display_pan: string
          p_expiry_month: number
          p_expiry_year: number
          p_user_id: string
        }
        Returns: {
          created_at: string
          display_pan: string
          expiry_month: number
          expiry_year: number
          id: string
          is_active: boolean
          last_used_at: string | null
          last4: string
          user_id: string
        }
        SetofOptions: {
          from: "*"
          to: "partial_cards"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      request_export: {
        Args: {
          p_format: Database["public"]["Enums"]["export_format"]
          p_options?: Json
          p_presentation_id: string
        }
        Returns: string
      }
      retry_generation: {
        Args: { p_idempotency_key: string; p_presentation_id: string }
        Returns: {
          estimated_credits: number
          job_id: string
          presentation_id: string
        }[]
      }
      save_survey_form: {
        Args: {
          p_deadline?: string
          p_description?: string
          p_expected_participants?: number
          p_form_id: string
          p_privacy_note?: string
          p_questions?: Json
          p_title: string
        }
        Returns: string
      }
      save_survey_template: {
        Args: {
          p_description?: string
          p_name: string
          p_questions?: Json
          p_template_id: string
        }
        Returns: string
      }
      search_profiles_by_username: {
        Args: { p_limit?: number; p_query: string }
        Returns: {
          avatar_url: string
          full_name: string
          id: string
          username: string
        }[]
      }
      seller_earnings_summary: { Args: { p_seller_id?: string }; Returns: Json }
      set_survey_status: {
        Args: {
          p_form_id: string
          p_status: Database["public"]["Enums"]["survey_status"]
        }
        Returns: {
          closed_at: string | null
          created_at: string
          deadline: string | null
          description: string
          expected_participants: number | null
          id: string
          opened_at: string | null
          owner_id: string
          privacy_note: string
          response_retention_hours: number
          status: Database["public"]["Enums"]["survey_status"]
          submitted_count: number
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "survey_forms"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      settle_generation: {
        Args: {
          p_actual_credits: number
          p_job_id: string
          p_provider_cost_usd?: number
        }
        Returns: undefined
      }
      start_generation: {
        Args: {
          p_author_name?: string
          p_design_slug?: string
          p_idempotency_key?: string
          p_palette_code?: string
          p_presentation_id: string
          p_slide_count: number
          p_sources?: string[]
          p_style: Database["public"]["Enums"]["presentation_style"]
          p_teacher_name?: string
          p_template_code?: string
          p_title: string
          p_topic: string
        }
        Returns: {
          estimated_credits: number
          job_id: string
          presentation_id: string
        }[]
      }
      submit_survey_response: {
        Args: { p_answers: Json; p_form_id: string; p_idempotency_key?: string }
        Returns: Json
      }
      subscription_restart_preview: {
        Args: { p_user_id?: string }
        Returns: Json
      }
      survey_can_read_response: {
        Args: { p_response_id: string; p_user_id?: string }
        Returns: boolean
      }
      survey_is_owner: {
        Args: { p_form_id: string; p_user_id?: string }
        Returns: boolean
      }
      survey_is_participant: {
        Args: { p_form_id: string; p_user_id?: string }
        Returns: boolean
      }
      survey_response_rows: {
        Args: { p_form_id: string; p_limit?: number }
        Returns: Json
      }
      survey_results_summary: { Args: { p_form_id: string }; Returns: Json }
      transfer_credits: {
        Args: {
          p_amount: number
          p_idempotency_key?: string
          p_note?: string
          p_recipient_id: string
        }
        Returns: Json
      }
      usage_period_start: {
        Args: { p_period: string; p_user_id: string }
        Returns: string
      }
      verify_image: {
        Args: {
          p_creator?: string
          p_display_name: string
          p_entity_type: string
          p_license?: string
          p_license_url?: string
          p_metadata?: Json
          p_normalized_entity: string
          p_original_url?: string
          p_provider: string
          p_source_url?: string
          p_storage_path: string
        }
        Returns: string
      }
    }
    Enums: {
      app_role: "user" | "admin" | "super_admin"
      asset_kind:
        | "upload"
        | "web"
        | "generated"
        | "icon"
        | "thumbnail"
        | "export"
        | "stock"
      credit_transaction_type:
        | "grant"
        | "reservation"
        | "charge"
        | "release"
        | "refund"
        | "admin_adjustment"
        | "purchase"
        | "transfer_in"
        | "transfer_out"
        | "marketplace_spend"
        | "marketplace_earn"
        | "game_reward_reserve"
        | "game_reward"
        | "game_reward_refund"
        | "coin_purchase"
      design_source: "code" | "pptx" | "svg"
      element_type:
        | "text"
        | "image"
        | "shape"
        | "icon"
        | "chart"
        | "table"
        | "line"
        | "group"
      entitlement_status: "active" | "expired" | "revoked"
      export_format: "pdf" | "png" | "pptx"
      finance_kind: "income" | "expense"
      finance_period: "one_time" | "weekly" | "monthly"
      finance_source:
        | "ai_provider"
        | "infrastructure"
        | "subscription"
        | "credit_sale"
        | "other"
      game_player_status: "joined" | "disconnected" | "left" | "kicked"
      game_question_type:
        | "single_choice"
        | "true_false"
        | "multiple_choice"
        | "ordering"
        | "matching"
        | "fill_blank"
        | "word_cloud"
        | "poll"
        | "open_answer"
        | "image_quiz"
        | "hotspot"
      game_session_status:
        | "lobby"
        | "countdown"
        | "question"
        | "question_result"
        | "leaderboard"
        | "finished"
        | "cancelled"
        | "expired"
      game_source: "manual" | "ai" | "text" | "file" | "presentation"
      game_status: "generating" | "draft" | "ready" | "archived" | "failed"
      jelement_status: "draft" | "published" | "archived"
      job_status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
      jslayd_design_status: "draft" | "published" | "archived"
      marketplace_file_kind: "main" | "study_guide" | "preview"
      marketplace_product_status:
        | "draft"
        | "pending_review"
        | "approved"
        | "rejected"
        | "hidden"
        | "archived"
      marketplace_report_reason:
        | "copyright"
        | "plagiarism"
        | "inappropriate"
        | "fraud"
        | "other"
      marketplace_report_status: "open" | "reviewing" | "upheld" | "dismissed"
      notification_kind:
        | "credit_gift"
        | "system"
        | "presentation"
        | "survey_invite"
        | "survey_deadline"
        | "survey_completed"
        | "project_ready"
        | "marketplace_sale"
        | "marketplace_purchase"
        | "credit_received"
        | "credit_sent"
        | "subscription_expiry"
        | "product_approved"
        | "product_rejected"
        | "settlement_upcoming"
        | "settlement_paid"
        | "refund"
        | "game_reward"
        | "game_result"
        | "order_paid"
        | "order_failed"
      order_purpose:
        | "subscription"
        | "jcoin"
        | "data_collection"
        | "marketplace_presentation"
        | "marketplace_reference"
        | "marketplace_independent_work"
        | "marketplace_game"
        | "other_marketplace_product"
      order_status:
        | "pending"
        | "awaiting_verification"
        | "processing"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
        | "expired"
      payment_state:
        | "created"
        | "card_created"
        | "otp_requested"
        | "card_verified"
        | "receipt_created"
        | "processing"
        | "paid"
        | "failed"
        | "cancelled"
        | "refunded"
      presentation_session_status: "pairing" | "active" | "ended" | "expired"
      presentation_status:
        | "draft"
        | "queued"
        | "generating"
        | "ready"
        | "failed"
        | "archived"
      presentation_style: "simple" | "good" | "great" | "super_professional"
      qr_video_surface: "taqdimot" | "oyingoh"
      seller_ledger_status: "pending" | "approved" | "paid" | "reversed"
      settlement_status: "draft" | "pending" | "paid" | "cancelled"
      slide_story_role:
        | "welcome"
        | "introduction"
        | "overview"
        | "key_concepts"
        | "importance"
        | "types"
        | "structure"
        | "process"
        | "methods"
        | "analysis"
        | "challenges"
        | "solutions"
        | "applications"
        | "examples"
        | "results"
        | "recommendations"
        | "conclusion"
        | "thanks"
        | "agenda"
        | "timeline"
        | "comparison"
        | "big_number"
        | "quote"
        | "case_study"
        | "data"
        | "chart"
        | "table"
        | "image_story"
        | "references"
      step_status: "queued" | "running" | "succeeded" | "failed" | "skipped"
      subscription_status:
        | "inactive"
        | "payment_pending"
        | "active"
        | "expired"
        | "cancelled"
      survey_participant_status: "invited" | "viewed" | "submitted"
      survey_question_type:
        | "short_text"
        | "long_text"
        | "phone"
        | "image"
        | "single_choice"
        | "multi_choice"
        | "date"
        | "number"
      survey_status: "draft" | "open" | "closed"
      user_status: "active" | "blocked"
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
      app_role: ["user", "admin", "super_admin"],
      asset_kind: [
        "upload",
        "web",
        "generated",
        "icon",
        "thumbnail",
        "export",
        "stock",
      ],
      credit_transaction_type: [
        "grant",
        "reservation",
        "charge",
        "release",
        "refund",
        "admin_adjustment",
        "purchase",
        "transfer_in",
        "transfer_out",
        "marketplace_spend",
        "marketplace_earn",
        "game_reward_reserve",
        "game_reward",
        "game_reward_refund",
        "coin_purchase",
      ],
      design_source: ["code", "pptx", "svg"],
      element_type: [
        "text",
        "image",
        "shape",
        "icon",
        "chart",
        "table",
        "line",
        "group",
      ],
      entitlement_status: ["active", "expired", "revoked"],
      export_format: ["pdf", "png", "pptx"],
      finance_kind: ["income", "expense"],
      finance_period: ["one_time", "weekly", "monthly"],
      finance_source: [
        "ai_provider",
        "infrastructure",
        "subscription",
        "credit_sale",
        "other",
      ],
      game_player_status: ["joined", "disconnected", "left", "kicked"],
      game_question_type: [
        "single_choice",
        "true_false",
        "multiple_choice",
        "ordering",
        "matching",
        "fill_blank",
        "word_cloud",
        "poll",
        "open_answer",
        "image_quiz",
        "hotspot",
      ],
      game_session_status: [
        "lobby",
        "countdown",
        "question",
        "question_result",
        "leaderboard",
        "finished",
        "cancelled",
        "expired",
      ],
      game_source: ["manual", "ai", "text", "file", "presentation"],
      game_status: ["generating", "draft", "ready", "archived", "failed"],
      jelement_status: ["draft", "published", "archived"],
      job_status: ["queued", "running", "succeeded", "failed", "cancelled"],
      jslayd_design_status: ["draft", "published", "archived"],
      marketplace_file_kind: ["main", "study_guide", "preview"],
      marketplace_product_status: [
        "draft",
        "pending_review",
        "approved",
        "rejected",
        "hidden",
        "archived",
      ],
      marketplace_report_reason: [
        "copyright",
        "plagiarism",
        "inappropriate",
        "fraud",
        "other",
      ],
      marketplace_report_status: ["open", "reviewing", "upheld", "dismissed"],
      notification_kind: [
        "credit_gift",
        "system",
        "presentation",
        "survey_invite",
        "survey_deadline",
        "survey_completed",
        "project_ready",
        "marketplace_sale",
        "marketplace_purchase",
        "credit_received",
        "credit_sent",
        "subscription_expiry",
        "product_approved",
        "product_rejected",
        "settlement_upcoming",
        "settlement_paid",
        "refund",
        "game_reward",
        "game_result",
        "order_paid",
        "order_failed",
      ],
      order_purpose: [
        "subscription",
        "jcoin",
        "data_collection",
        "marketplace_presentation",
        "marketplace_reference",
        "marketplace_independent_work",
        "marketplace_game",
        "other_marketplace_product",
      ],
      order_status: [
        "pending",
        "awaiting_verification",
        "processing",
        "paid",
        "failed",
        "cancelled",
        "refunded",
        "expired",
      ],
      payment_state: [
        "created",
        "card_created",
        "otp_requested",
        "card_verified",
        "receipt_created",
        "processing",
        "paid",
        "failed",
        "cancelled",
        "refunded",
      ],
      presentation_session_status: ["pairing", "active", "ended", "expired"],
      presentation_status: [
        "draft",
        "queued",
        "generating",
        "ready",
        "failed",
        "archived",
      ],
      presentation_style: ["simple", "good", "great", "super_professional"],
      qr_video_surface: ["taqdimot", "oyingoh"],
      seller_ledger_status: ["pending", "approved", "paid", "reversed"],
      settlement_status: ["draft", "pending", "paid", "cancelled"],
      slide_story_role: [
        "welcome",
        "introduction",
        "overview",
        "key_concepts",
        "importance",
        "types",
        "structure",
        "process",
        "methods",
        "analysis",
        "challenges",
        "solutions",
        "applications",
        "examples",
        "results",
        "recommendations",
        "conclusion",
        "thanks",
        "agenda",
        "timeline",
        "comparison",
        "big_number",
        "quote",
        "case_study",
        "data",
        "chart",
        "table",
        "image_story",
        "references",
      ],
      step_status: ["queued", "running", "succeeded", "failed", "skipped"],
      subscription_status: [
        "inactive",
        "payment_pending",
        "active",
        "expired",
        "cancelled",
      ],
      survey_participant_status: ["invited", "viewed", "submitted"],
      survey_question_type: [
        "short_text",
        "long_text",
        "phone",
        "image",
        "single_choice",
        "multi_choice",
        "date",
        "number",
      ],
      survey_status: ["draft", "open", "closed"],
      user_status: ["active", "blocked"],
    },
  },
} as const
