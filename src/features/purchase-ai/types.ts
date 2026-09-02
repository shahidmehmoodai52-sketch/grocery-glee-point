/** Strict-JSON shape returned by the server-side AI extraction call. */
export interface ExtractedBillItem {
  name: string | null;
  barcode: string | null;
  sku: string | null;
  qty: number | null;
  unit_cost: number | null;
  discount: number | null;
  tax: number | null;
  line_total: number | null;
}

export interface ExtractedBill {
  supplier_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  subtotal: number | null;
  total_discount: number | null;
  total_tax: number | null;
  grand_total: number | null;
  items: ExtractedBillItem[];
}

export type MatchStatus = "matched" | "verify" | "review" | "ambiguous" | "unmatched";

export interface MatchedProductOption {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  sell_price: number;
  stock: number;
}

/** One editable preview row: AI extraction + matching result + user edits. */
export interface PreviewLine {
  extracted_name: string;
  matchStatus: MatchStatus;
  matchConfidence: number;
  candidates: MatchedProductOption[];
  product_id: string | null;
  product_name: string;
  barcode: string | null;
  sku: string | null;
  qty: number;
  cost: number;
  discount: number;
}

export interface SupplierMatch {
  status: "matched" | "review" | "unmatched";
  confidence: number;
  supplier_id: string | null;
  supplier_name: string;
  candidates: { id: string; name: string }[];
}
