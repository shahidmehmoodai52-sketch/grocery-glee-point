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
      admin_action_log: {
        Row: {
          action: string
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          metadata: Json | null
          reason: string | null
          tenant_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          tenant_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          after_state?: Json | null
          before_state?: Json | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          metadata?: Json | null
          reason?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_staff: {
        Row: {
          added_by: string | null
          created_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      admin_staff_permissions: {
        Row: {
          created_at: string
          granted_by: string | null
          perm: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          perm: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          perm?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_staff_permissions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "admin_staff"
            referencedColumns: ["user_id"]
          },
        ]
      }
      admin_support_sessions: {
        Row: {
          admin_id: string
          ended_at: string | null
          ended_reason: string | null
          expires_at: string
          id: string
          reason: string
          started_at: string
          tenant_id: string
        }
        Insert: {
          admin_id: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at: string
          id?: string
          reason: string
          started_at?: string
          tenant_id: string
        }
        Update: {
          admin_id?: string
          ended_at?: string | null
          ended_reason?: string | null
          expires_at?: string
          id?: string
          reason?: string
          started_at?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "admin_support_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      application_errors: {
        Row: {
          created_at: string
          error_message: string
          error_type: string
          id: string
          metadata: Json | null
          page_or_module: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          stack_trace: string | null
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          error_message: string
          error_type: string
          id?: string
          metadata?: Json | null
          page_or_module?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          stack_trace?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          error_message?: string
          error_type?: string
          id?: string
          metadata?: Json | null
          page_or_module?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          stack_trace?: string | null
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "application_errors_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_categories: {
        Row: {
          created_at: string
          icon: string | null
          id: string
          name: string
          notes: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          icon?: string | null
          id?: string
          name: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
          notes?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          brand: string | null
          category_id: string | null
          condition: string
          created_at: string
          current_value: number
          id: string
          image_url: string | null
          location: string | null
          model_number: string | null
          name: string
          notes: string | null
          purchase_date: string | null
          purchase_price: number
          quantity: number
          serial_number: string | null
          supplier: string | null
          tenant_id: string
          updated_at: string
          user_id: string
          warranty_expiry: string | null
        }
        Insert: {
          brand?: string | null
          category_id?: string | null
          condition?: string
          created_at?: string
          current_value?: number
          id?: string
          image_url?: string | null
          location?: string | null
          model_number?: string | null
          name: string
          notes?: string | null
          purchase_date?: string | null
          purchase_price?: number
          quantity?: number
          serial_number?: string | null
          supplier?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
          warranty_expiry?: string | null
        }
        Update: {
          brand?: string | null
          category_id?: string | null
          condition?: string
          created_at?: string
          current_value?: number
          id?: string
          image_url?: string | null
          location?: string | null
          model_number?: string | null
          name?: string
          notes?: string | null
          purchase_date?: string | null
          purchase_price?: number
          quantity?: number
          serial_number?: string | null
          supplier?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
          warranty_expiry?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "assets_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "asset_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          new_data?: Json | null
          old_data?: Json | null
          record_id?: string | null
          table_name?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      backup_metadata: {
        Row: {
          backup_type: string
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          size_bytes: number | null
          started_at: string | null
          status: string
          tenant_id: string | null
        }
        Insert: {
          backup_type: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          size_bytes?: number | null
          started_at?: string | null
          status: string
          tenant_id?: string | null
        }
        Update: {
          backup_type?: string
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          size_bytes?: number | null
          started_at?: string | null
          status?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "backup_metadata_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_events: {
        Row: {
          amount: number | null
          created_at: string
          currency: string
          event_type: string
          id: string
          metadata: Json
          provider: string
          provider_event_id: string | null
          status: string | null
          tenant_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string
          event_type: string
          id?: string
          metadata?: Json
          provider: string
          provider_event_id?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string
          event_type?: string
          id?: string
          metadata?: Json
          provider?: string
          provider_event_id?: string | null
          status?: string | null
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_accounts: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          opening_balance: number
          sort_order: number
          tenant_id: string
          type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          opening_balance?: number
          sort_order?: number
          tenant_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          opening_balance?: number
          sort_order?: number
          tenant_id?: string
          type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_accounts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_drawer_events: {
        Row: {
          amount: number
          approved_by: string | null
          created_at: string
          event_type: string
          id: string
          reason: string | null
          reference: string | null
          shift_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          amount: number
          approved_by?: string | null
          created_at?: string
          event_type: string
          id?: string
          reason?: string | null
          reference?: string | null
          shift_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          amount?: number
          approved_by?: string | null
          created_at?: string
          event_type?: string
          id?: string
          reason?: string | null
          reference?: string | null
          shift_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_drawer_events_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_drawer_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_transactions: {
        Row: {
          account_id: string
          amount: number
          category: string
          created_at: string
          direction: string
          id: string
          notes: string | null
          occurred_on: string
          payment_method: string
          reference: string | null
          tenant_id: string
          transfer_group_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          amount: number
          category?: string
          created_at?: string
          direction: string
          id?: string
          notes?: string | null
          occurred_on?: string
          payment_method?: string
          reference?: string | null
          tenant_id?: string
          transfer_group_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          account_id?: string
          amount?: number
          category?: string
          created_at?: string
          direction?: string
          id?: string
          notes?: string | null
          occurred_on?: string
          payment_method?: string
          reference?: string | null
          tenant_id?: string
          transfer_group_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_transactions_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_transactions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      customers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          email: string | null
          id: string
          import_batch_id: string | null
          name: string
          opening_balance: number
          phone: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name: string
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name?: string
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_persons: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          notes: string | null
          phone: string | null
          role: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          notes?: string | null
          phone?: string | null
          role?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_persons_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          description: string | null
          expense_date: string
          id: string
          method: string
          person_id: string | null
          sale_id: string | null
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          category?: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          method?: string
          person_id?: string | null
          sale_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          description?: string | null
          expense_date?: string
          id?: string
          method?: string
          person_id?: string | null
          sale_id?: string | null
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "expense_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      feature_flags: {
        Row: {
          created_at: string
          default_enabled: boolean
          description: string | null
          key: string
          label: string
        }
        Insert: {
          created_at?: string
          default_enabled?: boolean
          description?: string | null
          key: string
          label: string
        }
        Update: {
          created_at?: string
          default_enabled?: boolean
          description?: string | null
          key?: string
          label?: string
        }
        Relationships: []
      }
      global_products: {
        Row: {
          barcode: string | null
          category: string | null
          contributed_by_tenant: string | null
          contributed_by_user: string | null
          created_at: string
          default_cost_price: number
          default_sell_price: number
          description: string | null
          id: string
          image_url: string | null
          item_code: string | null
          name: string
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          contributed_by_tenant?: string | null
          contributed_by_user?: string | null
          created_at?: string
          default_cost_price?: number
          default_sell_price?: number
          description?: string | null
          id?: string
          image_url?: string | null
          item_code?: string | null
          name: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          contributed_by_tenant?: string | null
          contributed_by_user?: string | null
          created_at?: string
          default_cost_price?: number
          default_sell_price?: number
          description?: string | null
          id?: string
          image_url?: string | null
          item_code?: string | null
          name?: string
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_products_contributed_by_tenant_fkey"
            columns: ["contributed_by_tenant"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      held_bills: {
        Row: {
          cashier_id: string
          created_at: string
          customer_id: string | null
          discarded_at: string | null
          id: string
          item_count: number
          label: string | null
          payload: Json
          resumed_at: string | null
          resumed_by: string | null
          shift_id: string | null
          status: string
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          cashier_id: string
          created_at?: string
          customer_id?: string | null
          discarded_at?: string | null
          id?: string
          item_count?: number
          label?: string | null
          payload: Json
          resumed_at?: string | null
          resumed_by?: string | null
          shift_id?: string | null
          status?: string
          tenant_id: string
          total?: number
          updated_at?: string
        }
        Update: {
          cashier_id?: string
          created_at?: string
          customer_id?: string | null
          discarded_at?: string | null
          id?: string
          item_count?: number
          label?: string | null
          payload?: Json
          resumed_at?: string | null
          resumed_by?: string | null
          shift_id?: string | null
          status?: string
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "held_bills_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_bills_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "held_bills_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      import_batches: {
        Row: {
          barcodes_count: number
          created_at: string
          customers_count: number
          failed_count: number
          filename: string
          id: string
          notes: string | null
          products_count: number
          source: string
          suppliers_count: number
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          barcodes_count?: number
          created_at?: string
          customers_count?: number
          failed_count?: number
          filename: string
          id?: string
          notes?: string | null
          products_count?: number
          source: string
          suppliers_count?: number
          tenant_id?: string
          user_id?: string | null
        }
        Update: {
          barcodes_count?: number
          created_at?: string
          customers_count?: number
          failed_count?: number
          filename?: string
          id?: string
          notes?: string | null
          products_count?: number
          source?: string
          suppliers_count?: number
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "import_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_damages: {
        Row: {
          batch_id: string | null
          created_at: string
          damage_type: string
          id: string
          note: string | null
          product_id: string
          qty: number
          reason: string | null
          tenant_id: string
          total_value: number | null
          unit_cost: number | null
          user_id: string | null
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          damage_type: string
          id?: string
          note?: string | null
          product_id: string
          qty: number
          reason?: string | null
          tenant_id: string
          total_value?: number | null
          unit_cost?: number | null
          user_id?: string | null
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          damage_type?: string
          id?: string
          note?: string | null
          product_id?: string
          qty?: number
          reason?: string | null
          tenant_id?: string
          total_value?: number | null
          unit_cost?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_damages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batch_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_damages_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_damages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_damages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_damages_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_damages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_movements: {
        Row: {
          created_at: string
          customer_id: string | null
          id: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note: string | null
          product_id: string
          qty_change: number
          reason: string | null
          reference_id: string | null
          reference_no: string | null
          reference_type: Database["public"]["Enums"]["inventory_reference_type"]
          stock_after: number
          stock_before: number
          supplier_id: string | null
          tenant_id: string
          total_cost: number | null
          unit_cost: number | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string | null
          product_id: string
          qty_change: number
          reason?: string | null
          reference_id?: string | null
          reference_no?: string | null
          reference_type: Database["public"]["Enums"]["inventory_reference_type"]
          stock_after?: number
          stock_before?: number
          supplier_id?: string | null
          tenant_id: string
          total_cost?: number | null
          unit_cost?: number | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          movement_type?: Database["public"]["Enums"]["inventory_movement_type"]
          note?: string | null
          product_id?: string
          qty_change?: number
          reason?: string | null
          reference_id?: string | null
          reference_no?: string | null
          reference_type?: Database["public"]["Enums"]["inventory_reference_type"]
          stock_after?: number
          stock_before?: number
          supplier_id?: string | null
          tenant_id?: string
          total_cost?: number | null
          unit_cost?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_movements_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      inventory_waste: {
        Row: {
          batch_id: string | null
          created_at: string
          id: string
          note: string | null
          product_id: string
          qty: number
          reason: string | null
          tenant_id: string
          total_value: number | null
          unit_cost: number | null
          user_id: string | null
          waste_type: string
        }
        Insert: {
          batch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          product_id: string
          qty: number
          reason?: string | null
          tenant_id: string
          total_value?: number | null
          unit_cost?: number | null
          user_id?: string | null
          waste_type: string
        }
        Update: {
          batch_id?: string | null
          created_at?: string
          id?: string
          note?: string | null
          product_id?: string
          qty?: number
          reason?: string | null
          tenant_id?: string
          total_value?: number | null
          unit_cost?: number | null
          user_id?: string | null
          waste_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "inventory_waste_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batch_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_waste_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "product_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_waste_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_waste_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inventory_waste_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "inventory_waste_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          due_date: string | null
          id: string
          invoice_number: string | null
          metadata: Json
          paid_at: string | null
          status: string
          subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          metadata?: Json
          paid_at?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          due_date?: string | null
          id?: string
          invoice_number?: string | null
          metadata?: Json
          paid_at?: string | null
          status?: string
          subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "tenant_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      manager_handovers: {
        Row: {
          acknowledged_at: string | null
          cash_amount: number
          created_at: string
          from_shift_id: string | null
          from_user: string
          id: string
          notes: string | null
          tenant_id: string
          to_shift_id: string | null
          to_user: string | null
        }
        Insert: {
          acknowledged_at?: string | null
          cash_amount?: number
          created_at?: string
          from_shift_id?: string | null
          from_user: string
          id?: string
          notes?: string | null
          tenant_id: string
          to_shift_id?: string | null
          to_user?: string | null
        }
        Update: {
          acknowledged_at?: string | null
          cash_amount?: number
          created_at?: string
          from_shift_id?: string | null
          from_user?: string
          id?: string
          notes?: string | null
          tenant_id?: string
          to_shift_id?: string | null
          to_user?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manager_handovers_from_shift_id_fkey"
            columns: ["from_shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_handovers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manager_handovers_to_shift_id_fkey"
            columns: ["to_shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      party_payments: {
        Row: {
          amount: number
          cash_transaction_id: string | null
          created_at: string
          id: string
          method: string
          note: string | null
          party_id: string
          party_type: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          amount: number
          cash_transaction_id?: string | null
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          party_id: string
          party_type: string
          tenant_id?: string
          user_id?: string | null
        }
        Update: {
          amount?: number
          cash_transaction_id?: string | null
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          party_id?: string
          party_type?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "party_payments_cash_transaction_id_fkey"
            columns: ["cash_transaction_id"]
            isOneToOne: false
            referencedRelation: "cash_transactions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "party_payments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_barcodes: {
        Row: {
          barcode: string
          created_at: string
          id: string
          import_batch_id: string | null
          label: string | null
          product_id: string
          tenant_id: string
        }
        Insert: {
          barcode: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          label?: string | null
          product_id: string
          tenant_id?: string
        }
        Update: {
          barcode?: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          label?: string | null
          product_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_barcodes_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_barcodes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_barcodes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_barcodes_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_barcodes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_batches: {
        Row: {
          batch_no: string | null
          created_at: string
          expiry_date: string | null
          id: string
          mfg_date: string | null
          note: string | null
          product_id: string
          purchase_date: string | null
          purchase_id: string | null
          qty_initial: number
          qty_remaining: number
          status: string
          supplier_id: string | null
          tenant_id: string
          unit_cost: number | null
          updated_at: string
        }
        Insert: {
          batch_no?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          mfg_date?: string | null
          note?: string | null
          product_id: string
          purchase_date?: string | null
          purchase_id?: string | null
          qty_initial?: number
          qty_remaining?: number
          status?: string
          supplier_id?: string | null
          tenant_id: string
          unit_cost?: number | null
          updated_at?: string
        }
        Update: {
          batch_no?: string | null
          created_at?: string
          expiry_date?: string | null
          id?: string
          mfg_date?: string | null
          note?: string | null
          product_id?: string
          purchase_date?: string | null
          purchase_id?: string | null
          qty_initial?: number
          qty_remaining?: number
          status?: string
          supplier_id?: string | null
          tenant_id?: string
          unit_cost?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_batches_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          abc_period_days: number | null
          allow_negative_stock: boolean
          barcode: string | null
          batch_no: string | null
          category: string | null
          cost_price: number
          created_at: string
          expiry_date: string | null
          id: string
          import_batch_id: string | null
          is_active: boolean
          lead_time_days: number | null
          low_stock_threshold: number
          max_stock: number | null
          min_stock: number | null
          name: string
          preferred_supplier_id: string | null
          rack_location: string | null
          reorder_qty: number | null
          safety_stock: number | null
          sell_price: number
          shelf_life_days: number | null
          sku: string | null
          stock: number
          tax_rate: number
          tenant_id: string
          track_batches: boolean
          unit: string | null
          updated_at: string
        }
        Insert: {
          abc_period_days?: number | null
          allow_negative_stock?: boolean
          barcode?: string | null
          batch_no?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          lead_time_days?: number | null
          low_stock_threshold?: number
          max_stock?: number | null
          min_stock?: number | null
          name: string
          preferred_supplier_id?: string | null
          rack_location?: string | null
          reorder_qty?: number | null
          safety_stock?: number | null
          sell_price?: number
          shelf_life_days?: number | null
          sku?: string | null
          stock?: number
          tax_rate?: number
          tenant_id?: string
          track_batches?: boolean
          unit?: string | null
          updated_at?: string
        }
        Update: {
          abc_period_days?: number | null
          allow_negative_stock?: boolean
          barcode?: string | null
          batch_no?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          expiry_date?: string | null
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          lead_time_days?: number | null
          low_stock_threshold?: number
          max_stock?: number | null
          min_stock?: number | null
          name?: string
          preferred_supplier_id?: string | null
          rack_location?: string | null
          reorder_qty?: number | null
          safety_stock?: number | null
          sell_price?: number
          shelf_life_days?: number | null
          sku?: string | null
          stock?: number
          tax_rate?: number
          tenant_id?: string
          track_batches?: boolean
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      purchase_items: {
        Row: {
          batch_no: string | null
          cost: number
          expiry_date: string | null
          id: string
          line_total: number
          mfg_date: string | null
          name: string
          product_id: string | null
          purchase_id: string
          qty: number
          tenant_id: string
        }
        Insert: {
          batch_no?: string | null
          cost: number
          expiry_date?: string | null
          id?: string
          line_total: number
          mfg_date?: string | null
          name: string
          product_id?: string | null
          purchase_id: string
          qty: number
          tenant_id?: string
        }
        Update: {
          batch_no?: string | null
          cost?: number
          expiry_date?: string | null
          id?: string
          line_total?: number
          mfg_date?: string | null
          name?: string
          product_id?: string | null
          purchase_id?: string
          qty?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_items_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_return_items: {
        Row: {
          cost: number
          id: string
          line_total: number
          name: string
          product_id: string | null
          qty: number
          return_id: string
          tenant_id: string
        }
        Insert: {
          cost: number
          id?: string
          line_total: number
          name: string
          product_id?: string | null
          qty: number
          return_id: string
          tenant_id?: string
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          qty?: number
          return_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "purchase_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "purchase_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_return_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchase_returns: {
        Row: {
          created_at: string
          id: string
          note: string | null
          purchase_id: string | null
          refund_amount: number
          refund_method: string
          return_no: string
          subtotal: number
          supplier_id: string | null
          tax: number
          tenant_id: string
          total: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          note?: string | null
          purchase_id?: string | null
          refund_amount?: number
          refund_method?: string
          return_no?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          tenant_id?: string
          total?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          note?: string | null
          purchase_id?: string | null
          refund_amount?: number
          refund_method?: string
          return_no?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          tenant_id?: string
          total?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_returns_purchase_id_fkey"
            columns: ["purchase_id"]
            isOneToOne: false
            referencedRelation: "purchases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchase_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      purchases: {
        Row: {
          account_id: string | null
          created_at: string
          id: string
          incentive_amount: number
          invoice_no: string
          note: string | null
          paid: number
          payment_method: string
          status: string
          subtotal: number
          supplier_id: string | null
          tax: number
          tenant_id: string
          total: number
          user_id: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string
          id?: string
          incentive_amount?: number
          invoice_no?: string
          note?: string | null
          paid?: number
          payment_method?: string
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          tenant_id?: string
          total?: number
          user_id?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string
          id?: string
          incentive_amount?: number
          invoice_no?: string
          note?: string | null
          paid?: number
          payment_method?: string
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          tenant_id?: string
          total?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchases_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "cash_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "purchases_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_reprints: {
        Row: {
          created_at: string
          id: string
          reason: string | null
          sale_id: string
          shift_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          reason?: string | null
          sale_id: string
          shift_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          reason?: string | null
          sale_id?: string
          shift_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_reprints_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_reprints_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_reprints_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          cost: number
          id: string
          line_total: number
          name: string
          price: number
          product_id: string | null
          qty: number
          sale_id: string
          tenant_id: string
        }
        Insert: {
          cost?: number
          id?: string
          line_total: number
          name: string
          price: number
          product_id?: string | null
          qty: number
          sale_id: string
          tenant_id?: string
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          price?: number
          product_id?: string | null
          qty?: number
          sale_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_return_items: {
        Row: {
          cost: number
          id: string
          line_total: number
          name: string
          price: number
          product_id: string | null
          qty: number
          return_id: string
          tenant_id: string
        }
        Insert: {
          cost?: number
          id?: string
          line_total: number
          name: string
          price: number
          product_id?: string | null
          qty: number
          return_id: string
          tenant_id?: string
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          price?: number
          product_id?: string | null
          qty?: number
          return_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "sale_return_items_return_id_fkey"
            columns: ["return_id"]
            isOneToOne: false
            referencedRelation: "sale_returns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_return_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_returns: {
        Row: {
          created_at: string
          customer_id: string | null
          expense_person_id: string | null
          id: string
          note: string | null
          party_type: string
          refund_amount: number
          refund_method: string
          return_no: string
          sale_id: string | null
          subtotal: number
          tax: number
          tenant_id: string
          total: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          expense_person_id?: string | null
          id?: string
          note?: string | null
          party_type?: string
          refund_amount?: number
          refund_method?: string
          return_no?: string
          sale_id?: string | null
          subtotal?: number
          tax?: number
          tenant_id?: string
          total?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          expense_person_id?: string | null
          id?: string
          note?: string | null
          party_type?: string
          refund_amount?: number
          refund_method?: string
          return_no?: string
          sale_id?: string | null
          subtotal?: number
          tax?: number
          tenant_id?: string
          total?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_returns_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_expense_person_id_fkey"
            columns: ["expense_person_id"]
            isOneToOne: false
            referencedRelation: "expense_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_returns_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_voids: {
        Row: {
          approved_by: string | null
          created_at: string
          id: string
          invoice_no: string | null
          original_total: number
          payload: Json
          reason: string
          sale_id: string
          shift_id: string | null
          tenant_id: string
          voided_by: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          id?: string
          invoice_no?: string | null
          original_total: number
          payload: Json
          reason: string
          sale_id: string
          shift_id?: string | null
          tenant_id: string
          voided_by: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          id?: string
          invoice_no?: string | null
          original_total?: number
          payload?: Json
          reason?: string
          sale_id?: string
          shift_id?: string | null
          tenant_id?: string
          voided_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_voids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_voids_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cashier_id: string | null
          change_due: number
          cost_total: number
          created_at: string
          customer_id: string | null
          discount: number
          expense_person_id: string | null
          id: string
          invoice_no: string
          note: string | null
          paid: number
          payment_method: string
          status: string
          subtotal: number
          tax: number
          tenant_id: string
          total: number
          updated_at: string
        }
        Insert: {
          cashier_id?: string | null
          change_due?: number
          cost_total?: number
          created_at?: string
          customer_id?: string | null
          discount?: number
          expense_person_id?: string | null
          id?: string
          invoice_no?: string
          note?: string | null
          paid?: number
          payment_method?: string
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Update: {
          cashier_id?: string | null
          change_due?: number
          cost_total?: number
          created_at?: string
          customer_id?: string | null
          discount?: number
          expense_person_id?: string | null
          id?: string
          invoice_no?: string
          note?: string | null
          paid?: number
          payment_method?: string
          status?: string
          subtotal?: number
          tax?: number
          tenant_id?: string
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_expense_person_id_fkey"
            columns: ["expense_person_id"]
            isOneToOne: false
            referencedRelation: "expense_persons"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      security_blocklist: {
        Row: {
          auto_blocked: boolean
          blocked_by: string | null
          created_at: string
          expires_at: string | null
          id: string
          kind: string
          reason: string | null
          value: string
        }
        Insert: {
          auto_blocked?: boolean
          blocked_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind: string
          reason?: string | null
          value: string
        }
        Update: {
          auto_blocked?: boolean
          blocked_by?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          kind?: string
          reason?: string | null
          value?: string
        }
        Relationships: []
      }
      security_events: {
        Row: {
          created_at: string
          email: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          path: string | null
          severity: string
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email?: string | null
          event_type: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          path?: string | null
          severity?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string | null
          event_type?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          path?: string | null
          severity?: string
          tenant_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      shift_checklist: {
        Row: {
          completed: boolean
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          item_key: string
          label: string
          note: string | null
          shift_id: string
          tenant_id: string
        }
        Insert: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          item_key: string
          label: string
          note?: string | null
          shift_id: string
          tenant_id: string
        }
        Update: {
          completed?: boolean
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          item_key?: string
          label?: string
          note?: string | null
          shift_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_checklist_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_checklist_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_notes: {
        Row: {
          category: string | null
          created_at: string
          id: string
          note: string
          shift_id: string | null
          tenant_id: string
          user_id: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          id?: string
          note: string
          shift_id?: string | null
          tenant_id: string
          user_id: string
        }
        Update: {
          category?: string | null
          created_at?: string
          id?: string
          note?: string
          shift_id?: string | null
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_notes_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_notes_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      shift_sessions: {
        Row: {
          actual_cash: number | null
          approved_at: string | null
          approved_by: string | null
          business_date: string
          cashier_id: string
          close_reason: string | null
          closed_at: string | null
          closing_notes: string | null
          created_at: string
          difference: number | null
          emergency_reason: string | null
          expected_cash: number | null
          id: string
          opened_at: string
          opening_cash: number
          opening_notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_cash?: number | null
          approved_at?: string | null
          approved_by?: string | null
          business_date: string
          cashier_id: string
          close_reason?: string | null
          closed_at?: string | null
          closing_notes?: string | null
          created_at?: string
          difference?: number | null
          emergency_reason?: string | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_cash?: number
          opening_notes?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_cash?: number | null
          approved_at?: string | null
          approved_by?: string | null
          business_date?: string
          cashier_id?: string
          close_reason?: string | null
          closed_at?: string | null
          closing_notes?: string | null
          created_at?: string
          difference?: number | null
          emergency_reason?: string | null
          expected_cash?: number | null
          id?: string
          opened_at?: string
          opening_cash?: number
          opening_notes?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      shift_tasks: {
        Row: {
          assigned_to: string | null
          completed_at: string | null
          completed_by: string | null
          created_at: string
          created_by: string
          description: string | null
          due_at: string | null
          id: string
          priority: string
          shift_id: string | null
          status: string
          tenant_id: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by: string
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          shift_id?: string | null
          status?: string
          tenant_id: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          created_by?: string
          description?: string | null
          due_at?: string | null
          id?: string
          priority?: string
          shift_id?: string | null
          status?: string
          tenant_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shift_tasks_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shift_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shift_tasks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_items: {
        Row: {
          actual_qty: number
          barcode: string | null
          counted_at: string
          counter_id: string | null
          created_at: string
          id: string
          product_id: string
          reason: string | null
          session_id: string
          system_qty: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          actual_qty?: number
          barcode?: string | null
          counted_at?: string
          counter_id?: string | null
          created_at?: string
          id?: string
          product_id: string
          reason?: string | null
          session_id: string
          system_qty?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          actual_qty?: number
          barcode?: string | null
          counted_at?: string
          counter_id?: string | null
          created_at?: string
          id?: string
          product_id?: string
          reason?: string | null
          session_id?: string
          system_qty?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "stock_count_items_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "stock_count_sessions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_count_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_count_sessions: {
        Row: {
          approved_by: string | null
          completed_at: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          started_at: string
          started_by: string | null
          status: Database["public"]["Enums"]["stock_count_status"]
          tenant_id: string
          total_variance_value: number | null
          updated_at: string
        }
        Insert: {
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["stock_count_status"]
          tenant_id: string
          total_variance_value?: number | null
          updated_at?: string
        }
        Update: {
          approved_by?: string | null
          completed_at?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          started_at?: string
          started_by?: string | null
          status?: Database["public"]["Enums"]["stock_count_status"]
          tenant_id?: string
          total_variance_value?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_count_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      store_settings: {
        Row: {
          address: string | null
          critical_days: number
          currency: string
          currency_symbol: string
          expiring_soon_days: number
          id: number
          logo_url: string | null
          low_stock_threshold: number
          ops_allow_multiple_shifts: boolean
          ops_business_day_start_hour: number
          ops_cash_drawer_enabled: boolean
          ops_checklist_enabled: boolean
          ops_checklist_items: Json
          ops_hold_bills_enabled: boolean
          ops_paid_in_out_enabled: boolean
          ops_pending_tasks_enabled: boolean
          ops_receipt_reprint_enabled: boolean
          ops_reprint_audit_enabled: boolean
          ops_require_manager_approval: boolean
          ops_safe_drop_enabled: boolean
          ops_safe_drop_threshold: number
          ops_shift_enabled: boolean
          ops_shift_notes_enabled: boolean
          ops_target_invoices: number
          ops_target_profit: number
          ops_target_sales: number
          ops_void_requires_reason: boolean
          paper_width: string
          payment_qr_label: string | null
          payment_qr_url: string | null
          phone: string | null
          pos_print_prompt_default: string
          pos_print_prompt_enabled: boolean
          receipt_footer: string | null
          receipt_header: string | null
          show_address: boolean
          show_cashier: boolean
          show_logo: boolean
          show_payment_qr: boolean
          show_phone: boolean
          show_tax_id: boolean
          show_tax_lines: boolean
          stock_count_scan_mode: string
          store_name: string
          tax_id: string | null
          tax_rate: number
          tenant_id: string
          timezone: string
          undo_window_minutes: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          critical_days?: number
          currency?: string
          currency_symbol?: string
          expiring_soon_days?: number
          id?: number
          logo_url?: string | null
          low_stock_threshold?: number
          ops_allow_multiple_shifts?: boolean
          ops_business_day_start_hour?: number
          ops_cash_drawer_enabled?: boolean
          ops_checklist_enabled?: boolean
          ops_checklist_items?: Json
          ops_hold_bills_enabled?: boolean
          ops_paid_in_out_enabled?: boolean
          ops_pending_tasks_enabled?: boolean
          ops_receipt_reprint_enabled?: boolean
          ops_reprint_audit_enabled?: boolean
          ops_require_manager_approval?: boolean
          ops_safe_drop_enabled?: boolean
          ops_safe_drop_threshold?: number
          ops_shift_enabled?: boolean
          ops_shift_notes_enabled?: boolean
          ops_target_invoices?: number
          ops_target_profit?: number
          ops_target_sales?: number
          ops_void_requires_reason?: boolean
          paper_width?: string
          payment_qr_label?: string | null
          payment_qr_url?: string | null
          phone?: string | null
          pos_print_prompt_default?: string
          pos_print_prompt_enabled?: boolean
          receipt_footer?: string | null
          receipt_header?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_logo?: boolean
          show_payment_qr?: boolean
          show_phone?: boolean
          show_tax_id?: boolean
          show_tax_lines?: boolean
          stock_count_scan_mode?: string
          store_name?: string
          tax_id?: string | null
          tax_rate?: number
          tenant_id?: string
          timezone?: string
          undo_window_minutes?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          critical_days?: number
          currency?: string
          currency_symbol?: string
          expiring_soon_days?: number
          id?: number
          logo_url?: string | null
          low_stock_threshold?: number
          ops_allow_multiple_shifts?: boolean
          ops_business_day_start_hour?: number
          ops_cash_drawer_enabled?: boolean
          ops_checklist_enabled?: boolean
          ops_checklist_items?: Json
          ops_hold_bills_enabled?: boolean
          ops_paid_in_out_enabled?: boolean
          ops_pending_tasks_enabled?: boolean
          ops_receipt_reprint_enabled?: boolean
          ops_reprint_audit_enabled?: boolean
          ops_require_manager_approval?: boolean
          ops_safe_drop_enabled?: boolean
          ops_safe_drop_threshold?: number
          ops_shift_enabled?: boolean
          ops_shift_notes_enabled?: boolean
          ops_target_invoices?: number
          ops_target_profit?: number
          ops_target_sales?: number
          ops_void_requires_reason?: boolean
          paper_width?: string
          payment_qr_label?: string | null
          payment_qr_url?: string | null
          phone?: string | null
          pos_print_prompt_default?: string
          pos_print_prompt_enabled?: boolean
          receipt_footer?: string | null
          receipt_header?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_logo?: boolean
          show_payment_qr?: boolean
          show_phone?: boolean
          show_tax_id?: boolean
          show_tax_lines?: boolean
          stock_count_scan_mode?: string
          store_name?: string
          tax_id?: string | null
          tax_rate?: number
          tenant_id?: string
          timezone?: string
          undo_window_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          features: Json
          id: string
          max_products: number | null
          max_users: number | null
          name: string
          price_monthly: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          max_products?: number | null
          max_users?: number | null
          name: string
          price_monthly?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          features?: Json
          id?: string
          max_products?: number | null
          max_users?: number | null
          name?: string
          price_monthly?: number
        }
        Relationships: []
      }
      suppliers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          email: string | null
          id: string
          import_batch_id: string | null
          name: string
          opening_balance: number
          phone: string | null
          tenant_id: string
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name: string
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name?: string
          opening_balance?: number
          phone?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "suppliers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      sync_queue: {
        Row: {
          client_uuid: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          last_error: string | null
          operation: string
          payload: Json
          retry_count: number
          status: string
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          client_uuid?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          last_error?: string | null
          operation: string
          payload: Json
          retry_count?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          client_uuid?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          last_error?: string | null
          operation?: string
          payload?: Json
          retry_count?: number
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sync_queue_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      system_health_log: {
        Row: {
          check_name: string
          checked_at: string
          detail: string | null
          id: number
          issue_count: number
          severity: string
          tenant_id: string | null
        }
        Insert: {
          check_name: string
          checked_at?: string
          detail?: string | null
          id?: number
          issue_count: number
          severity: string
          tenant_id?: string | null
        }
        Update: {
          check_name?: string
          checked_at?: string
          detail?: string | null
          id?: number
          issue_count?: number
          severity?: string
          tenant_id?: string | null
        }
        Relationships: []
      }
      tenant_feature_overrides: {
        Row: {
          enabled: boolean
          flag_key: string
          id: string
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled: boolean
          flag_key: string
          id?: string
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          flag_key?: string
          id?: string
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_feature_overrides_flag_key_fkey"
            columns: ["flag_key"]
            isOneToOne: false
            referencedRelation: "feature_flags"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "tenant_feature_overrides_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_invitations: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          token?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_invitations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_library_categories: {
        Row: {
          category: string
          created_at: string
          id: string
          tenant_id: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          tenant_id: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_library_categories_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_onboarding: {
        Row: {
          completed: boolean
          created_at: string
          id: string
          metadata: Json | null
          step: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          completed?: boolean
          created_at?: string
          id?: string
          metadata?: Json | null
          step: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          completed?: boolean
          created_at?: string
          id?: string
          metadata?: Json | null
          step?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_onboarding_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_role_permissions: {
        Row: {
          permission: string
          role: Database["public"]["Enums"]["tenant_role"]
        }
        Insert: {
          permission: string
          role: Database["public"]["Enums"]["tenant_role"]
        }
        Update: {
          permission?: string
          role?: Database["public"]["Enums"]["tenant_role"]
        }
        Relationships: []
      }
      tenant_sequences: {
        Row: {
          last_purchase_return_value: number
          last_purchase_value: number
          last_sale_return_value: number
          last_sale_value: number
          tenant_id: string
        }
        Insert: {
          last_purchase_return_value?: number
          last_purchase_value?: number
          last_sale_return_value?: number
          last_sale_value?: number
          tenant_id: string
        }
        Update: {
          last_purchase_return_value?: number
          last_purchase_value?: number
          last_sale_return_value?: number
          last_sale_value?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_sequences_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          plan_id: string
          started_at: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id: string
          started_at?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          plan_id?: string
          started_at?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_user_permissions: {
        Row: {
          created_at: string
          granted: boolean
          granted_by: string | null
          id: string
          permission: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          granted?: boolean
          granted_by?: string | null
          id?: string
          permission: string
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          granted_by?: string | null
          id?: string
          permission?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_user_permissions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          created_at: string
          id: string
          library_approved: boolean
          library_show_cost_price: boolean
          library_show_sell_price: boolean
          metadata: Json
          name: string
          owner_id: string | null
          plan: string
          shop_code: string | null
          slug: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          library_approved?: boolean
          library_show_cost_price?: boolean
          library_show_sell_price?: boolean
          metadata?: Json
          name: string
          owner_id?: string | null
          plan?: string
          shop_code?: string | null
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          library_approved?: boolean
          library_show_cost_price?: boolean
          library_show_sell_price?: boolean
          metadata?: Json
          name?: string
          owner_id?: string | null
          plan?: string
          shop_code?: string | null
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      user_permissions: {
        Row: {
          granted_at: string
          granted_by: string | null
          perm: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          perm: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          perm?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          device_id: string
          id: string
          last_seen: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          device_id: string
          id?: string
          last_seen?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          device_id?: string
          id?: string
          last_seen?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      admin_action_log_view: {
        Row: {
          action: string | null
          actor_id: string | null
          after_state: Json | null
          before_state: Json | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          metadata: Json | null
          reason: string | null
          tenant_id: string | null
          tenant_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_action_log_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_support_sessions_view: {
        Row: {
          admin_id: string | null
          ended_at: string | null
          ended_reason: string | null
          expires_at: string | null
          id: string | null
          is_active: boolean | null
          reason: string | null
          started_at: string | null
          tenant_id: string | null
          tenant_name: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_support_sessions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_batch_status: {
        Row: {
          batch_no: string | null
          days_remaining: number | null
          expiry_date: string | null
          expiry_status: string | null
          id: string | null
          product_id: string | null
          product_name: string | null
          purchase_date: string | null
          qty_initial: number | null
          qty_remaining: number | null
          sku: string | null
          status: string | null
          supplier_id: string | null
          tenant_id: string | null
          unit: string | null
          unit_cost: number | null
          value_remaining: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "product_intelligence"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "smart_purchase_suggestions"
            referencedColumns: ["product_id"]
          },
          {
            foreignKeyName: "product_batches_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_batches_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      product_intelligence: {
        Row: {
          abc_class: string | null
          avg_daily: number | null
          avg_monthly: number | null
          avg_weekly: number | null
          category: string | null
          cogs_90d: number | null
          cost_price: number | null
          days_remaining: number | null
          health_score: number | null
          inventory_turnover: number | null
          is_dead_stock: boolean | null
          is_low_stock: boolean | null
          is_near_expiry: boolean | null
          is_out_of_stock: boolean | null
          is_overstock: boolean | null
          is_sales_drop: boolean | null
          is_sales_spike: boolean | null
          last_sale_at: string | null
          lead_time_days: number | null
          max_stock: number | null
          min_stock: number | null
          name: string | null
          next_expiry: string | null
          preferred_supplier_id: string | null
          product_id: string | null
          profit_90d: number | null
          qty_expiring_30d: number | null
          reorder_qty: number | null
          revenue_90d: number | null
          safety_stock: number | null
          sales_qty_30d: number | null
          sales_qty_365d: number | null
          sales_qty_7d: number | null
          sales_qty_90d: number | null
          sell_price: number | null
          sell_through_30d: number | null
          sku: string | null
          stock: number | null
          suggested_qty: number | null
          tenant_id: string | null
          unit: string | null
          velocity_class: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["preferred_supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      smart_purchase_suggestions: {
        Row: {
          abc_class: string | null
          avg_daily: number | null
          cost_price: number | null
          days_remaining: number | null
          lead_time_days: number | null
          max_stock: number | null
          min_stock: number | null
          product_id: string | null
          product_name: string | null
          safety_stock: number | null
          sku: string | null
          stock: number | null
          suggested_cost: number | null
          suggested_qty: number | null
          supplier_id: string | null
          supplier_name: string | null
          tenant_id: string | null
          unit: string | null
          velocity_class: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_preferred_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      active_plan_for_tenant: {
        Args: { _tenant_id: string }
        Returns: {
          active: boolean
          created_at: string
          description: string | null
          features: Json
          id: string
          max_products: number | null
          max_users: number | null
          name: string
          price_monthly: number
        }
        SetofOptions: {
          from: "*"
          to: "subscription_plans"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      adjust_product_stock: {
        Args: {
          _new_stock: number
          _note?: string
          _product_id: string
          _reason?: string
        }
        Returns: string
      }
      admin_billing_summary: { Args: never; Returns: Json }
      admin_block_identifier: {
        Args: {
          _hours?: number
          _kind: string
          _reason: string
          _value: string
        }
        Returns: string
      }
      admin_clear_security_events: {
        Args: {
          _older_than_days?: number
          _reason?: string
          _severity?: string
        }
        Returns: number
      }
      admin_clear_tenant_feature_override: {
        Args: { _flag_key: string; _tenant_id: string }
        Returns: undefined
      }
      admin_delete_tenant: {
        Args: { _confirm: string; _reason?: string; _tenant_id: string }
        Returns: Json
      }
      admin_end_support_session: {
        Args: { _session_id: string }
        Returns: undefined
      }
      admin_error_observability: { Args: never; Returns: Json }
      admin_export_tenant_data: {
        Args: {
          _category: string
          _limit?: number
          _offset?: number
          _tenant_id: string
        }
        Returns: Json
      }
      admin_has_perm: {
        Args: { _perm: string; _user_id: string }
        Returns: boolean
      }
      admin_list_feature_flags: { Args: never; Returns: Json }
      admin_list_security_events: {
        Args: { _limit?: number; _severity?: string }
        Returns: {
          created_at: string
          email: string | null
          event_type: string
          id: string
          ip_address: string | null
          metadata: Json | null
          path: string | null
          severity: string
          tenant_id: string | null
          user_agent: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "security_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_list_tenants: {
        Args: {
          _limit?: number
          _offset?: number
          _search?: string
          _status?: string
        }
        Returns: {
          created_at: string
          id: string
          last_activity_at: string
          member_count: number
          name: string
          owner_email: string
          owner_id: string
          owner_name: string
          plan: string
          product_count: number
          sales_count: number
          sales_total: number
          slug: string
          status: string
          subscription_expires_at: string
          subscription_status: string
          total_count: number
        }[]
      }
      admin_log_tenant_export: {
        Args: { _categories: string[]; _tenant_id: string }
        Returns: undefined
      }
      admin_platform_health: { Args: never; Returns: Json }
      admin_recent_errors: {
        Args: { _limit?: number }
        Returns: {
          created_at: string
          error_message: string
          error_type: string
          id: string
          page_or_module: string
          stack_trace: string
          tenant_id: string
          user_id: string
        }[]
      }
      admin_resolve_error: {
        Args: { _id: string; _note?: string }
        Returns: undefined
      }
      admin_resolve_errors_bulk: {
        Args: { _error_type?: string; _note?: string; _tenant_id?: string }
        Returns: number
      }
      admin_security_summary: { Args: never; Returns: Json }
      admin_set_tenant_expiry: {
        Args: { _expires_at: string; _tenant_id: string }
        Returns: undefined
      }
      admin_set_tenant_feature_override: {
        Args: { _enabled: boolean; _flag_key: string; _tenant_id: string }
        Returns: undefined
      }
      admin_set_tenant_plan:
        | { Args: { _plan: string; _tenant_id: string }; Returns: undefined }
        | {
            Args: {
              _expires_at?: string
              _plan_id: string
              _status?: string
              _tenant_id: string
            }
            Returns: undefined
          }
      admin_set_tenant_status: {
        Args: { _reason?: string; _status: string; _tenant_id: string }
        Returns: undefined
      }
      admin_shop_analytics: {
        Args: { _from?: string; _tenant_id: string; _to?: string }
        Returns: Json
      }
      admin_start_support_session: {
        Args: { _reason: string; _tenant_id: string }
        Returns: Json
      }
      admin_tenant_audit: {
        Args: { _limit?: number; _tenant_id: string }
        Returns: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          tenant_id: string | null
          user_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_tenant_detail: { Args: { _tenant_id: string }; Returns: Json }
      admin_unblock_identifier: { Args: { _id: string }; Returns: undefined }
      admin_unresolve_error: {
        Args: { _id: string; _note?: string }
        Returns: undefined
      }
      am_i_admin_staff: { Args: never; Returns: boolean }
      am_i_super_admin: { Args: never; Returns: boolean }
      approve_shift: { Args: { _shift_id: string }; Returns: string }
      approve_stock_count_session: {
        Args: { _session_id: string }
        Returns: string
      }
      bulk_import_from_global_library: { Args: never; Returns: number }
      business_date_of: { Args: { _ts: string }; Returns: string }
      can_add_product: { Args: { _tenant_id: string }; Returns: boolean }
      can_add_user: { Args: { _tenant_id: string }; Returns: boolean }
      close_shift: {
        Args: {
          _actual_cash: number
          _closing_notes?: string
          _reason?: string
          _shift_id: string
        }
        Returns: string
      }
      complete_purchase: { Args: { payload: Json }; Returns: string }
      complete_purchase_return: { Args: { payload: Json }; Returns: string }
      complete_sale: { Args: { payload: Json }; Returns: string }
      complete_sale_return: { Args: { payload: Json }; Returns: string }
      consume_batches_fefo: {
        Args: { _product_id: string; _qty: number }
        Returns: undefined
      }
      create_product_batch: {
        Args: {
          _batch_no: string
          _expiry_date: string
          _mfg_date: string
          _note: string
          _product_id: string
          _qty: number
          _supplier_id: string
          _unit_cost: number
        }
        Returns: string
      }
      current_shift: {
        Args: never
        Returns: {
          actual_cash: number | null
          approved_at: string | null
          approved_by: string | null
          business_date: string
          cashier_id: string
          close_reason: string | null
          closed_at: string | null
          closing_notes: string | null
          created_at: string
          difference: number | null
          emergency_reason: string | null
          expected_cash: number | null
          id: string
          opened_at: string
          opening_cash: number
          opening_notes: string | null
          status: string
          tenant_id: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "shift_sessions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      current_tenant_id: { Args: never; Returns: string }
      daily_summary: { Args: { _date: string }; Returns: Json }
      daily_timeline: {
        Args: { _date: string }
        Returns: {
          amount: number
          detail: string
          kind: string
          ref_id: string
          title: string
          ts: string
          user_id: string
        }[]
      }
      delete_party_payment: { Args: { _id: string }; Returns: undefined }
      delete_purchase_v2: { Args: { _purchase_id: string }; Returns: undefined }
      discard_held_bill: {
        Args: { _id: string; _reason: string }
        Returns: undefined
      }
      edit_sale:
        | { Args: { _items: Json; _sale_id: string }; Returns: string }
        | {
            Args: {
              _discount?: number
              _items: Json
              _paid?: number
              _sale_id: string
              _tax?: number
            }
            Returns: string
          }
      emergency_close_shift: {
        Args: { _reason: string; _shift_id: string }
        Returns: string
      }
      gen_tenant_slug: { Args: { _seed: string }; Returns: string }
      get_cash_flow_account_totals: {
        Args: { p_from_date?: string; p_to_date?: string }
        Returns: {
          account_id: string
          entry_count: number
          prior_in: number
          prior_out: number
          total_in: number
          total_out: number
        }[]
      }
      get_cash_flow_ledger: {
        Args: {
          p_account_id?: string
          p_from_date?: string
          p_limit?: number
          p_offset?: number
          p_payment_method?: string
          p_search?: string
          p_to_date?: string
        }
        Returns: {
          account_id: string
          account_name: string
          amount: number
          category: string
          created_at: string
          direction: string
          id: string
          notes: string
          occurred_on: string
          payment_method: string
          reference: string
          total_count: number
        }[]
      }
      get_cash_flow_summary: {
        Args: {
          p_account_id?: string
          p_from_date?: string
          p_to_date?: string
        }
        Returns: Json
      }
      get_dashboard_stats: {
        Args: { p_from_date: string; p_to_date: string }
        Returns: {
          sale_count: number
          total_purchases: number
          total_returns: number
          total_revenue: number
        }[]
      }
      get_dashboard_timeseries: {
        Args: { p_from_date: string; p_to_date: string }
        Returns: {
          bucket_date: string
          profit: number
          returns: number
          revenue: number
        }[]
      }
      get_inventory_value: { Args: never; Returns: number }
      get_low_stock_products: {
        Args: { p_limit?: number; p_threshold?: number }
        Returns: {
          cost_price: number
          id: string
          name: string
          sell_price: number
          stock: number
        }[]
      }
      get_my_shop_code: { Args: never; Returns: string }
      get_reports_summary: {
        Args: { p_from_date: string; p_to_date: string }
        Returns: Json
      }
      get_supplier_balances: {
        Args: never
        Returns: {
          address: string
          current_balance: number
          email: string
          id: string
          incentive_total: number
          name: string
          opening_balance: number
          phone: string
        }[]
      }
      get_supplier_ledger: {
        Args: { p_supplier_id: string }
        Returns: {
          credit: number
          debit: number
          entry_type: string
          id: string
          note: string
          occurred_at: string
          reference: string
          source_data: Json
        }[]
      }
      get_tenant_id_by_code: { Args: { _code: string }; Returns: string }
      get_top_selling_items: {
        Args: { p_from_date: string; p_limit?: number; p_to_date: string }
        Returns: {
          name: string
          qty: number
          total: number
        }[]
      }
      has_active_subscription: {
        Args: { _tenant_id: string }
        Returns: boolean
      }
      has_feature_access: {
        Args: { _feature: string; _tenant_id: string }
        Returns: boolean
      }
      has_permission:
        | { Args: { _perm: string; _user_id: string }; Returns: boolean }
        | {
            Args: { _perm: string; _tenant_id: string; _user_id: string }
            Returns: boolean
          }
      has_role:
        | {
            Args: {
              _role: Database["public"]["Enums"]["app_role"]
              _user_id: string
            }
            Returns: boolean
          }
        | {
            Args: {
              _role: Database["public"]["Enums"]["tenant_role"]
              _tenant_id: string
              _user_id: string
            }
            Returns: boolean
          }
      has_tenant_permission: {
        Args: { _perm: string; _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      health_status: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          first_seen: string
          issue_count: number
          last_checked: string
          severity: string
        }[]
      }
      hold_bill: {
        Args: {
          _customer: string
          _item_count: number
          _label: string
          _payload: Json
          _total: number
        }
        Returns: string
      }
      import_from_global_library: {
        Args: {
          _cost_price?: number
          _global_id: string
          _sell_price?: number
          _stock?: number
        }
        Returns: string
      }
      is_admin_staff: { Args: { _user_id: string }; Returns: boolean }
      is_blocked: { Args: { _email?: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
      }
      log_admin_action: {
        Args: {
          _action: string
          _after_state?: Json
          _before_state?: Json
          _entity_id?: string
          _entity_type?: string
          _metadata?: Json
          _reason?: string
          _tenant_id?: string
        }
        Returns: undefined
      }
      log_application_error: {
        Args: {
          _error_message: string
          _error_type: string
          _metadata?: Json
          _page_or_module?: string
          _stack_trace?: string
        }
        Returns: string
      }
      log_receipt_reprint: {
        Args: { _reason: string; _sale_id: string }
        Returns: string
      }
      log_security_event: {
        Args: {
          _email?: string
          _event_type: string
          _metadata?: Json
          _path?: string
          _severity?: string
        }
        Returns: string
      }
      morning_dashboard: { Args: never; Returns: Json }
      my_admin_perms: {
        Args: never
        Returns: {
          perm: string
        }[]
      }
      my_store_settings: {
        Args: never
        Returns: {
          address: string | null
          critical_days: number
          currency: string
          currency_symbol: string
          expiring_soon_days: number
          id: number
          logo_url: string | null
          low_stock_threshold: number
          ops_allow_multiple_shifts: boolean
          ops_business_day_start_hour: number
          ops_cash_drawer_enabled: boolean
          ops_checklist_enabled: boolean
          ops_checklist_items: Json
          ops_hold_bills_enabled: boolean
          ops_paid_in_out_enabled: boolean
          ops_pending_tasks_enabled: boolean
          ops_receipt_reprint_enabled: boolean
          ops_reprint_audit_enabled: boolean
          ops_require_manager_approval: boolean
          ops_safe_drop_enabled: boolean
          ops_safe_drop_threshold: number
          ops_shift_enabled: boolean
          ops_shift_notes_enabled: boolean
          ops_target_invoices: number
          ops_target_profit: number
          ops_target_sales: number
          ops_void_requires_reason: boolean
          paper_width: string
          payment_qr_label: string | null
          payment_qr_url: string | null
          phone: string | null
          pos_print_prompt_default: string
          pos_print_prompt_enabled: boolean
          receipt_footer: string | null
          receipt_header: string | null
          show_address: boolean
          show_cashier: boolean
          show_logo: boolean
          show_payment_qr: boolean
          show_phone: boolean
          show_tax_id: boolean
          show_tax_lines: boolean
          stock_count_scan_mode: string
          store_name: string
          tax_id: string | null
          tax_rate: number
          tenant_id: string
          timezone: string
          undo_window_minutes: number
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "store_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      my_tenant_expires_at: { Args: never; Returns: string }
      my_tenant_status: { Args: never; Returns: string }
      my_trial_info: { Args: never; Returns: Json }
      next_purchase_invoice_no: { Args: never; Returns: string }
      next_purchase_return_no: { Args: never; Returns: string }
      next_sale_invoice_no: { Args: never; Returns: string }
      next_sale_return_no: { Args: never; Returns: string }
      open_shift: {
        Args: { _notes?: string; _opening_cash: number }
        Returns: string
      }
      owner_alerts: { Args: never; Returns: Json }
      owner_recommendations: { Args: never; Returns: Json }
      prune_audit_logs: { Args: { _days?: number }; Returns: number }
      recalc_supplier_balances: {
        Args: { p_tenant_id?: string }
        Returns: number
      }
      record_cash_event: {
        Args: {
          _amount: number
          _reason: string
          _reference: string
          _type: string
        }
        Returns: string
      }
      record_cash_out: {
        Args: {
          p_account_id: string
          p_amount: number
          p_client_id?: string
          p_customer_id: string
          p_note?: string
          p_occurred_on?: string
          p_tenant_id?: string
        }
        Returns: string
      }
      record_damage: {
        Args: {
          _batch_id: string
          _damage_type: string
          _note: string
          _product_id: string
          _qty: number
          _reason: string
        }
        Returns: string
      }
      record_inventory_movement: {
        Args: {
          _customer_id: string
          _movement_type: Database["public"]["Enums"]["inventory_movement_type"]
          _note: string
          _product_id: string
          _qty_change: number
          _reason: string
          _reference_id: string
          _reference_no: string
          _reference_type: Database["public"]["Enums"]["inventory_reference_type"]
          _supplier_id: string
          _tenant_id: string
          _unit_cost: number
          _user_id: string
        }
        Returns: string
      }
      record_payment: {
        Args: {
          p_account_id?: string
          p_amount: number
          p_method: string
          p_note: string
          p_party_id: string
          p_party_type: string
        }
        Returns: string
      }
      record_waste: {
        Args: {
          _batch_id: string
          _note: string
          _product_id: string
          _qty: number
          _reason: string
          _waste_type: string
        }
        Returns: string
      }
      register_shop: {
        Args: {
          _address?: string
          _city?: string
          _name: string
          _phone?: string
        }
        Returns: string
      }
      resolve_cash_account: {
        Args: { p_method: string; p_tenant_id: string }
        Returns: string
      }
      resolve_feature_flag: {
        Args: { _flag_key: string; _tenant_id: string }
        Returns: boolean
      }
      resolve_payment_bucket: { Args: { p_method: string }; Returns: string }
      resume_bill: { Args: { _id: string }; Returns: Json }
      run_health_check: {
        Args: never
        Returns: {
          check_name: string
          detail: string
          issue_count: number
          severity: string
        }[]
      }
      set_checklist_item: {
        Args: {
          _completed: boolean
          _key: string
          _label: string
          _note: string
          _shift_id: string
        }
        Returns: string
      }
      shift_report: { Args: { _shift_id: string }; Returns: Json }
      shop_owner_finalize_staff: {
        Args: {
          _perms?: string[]
          _role: Database["public"]["Enums"]["app_role"]
          _staff_user_id: string
          _username: string
        }
        Returns: undefined
      }
      shop_owner_remove_staff: {
        Args: { _staff_user_id: string }
        Returns: undefined
      }
      shop_owner_set_staff_access: {
        Args: {
          _perms?: string[]
          _role: Database["public"]["Enums"]["app_role"]
          _staff_user_id: string
        }
        Returns: undefined
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      split_payment_parts: {
        Args: { p_method: string }
        Returns: {
          part_amount: number
          part_name: string
        }[]
      }
      supplier_balance_calc: {
        Args: { p_supplier_id: string }
        Returns: number
      }
      tenant_category_allowed: {
        Args: { _category: string; _tenant: string }
        Returns: boolean
      }
      tenant_timezone: { Args: { p_tenant_id: string }; Returns: string }
      undo_last_sale: { Args: { _sale_id: string }; Returns: Json }
      update_party_payment: {
        Args: {
          _account_id?: string
          _amount: number
          _created_at: string
          _id: string
          _method: string
          _note: string
        }
        Returns: undefined
      }
      url_decode: { Args: { p_text: string }; Returns: string }
      void_sale: { Args: { _reason: string; _sale_id: string }; Returns: Json }
    }
    Enums: {
      app_role: "admin" | "cashier" | "super_admin"
      inventory_movement_type:
        | "purchase"
        | "sale"
        | "sale_return"
        | "purchase_return"
        | "adjustment"
        | "undo_sale"
        | "opening_balance"
        | "transfer"
        | "stock_count"
        | "expired"
        | "damaged"
        | "lost"
        | "waste"
        | "donation"
        | "internal_use"
      inventory_reference_type:
        | "sale"
        | "purchase"
        | "sale_return"
        | "purchase_return"
        | "adjustment"
        | "undo_sale"
        | "opening_balance"
        | "manual"
        | "transfer"
        | "stock_count"
        | "damage"
        | "waste"
        | "batch"
      stock_count_status: "draft" | "in_progress" | "completed" | "cancelled"
      tenant_role:
        | "owner"
        | "admin"
        | "manager"
        | "cashier"
        | "viewer"
        | "staff"
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
      app_role: ["admin", "cashier", "super_admin"],
      inventory_movement_type: [
        "purchase",
        "sale",
        "sale_return",
        "purchase_return",
        "adjustment",
        "undo_sale",
        "opening_balance",
        "transfer",
        "stock_count",
        "expired",
        "damaged",
        "lost",
        "waste",
        "donation",
        "internal_use",
      ],
      inventory_reference_type: [
        "sale",
        "purchase",
        "sale_return",
        "purchase_return",
        "adjustment",
        "undo_sale",
        "opening_balance",
        "manual",
        "transfer",
        "stock_count",
        "damage",
        "waste",
        "batch",
      ],
      stock_count_status: ["draft", "in_progress", "completed", "cancelled"],
      tenant_role: ["owner", "admin", "manager", "cashier", "viewer", "staff"],
    },
  },
} as const
