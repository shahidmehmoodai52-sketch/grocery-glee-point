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
        }
        Relationships: [
          {
            foreignKeyName: "customers_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
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
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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
          user_id?: string | null
        }
        Relationships: []
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
          user_id?: string | null
        }
        Relationships: []
      }
      product_barcodes: {
        Row: {
          barcode: string
          created_at: string
          id: string
          import_batch_id: string | null
          label: string | null
          product_id: string
        }
        Insert: {
          barcode: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          label?: string | null
          product_id: string
        }
        Update: {
          barcode?: string
          created_at?: string
          id?: string
          import_batch_id?: string | null
          label?: string | null
          product_id?: string
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
        }
        Insert: {
          cost: number
          id?: string
          line_total: number
          name: string
          product_id?: string | null
          purchase_id: string
          qty: number
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          purchase_id?: string
          qty?: number
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
        }
        Insert: {
          cost: number
          id?: string
          line_total: number
          name: string
          product_id?: string | null
          qty: number
          return_id: string
        }
        Update: {
          cost?: number
          id?: string
          line_total?: number
          name?: string
          product_id?: string | null
          qty?: number
          return_id?: string
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
          phone: string | null
          receipt_footer: string | null
          receipt_header: string | null
          show_address: boolean
          show_cashier: boolean
          show_logo: boolean
          show_phone: boolean
          show_tax_id: boolean
          show_tax_lines: boolean
          store_name: string
          tax_id: string | null
          tax_rate: number
          updated_at: string
        }
        Insert: {
          address?: string | null
          currency?: string
          currency_symbol?: string
          id?: number
          logo_url?: string | null
          paper_width?: string
          phone?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_logo?: boolean
          show_phone?: boolean
          show_tax_id?: boolean
          show_tax_lines?: boolean
          store_name?: string
          tax_id?: string | null
          tax_rate?: number
          updated_at?: string
        }
        Update: {
          address?: string | null
          currency?: string
          currency_symbol?: string
          id?: number
          logo_url?: string | null
          paper_width?: string
          phone?: string | null
          receipt_footer?: string | null
          receipt_header?: string | null
          show_address?: boolean
          show_cashier?: boolean
          show_logo?: boolean
          show_phone?: boolean
          show_tax_id?: boolean
          show_tax_lines?: boolean
          store_name?: string
          tax_id?: string | null
          tax_rate?: number
          updated_at?: string
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
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_import_batch_id_fkey"
            columns: ["import_batch_id"]
            isOneToOne: false
            referencedRelation: "import_batches"
            referencedColumns: ["id"]
          },
        ]
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
      has_permission: {
        Args: { _perm: string; _user_id: string }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
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
    }
    Enums: {
      app_role: "admin" | "cashier"
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
    },
  },
} as const
