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
      application_errors: {
        Row: {
          created_at: string
          error_message: string
          error_type: string
          id: string
          metadata: Json | null
          page_or_module: string | null
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
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          new_data: Json | null
          old_data: Json | null
          record_id: string | null
          table_name: string
          tenant_id: string
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
          tenant_id: string
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
          tenant_id?: string
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
      customers: {
        Row: {
          address: string | null
          balance: number
          created_at: string
          email: string | null
          id: string
          import_batch_id: string | null
          name: string
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name: string
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name?: string
          phone?: string | null
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
      party_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          note: string | null
          party_id: string
          party_type: string
          tenant_id: string | null
          user_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          party_id: string
          party_type: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          note?: string | null
          party_id?: string
          party_type?: string
          tenant_id?: string | null
          user_id?: string | null
        }
        Relationships: [
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
          tenant_id: string | null
        }
        Insert: {
          barcode: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          label?: string | null
          product_id: string
          tenant_id?: string | null
        }
        Update: {
          barcode?: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          label?: string | null
          product_id?: string
          tenant_id?: string | null
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
            referencedRelation: "products"
            referencedColumns: ["id"]
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
      products: {
        Row: {
          barcode: string | null
          category: string | null
          cost_price: number
          created_at: string
          id: string
          import_batch_id: string | null
          is_active: boolean
          name: string
          sell_price: number
          sku: string | null
          stock: number
          tax_rate: number
          tenant_id: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          name: string
          sell_price?: number
          sku?: string | null
          stock?: number
          tax_rate?: number
          tenant_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category?: string | null
          cost_price?: number
          created_at?: string
          id?: string
          import_batch_id?: string | null
          is_active?: boolean
          name?: string
          sell_price?: number
          sku?: string | null
          stock?: number
          tax_rate?: number
          tenant_id?: string | null
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
          cost: number
          id: string
          line_total: number
          name: string
          product_id: string | null
          purchase_id: string
          qty: number
          tenant_id: string | null
        }
        Insert: {
          cost: number
          id?: string
          line_total: number
          name: string
          product_id?: string | null
          purchase_id: string
          qty: number
          tenant_id?: string | null
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          purchase_id?: string
          qty?: number
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          tenant_id: string | null
        }
        Insert: {
          cost: number
          id?: string
          line_total: number
          name: string
          product_id?: string | null
          qty: number
          return_id: string
          tenant_id?: string | null
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          qty?: number
          return_id?: string
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "purchase_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
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
          created_at: string
          id: string
          invoice_no: string
          note: string | null
          paid: number
          status: string
          subtotal: number
          supplier_id: string | null
          tax: number
          tenant_id: string | null
          total: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_no?: string
          note?: string | null
          paid?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          tenant_id?: string | null
          total?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          invoice_no?: string
          note?: string | null
          paid?: number
          status?: string
          subtotal?: number
          supplier_id?: string | null
          tax?: number
          tenant_id?: string | null
          total?: number
          user_id?: string | null
        }
        Relationships: [
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          tenant_id: string | null
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
          tenant_id?: string | null
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
          tenant_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sale_return_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
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
          id: string
          note: string | null
          refund_amount: number
          refund_method: string
          return_no: string
          sale_id: string | null
          subtotal: number
          tax: number
          tenant_id: string | null
          total: number
          user_id: string | null
        }
        Insert: {
          created_at?: string
          customer_id?: string | null
          id?: string
          note?: string | null
          refund_amount?: number
          refund_method?: string
          return_no?: string
          sale_id?: string | null
          subtotal?: number
          tax?: number
          tenant_id?: string | null
          total?: number
          user_id?: string | null
        }
        Update: {
          created_at?: string
          customer_id?: string | null
          id?: string
          note?: string | null
          refund_amount?: number
          refund_method?: string
          return_no?: string
          sale_id?: string | null
          subtotal?: number
          tax?: number
          tenant_id?: string | null
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
          tenant_id: string | null
          total: number
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
          tenant_id?: string | null
          total?: number
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
          tenant_id?: string | null
          total?: number
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
      store_settings: {
        Row: {
          address: string | null
          currency: string
          currency_symbol: string
          id: number
          logo_url: string | null
          paper_width: string
          payment_qr_label: string | null
          payment_qr_url: string | null
          phone: string | null
          receipt_footer: string | null
          receipt_header: string | null
          show_address: boolean
          show_cashier: boolean
          show_logo: boolean
          show_payment_qr: boolean
          show_phone: boolean
          show_tax_id: boolean
          show_tax_lines: boolean
          store_name: string
          tax_id: string | null
          tax_rate: number
          tenant_id: string | null
          updated_at: string
        }
        Insert: {
          address?: string | null
          currency?: string
          currency_symbol?: string
          id?: number
          logo_url?: string | null
          paper_width?: string
          payment_qr_label?: string | null
          payment_qr_url?: string | null
          phone?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_logo?: boolean
          show_payment_qr?: boolean
          show_phone?: boolean
          show_tax_id?: boolean
          show_tax_lines?: boolean
          store_name?: string
          tax_id?: string | null
          tax_rate?: number
          tenant_id?: string | null
          updated_at?: string
        }
        Update: {
          address?: string | null
          currency?: string
          currency_symbol?: string
          id?: number
          logo_url?: string | null
          paper_width?: string
          payment_qr_label?: string | null
          payment_qr_url?: string | null
          phone?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_logo?: boolean
          show_payment_qr?: boolean
          show_phone?: boolean
          show_tax_id?: boolean
          show_tax_lines?: boolean
          store_name?: string
          tax_id?: string | null
          tax_rate?: number
          tenant_id?: string | null
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
          phone: string | null
          tenant_id: string | null
        }
        Insert: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name: string
          phone?: string | null
          tenant_id?: string | null
        }
        Update: {
          address?: string | null
          balance?: number
          created_at?: string
          email?: string | null
          id?: string
          import_batch_id?: string | null
          name?: string
          phone?: string | null
          tenant_id?: string | null
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
      tenant_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["tenant_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
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
          metadata: Json
          name: string
          owner_id: string | null
          plan: string
          slug: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          metadata?: Json
          name: string
          owner_id?: string | null
          plan?: string
          slug?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          metadata?: Json
          name?: string
          owner_id?: string | null
          plan?: string
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      complete_purchase: { Args: { payload: Json }; Returns: string }
      complete_purchase_return: { Args: { payload: Json }; Returns: string }
      complete_sale: { Args: { payload: Json }; Returns: string }
      complete_sale_return: { Args: { payload: Json }; Returns: string }
      current_tenant_id: { Args: never; Returns: string }
      delete_party_payment: { Args: { _id: string }; Returns: undefined }
      has_active_subscription: {
        Args: { _tenant_id: string }
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
      is_tenant_member: {
        Args: { _tenant_id: string; _user_id: string }
        Returns: boolean
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
      my_store_settings: {
        Args: never
        Returns: {
          address: string | null
          currency: string
          currency_symbol: string
          id: number
          logo_url: string | null
          paper_width: string
          payment_qr_label: string | null
          payment_qr_url: string | null
          phone: string | null
          receipt_footer: string | null
          receipt_header: string | null
          show_address: boolean
          show_cashier: boolean
          show_logo: boolean
          show_payment_qr: boolean
          show_phone: boolean
          show_tax_id: boolean
          show_tax_lines: boolean
          store_name: string
          tax_id: string | null
          tax_rate: number
          tenant_id: string | null
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "store_settings"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_payment: {
        Args: {
          p_amount: number
          p_method: string
          p_note: string
          p_party_id: string
          p_party_type: string
        }
        Returns: string
      }
      update_party_payment: {
        Args: {
          _amount: number
          _created_at: string
          _id: string
          _method: string
          _note: string
        }
        Returns: undefined
      }
    }
    Enums: {
      app_role: "admin" | "cashier"
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
      app_role: ["admin", "cashier"],
      tenant_role: ["owner", "admin", "manager", "cashier", "viewer", "staff"],
    },
  },
} as const
