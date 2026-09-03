import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type QuickAddedProduct = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  cost_price: number;
  sell_price: number;
  stock: number;
};

type NewProdForm = {
  name: string; sku: string; barcode: string; category: string; unit: string;
  cost_price: number; sell_price: number; tax_rate: number; low_stock_threshold: number;
  supplier_id: string; batch_no: string; expiry_date: string; rack_location: string; allow_negative_stock: boolean;
};

const emptyNewProd: NewProdForm = {
  name: "", sku: "", barcode: "", category: "", unit: "pcs",
  cost_price: 0, sell_price: 0, tax_rate: 0, low_stock_threshold: 5, supplier_id: "",
  batch_no: "", expiry_date: "", rack_location: "", allow_negative_stock: true,
};

/**
 * "Add new product" dialog shared by every place in the app that needs to
 * create a product inline and immediately use it (Purchases' manual entry
 * search, and the AI bill scanner's "barcode not found" flow) — one insert
 * path so they never drift into inconsistent behavior.
 */
export function QuickAddProductDialog({
  open,
  onOpenChange,
  prefill,
  defaultSupplierId,
  suppliers,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeded whenever the dialog opens for a new prefill (a scanned barcode, a typed code, …). */
  prefill?: { name?: string; sku?: string; barcode?: string; cost_price?: number };
  defaultSupplierId?: string;
  suppliers: { id: string; name: string }[];
  onSaved: (product: QuickAddedProduct) => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [newProd, setNewProd] = useState<NewProdForm>(emptyNewProd);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setNewProd({
      ...emptyNewProd,
      name: prefill?.name ?? "",
      sku: prefill?.sku ?? "",
      barcode: prefill?.barcode ?? "",
      cost_price: prefill?.cost_price ?? 0,
      supplier_id: defaultSupplierId ?? "",
    });
    // Suggest the next sequential SKU only when the caller didn't already hand us one
    // (e.g. a scanned/typed code) — never overwrite a real value with a guess.
    if (!prefill?.sku) {
      supabase.rpc("next_product_sku").then(({ data, error }) => {
        if (!error && data) setNewProd((prev) => (prev.sku ? prev : { ...prev, sku: data as string }));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const save = async () => {
    if (!newProd.name.trim()) return toast.error(t('common.name_required', 'Name required'));
    const primary = newProd.barcode.trim() || newProd.sku.trim() || newProd.name.trim();
    setSaving(true);
    const payload = {
      name: newProd.name.trim(),
      sku: newProd.sku.trim() || null,
      barcode: primary,
      category: newProd.category.trim() || null,
      unit: newProd.unit || "pcs",
      cost_price: Number(newProd.cost_price) || 0,
      sell_price: Number(newProd.sell_price) || 0,
      stock: 0,
      tax_rate: Number(newProd.tax_rate) || 0,
      low_stock_threshold: Number(newProd.low_stock_threshold) || 0,
      preferred_supplier_id: newProd.supplier_id || null,
      batch_no: newProd.batch_no.trim() || null,
      expiry_date: newProd.expiry_date || null,
      rack_location: newProd.rack_location.trim() || null,
      allow_negative_stock: newProd.allow_negative_stock,
      is_active: true,
    };
    const { data, error } = await supabase.from("products").insert(payload).select("id,name,sku,barcode,cost_price,sell_price,stock").single();
    if (!error && data) {
      await supabase.from("product_barcodes").insert({ product_id: data.id, barcode: primary });
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('products.product_added', 'Product added'));
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_barcodes"] });
    onSaved(data as QuickAddedProduct);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t('purchases.add_new_product_title', 'Add new product')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>{t('pos.qa_supplier', 'Supplier')}</Label>
            <select
              value={newProd.supplier_id || "none"}
              onChange={(e) => setNewProd((prev) => ({ ...prev, supplier_id: e.target.value === "none" ? "" : e.target.value }))}
              className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="none">{t('products.none_option', '— None —')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <Label>{t('common.name', 'Name')}</Label>
            <Input autoFocus value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('purchases.item_code_sku_label', 'Item code (SKU)')}</Label>
              <Input value={newProd.sku} onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })} />
            </div>
            <div>
              <Label>{t('purchases.barcode_label', 'Barcode')}</Label>
              <Input value={newProd.barcode} onChange={(e) => setNewProd({ ...newProd, barcode: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t('pos.qa_category', 'Category')}</Label>
              <Input value={newProd.category} onChange={(e) => setNewProd({ ...newProd, category: e.target.value })} />
            </div>
            <div>
              <Label>{t('pos.qa_unit', 'Unit')}</Label>
              <Input value={newProd.unit} onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label>{t('products.cost_label', 'Purchase rate (Cost)')}</Label>
              <Input type="number" step="0.01" value={newProd.cost_price || ""} onChange={(e) => setNewProd({ ...newProd, cost_price: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t('pos.qa_sell_price', 'Sell price')}</Label>
              <Input type="number" step="0.01" value={newProd.sell_price || ""} onChange={(e) => setNewProd({ ...newProd, sell_price: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t('pos.qa_tax_pct', 'Tax %')}</Label>
              <Input type="number" step="0.01" value={newProd.tax_rate || ""} onChange={(e) => setNewProd({ ...newProd, tax_rate: Number(e.target.value) })} />
            </div>
            <div>
              <Label>{t('purchases.low_stock_alert_label', 'Low stock alert')}</Label>
              <Input type="number" step="1" value={newProd.low_stock_threshold || ""} onChange={(e) => setNewProd({ ...newProd, low_stock_threshold: Number(e.target.value) })} />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <Label>{t('purchases.batch_no_label', 'Batch no')}</Label>
              <Input value={newProd.batch_no} onChange={(e) => setNewProd({ ...newProd, batch_no: e.target.value })} />
            </div>
            <div>
              <Label>{t('pos.qa_expiry_date', 'Expiry date')}</Label>
              <Input type="date" value={newProd.expiry_date} onChange={(e) => setNewProd({ ...newProd, expiry_date: e.target.value })} />
            </div>
            <div>
              <Label>{t('purchases.rack_location_label', 'Rack / location')}</Label>
              <Input value={newProd.rack_location} onChange={(e) => setNewProd({ ...newProd, rack_location: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={newProd.allow_negative_stock}
              onChange={(e) => setNewProd({ ...newProd, allow_negative_stock: e.target.checked })}
            />
            {t('purchases.allow_negative_checkbox', 'Allow selling below zero stock')}
          </label>
          <p className="text-xs text-muted-foreground">{t('purchases.opening_stock_note', 'Opening stock stays 0 — this purchase will add the actual quantity.')}</p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('common.saving', 'Saving…') : t('purchases.save_add_to_purchase', 'Save & add to purchase')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
