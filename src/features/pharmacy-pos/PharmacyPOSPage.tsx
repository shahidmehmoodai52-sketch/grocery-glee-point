import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Search, Trash2, ShoppingCart, Loader2, Printer, Pill, AlertTriangle, Check, ChevronsUpDown, PauseCircle, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { fmtMoney, fmtQty } from "@/lib/format";
import { printInvoiceDirect } from "@/components/receipt";
import { ShiftBanner } from "@/components/shift-banner";
import { completeSaleOfflineAware, offlineFirst, cacheCustomers, searchProductsLocal, type CompleteSalePayload } from "@/lib/offline/pos";
import { db as offlineDb } from "@/lib/offline/db";
import { enqueueWrite } from "@/lib/offline/sync";
import { isOfflineNow } from "@/lib/offline/session";

type CustomerRow = { id: string; name: string; balance: number | null; phone: string | null };

/** Minimal inline customer combobox — a simplified, self-contained
 *  equivalent of pos.tsx's CustomerCombobox (which is a private,
 *  unexported component in that file). Same walk-in-vs-select-existing
 *  interaction pattern. */
function CustomerPicker({
  customers, value, onSelect, sym, t,
}: {
  customers: CustomerRow[]; value: string | null; onSelect: (id: string | null) => void; sym: string;
  t: (key: string, fallback: string, opts?: any) => string;
}) {
  const [open, setOpen] = useState(false);
  const selected = value ? customers.find((c) => c.id === value) ?? null : null;
  const walkInLabel = t('pharmacy_pos.walk_in_customer', 'Walk-in customer');
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="h-8 w-full justify-between font-normal text-sm">
          <span className="truncate">
            {selected
              ? `${selected.name}${Number(selected.balance) > 0 ? ` · ${t('pharmacy_pos.owes_amount', 'owes {{amount}}', { amount: fmtMoney(selected.balance, sym) })}` : ""}`
              : walkInLabel}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-0" align="start">
        <Command filter={(itemValue, search) => (itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder={t('pharmacy_pos.customer_search_placeholder', 'Search customer or phone…')} />
          <CommandList>
            <CommandEmpty>{t('pharmacy_pos.no_customer_found', 'No customer found.')}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="walk-in customer" onSelect={() => { onSelect(null); setOpen(false); }}>
                <Check className={cn("mr-2 h-4 w-4", !value ? "opacity-100" : "opacity-0")} />
                {walkInLabel}
              </CommandItem>
              {customers.map((c) => (
                <CommandItem key={c.id} value={`${c.name} ${c.phone ?? ""}`} onSelect={() => { onSelect(c.id); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === c.id ? "opacity-100" : "opacity-0")} />
                  <span className="truncate flex-1">{c.name}</span>
                  {Number(c.balance) > 0 && (
                    <span className="ml-2 text-[10px] text-destructive shrink-0">{fmtMoney(c.balance, sym)}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const PRODUCT_COLUMNS = "id,name,sku,barcode,sell_price,cost_price,stock,unit,category,tax_rate,track_batches";

type PharmacyDetail = {
  generic_name: string | null;
  strength: string | null;
  dosage_form: string | null;
  drug_schedule: string | null;
  prescription_required: boolean | null;
  pack_size: string | null;
  units_per_pack: number | null;
};

type ProductRow = {
  id: string; name: string; sku: string | null; barcode: string | null;
  sell_price: number; cost_price: number; stock: number; unit: string | null;
  category: string | null; tax_rate: number | null; track_batches: boolean | null;
  pharmacy?: PharmacyDetail | null;
};

type Line = {
  product_id: string; name: string; qty: number; price: number; cost: number;
  tax_rate: number; track_batches: boolean;
  generic_name: string | null; prescription_required: boolean;
  drug_schedule: string | null;
  // Unit-of-measure conversion — qty/price above always stay in the
  // product's base unit (e.g. "tablet"); pack_size/units_per_pack only
  // drive the optional pack-quantity input below. unit_mode is display-
  // only and never itself sent anywhere.
  pack_size: string | null; units_per_pack: number;
  unit_mode: "base" | "pack";
};

/** Pharmacy-only product search: brand name / SKU / barcode, plus generic
 *  (salt) name via pharmacy_product_details. Falls back to the shared
 *  offline product mirror when offline — generic-name matching and
 *  prescription/schedule flags aren't available offline yet since
 *  pharmacy_product_details isn't in the offline mirror (see PR notes). */
async function searchPharmacyProducts(term: string): Promise<ProductRow[]> {
  const q = term.trim().replace(/\s+/g, " ");
  if (!q) return [];

  if (isOfflineNow()) {
    const rows = await searchProductsLocal(q);
    return rows.map((p: any) => ({ ...p, pharmacy: null }));
  }

  const prefix = `${q}%`;
  const like = `%${q}%`;
  const [byNameRes, byBarcodeRes, bySkuRes, byGenericRes] = await Promise.all([
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).ilike("name", like).order("name").limit(30),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).ilike("barcode", prefix).limit(20),
    supabase.from("products").select(PRODUCT_COLUMNS).eq("is_active", true).ilike("sku", prefix).limit(20),
    supabase.from("pharmacy_product_details" as any).select("product_id,generic_name").ilike("generic_name", like).limit(30),
  ]);
  const firstError = byNameRes.error ?? byBarcodeRes.error ?? bySkuRes.error ?? byGenericRes.error;
  if (firstError) throw firstError;

  const merged = new Map<string, ProductRow>();
  for (const p of [...(byNameRes.data ?? []), ...(byBarcodeRes.data ?? []), ...(bySkuRes.data ?? [])]) {
    merged.set((p as any).id, p as any);
  }

  const genericIds = ((byGenericRes.data ?? []) as any[]).map((r) => r.product_id).filter(Boolean);
  if (genericIds.length) {
    const { data: genericProducts } = await supabase
      .from("products").select(PRODUCT_COLUMNS).eq("is_active", true).in("id", genericIds);
    for (const p of genericProducts ?? []) merged.set((p as any).id, p as any);
  }

  const allIds = Array.from(merged.keys());
  if (allIds.length) {
    const { data: details } = await supabase
      .from("pharmacy_product_details" as any)
      .select("product_id,generic_name,strength,dosage_form,drug_schedule,prescription_required,pack_size,units_per_pack")
      .in("product_id", allIds);
    for (const d of (details ?? []) as any[]) {
      const row = merged.get(d.product_id);
      if (row) row.pharmacy = d;
    }
  }

  return Array.from(merged.values());
}

export function PharmacyPOSPage() {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [search, setSearch] = useState("");
  const [results, setResults] = useState<ProductRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [cart, setCart, clearCart] = usePersistentState<Line[]>("pharmacy-pos-cart", []);
  const [discount, setDiscount] = useState(0);
  const [paid, setPaid] = useState<number | "">("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [prescriptionRef, setPrescriptionRef] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [lastSale, setLastSale] = useState<any>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const term = search.trim();
    if (!term) { setResults([]); return; }
    let cancelled = false;
    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const rows = await searchPharmacyProducts(term);
        if (!cancelled) setResults(rows);
      } catch (e: any) {
        if (!cancelled) toast.error(e?.message ?? t('pharmacy_pos.search_failed', 'Search failed'));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [search, t]);

  // Near-expiry / expired batch count — a pharmacy-specific alert grocery
  // doesn't need. Read-only, uses the existing product_batch_status view.
  const expiryAlertQ = useQuery({
    queryKey: ["pharmacy-pos-expiry-alert"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("product_batch_status" as any)
        .select("id", { count: "exact", head: true })
        .in("expiry_status", ["expired", "critical", "expiring_soon"]);
      if (error) throw error;
      return count ?? 0;
    },
    staleTime: 5 * 60_000,
    retry: false,
  });

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () =>
      offlineFirst<CustomerRow[]>(
        async () => {
          const { data, error } = await supabase.from("customers").select("id,name,balance,phone").order("name");
          if (error) throw error;
          return (data ?? []) as CustomerRow[];
        },
        async () =>
          (await offlineDb().customers.toArray())
            .sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "")) as CustomerRow[],
        (rows) => cacheCustomers(rows),
      ),
  });

  // ---- Held bills — same shared held_bills table/RPCs used by the grocery
  // POS (hold_bill/resume_bill/discard_held_bill). Payload is opaque jsonb
  // so pharmacy's cart shape doesn't need to match grocery's tab shape.
  const holdBillsEnabled = !!(settings as any)?.ops_hold_bills_enabled;
  const [heldOpen, setHeldOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const { data: heldBills = [], refetch: refetchHeld } = useQuery({
    queryKey: ["held_bills", "pharmacy_pos"],
    enabled: holdBillsEnabled,
    queryFn: () =>
      offlineFirst(
        async () => {
          const { data, error } = await supabase
            .from("held_bills")
            .select("id,label,total,item_count,created_at,customer_id,payload,customers(name)")
            .eq("status", "held")
            .order("created_at", { ascending: false });
          if (error) throw error;
          return (data as any[]) ?? [];
        },
        async () =>
          (await offlineDb()
            .held_bills.where("status")
            .equals("held")
            .reverse()
            .sortBy("created_at")) as any[],
        async (rows) => {
          try {
            await offlineDb().held_bills.bulkPut(
              (rows as any[]).map((r) => ({ ...r, status: "held" })),
            );
          } catch {}
        },
      ),
    staleTime: 30_000,
  });

  const holdCurrent = async () => {
    if (!cart.length) return toast.error(t('pharmacy_pos.toast_cart_empty', 'Cart is empty'));
    if (!holdBillsEnabled) return toast.error(t('pharmacy_pos.toast_hold_disabled', 'Hold bills is disabled in Settings'));
    setHolding(true);
    try {
      const label = t('pharmacy_pos.held_bill_label', 'Rx {{time}}', {
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      });
      const payload = {
        items: cart,
        customer_id: customerId,
        discount,
        paid,
        prescription_ref: prescriptionRef,
        label,
      };
      const args = {
        _customer: customerId as any,
        _item_count: cart.length,
        _label: label,
        _payload: payload as any,
        _total: total,
      };
      if (isOfflineNow()) {
        const localId = crypto.randomUUID();
        await offlineDb().held_bills.put({
          id: localId,
          label,
          total,
          item_count: cart.length,
          customer_id: customerId,
          payload,
          status: "held",
          created_at: new Date().toISOString(),
          _offline_pending: true,
        });
        await enqueueWrite({ op: "rpc", table: "hold_bill", payload: args });
        toast.success(t('pharmacy_pos.toast_bill_held_offline', 'Bill held offline'));
      } else {
        const { error } = await supabase.rpc("hold_bill", args);
        if (error) throw error;
        toast.success(t('pharmacy_pos.toast_bill_held', 'Bill held'));
      }
      clearCart();
      setDiscount(0);
      setPaid("");
      setCustomerId(null);
      setPrescriptionRef("");
      refetchHeld();
    } catch (err: any) {
      toast.error(err.message ?? t('pharmacy_pos.toast_hold_failed', 'Could not hold bill'));
    } finally {
      setHolding(false);
    }
  };

  const resumeHeld = async (id: string) => {
    if (cart.length && !confirm(t('pharmacy_pos.confirm_replace_cart', 'This will replace the current cart. Continue?'))) return;
    let payload: any = null;
    if (isOfflineNow()) {
      const local = await offlineDb().held_bills.get(id);
      if (!local) return toast.error(t('pharmacy_pos.toast_held_bill_offline_unavailable', 'Held bill not available offline'));
      payload = local.payload;
      await offlineDb().held_bills.put({ ...local, status: "resumed" });
      await enqueueWrite({ op: "rpc", table: "resume_bill", payload: { _id: id } });
    } else {
      const { data, error } = await supabase.rpc("resume_bill", { _id: id });
      if (error) return toast.error(error.message);
      payload = data;
    }
    if (payload && Array.isArray(payload.items)) {
      setCart(payload.items as Line[]);
      setCustomerId(payload.customer_id ?? null);
      setDiscount(Number(payload.discount ?? 0));
      setPaid(payload.paid === "" || payload.paid == null ? "" : Number(payload.paid));
      setPrescriptionRef(payload.prescription_ref ?? "");
    }
    setHeldOpen(false);
    refetchHeld();
    toast.success(t('pharmacy_pos.toast_bill_resumed', 'Bill resumed'));
  };

  const discardHeld = async (id: string) => {
    if (!confirm(t('pharmacy_pos.confirm_discard_held', 'Discard this held bill?'))) return;
    if (isOfflineNow()) {
      await offlineDb().held_bills.delete(id);
      await enqueueWrite({ op: "rpc", table: "discard_held_bill", payload: { _id: id, _reason: null } });
    } else {
      const { error } = await (supabase.rpc as any)("discard_held_bill", { _id: id, _reason: null });
      if (error) return toast.error(error.message);
    }
    refetchHeld();
    toast.success(t('pharmacy_pos.toast_discarded', 'Discarded'));
  };

  const addToCart = (p: ProductRow) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.product_id === p.id);
      if (existing) {
        return prev.map((l) => (l.product_id === p.id ? { ...l, qty: l.qty + 1 } : l));
      }
      const line: Line = {
        product_id: p.id, name: p.name, qty: 1,
        price: Number(p.sell_price ?? 0), cost: Number(p.cost_price ?? 0),
        tax_rate: Number(p.tax_rate ?? 0), track_batches: !!p.track_batches,
        generic_name: p.pharmacy?.generic_name ?? null,
        prescription_required: !!p.pharmacy?.prescription_required,
        drug_schedule: p.pharmacy?.drug_schedule?.trim() || null,
        pack_size: p.pharmacy?.pack_size?.trim() || null,
        units_per_pack: Number(p.pharmacy?.units_per_pack ?? 0),
        unit_mode: "base",
      };
      return [...prev, line];
    });
    setSearch("");
    setResults([]);
    searchInputRef.current?.focus();
  };

  /** qty is always stored in base units. When the line is in "pack" display
   *  mode, the input shows/accepts pack counts and this converts both ways. */
  const setQty = (productId: string, displayQty: number) => {
    setCart((prev) => prev.map((l) => {
      if (l.product_id !== productId) return l;
      const baseQty = l.unit_mode === "pack" && l.units_per_pack > 0 ? displayQty * l.units_per_pack : displayQty;
      return { ...l, qty: Math.max(0, baseQty) };
    }));
  };
  const setUnitMode = (productId: string, mode: "base" | "pack") => {
    setCart((prev) => prev.map((l) => (l.product_id === productId ? { ...l, unit_mode: mode } : l)));
  };
  const removeLine = (productId: string) => setCart((prev) => prev.filter((l) => l.product_id !== productId));

  const subtotal = useMemo(() => cart.reduce((s, l) => s + l.qty * l.price, 0), [cart]);
  const taxAmt = useMemo(() => cart.reduce((s, l) => s + (l.qty * l.price * (l.tax_rate || 0)) / 100, 0), [cart]);
  const total = useMemo(() => Math.max(0, subtotal - discount + taxAmt), [subtotal, discount, taxAmt]);
  const hasScheduledItem = cart.some((l) => l.prescription_required || !!l.drug_schedule);

  const checkout = async () => {
    if (cart.length === 0) return toast.error(t('pharmacy_pos.toast_cart_empty', 'Cart is empty'));
    if (cart.some((l) => l.qty <= 0)) return toast.error(t('pharmacy_pos.toast_qty_required', 'Every line needs a quantity greater than 0'));
    const paidAmount = paid === "" ? total : Number(paid);
    if (paidAmount < total && !customerId) {
      return toast.error(t('pharmacy_pos.toast_select_customer_for_credit', 'Select a customer to sell on credit — walk-in sales must be paid in full'));
    }
    setCheckingOut(true);
    try {
      const payload: CompleteSalePayload = {
        customer_id: customerId,
        expense_person_id: null,
        payment_method: "cash",
        tax: +taxAmt.toFixed(2),
        discount: +discount.toFixed(2),
        paid: +paidAmount.toFixed(2),
        note: "",
        prescription_ref: prescriptionRef.trim() || null,
        items: cart.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, price: l.price, cost: l.cost })),
      };
      const { sale, offline } = await completeSaleOfflineAware(payload, { tendered: paidAmount });
      toast.success(offline ? t('pharmacy_pos.toast_saved_offline', 'Sale saved offline — will sync automatically') : t('pharmacy_pos.toast_sale_completed', 'Sale completed'));
      setLastSale(sale);
      clearCart();
      setDiscount(0);
      setPaid("");
      setCustomerId(null);
      setPrescriptionRef("");
      if (sale && settings) {
        printInvoiceDirect(sale as any, settings as any, "sale");
      }
    } catch (e: any) {
      toast.error(e?.message ?? t('pharmacy_pos.toast_checkout_failed', 'Could not complete sale'));
    } finally {
      setCheckingOut(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      <ShiftBanner />
      {(expiryAlertQ.data ?? 0) > 0 && (
        <div className="no-print flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-3 py-1.5 text-xs">
          <AlertTriangle className="h-3.5 w-3.5" />
          {t('pharmacy_pos.expiry_alert', { count: expiryAlertQ.data ?? 0 })}
        </div>
      )}
      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-3 p-3">
        {/* Search + results */}
        <div className="flex flex-col min-h-0 gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('pharmacy_pos.search_placeholder', 'Search medicine, generic/salt name, SKU or scan barcode…')}
              className="pl-9 h-11 text-base"
            />
            {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <Card className="flex-1 min-h-0 overflow-y-auto p-0 divide-y">
            {results.length === 0 && search.trim() && !searching && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                {t('pharmacy_pos.no_matches', 'No medicines match "{{search}}".', { search })}
              </div>
            )}
            {results.length === 0 && !search.trim() && (
              <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center gap-2">
                <Pill className="h-8 w-8 opacity-30" />
                {t('pharmacy_pos.search_hint', 'Start typing a medicine or generic/salt name to search.')}
              </div>
            )}
            {results.map((p) => (
              <button
                key={p.id}
                onClick={() => addToCart(p)}
                className="w-full text-left px-4 py-2.5 hover:bg-accent/40 flex items-center justify-between gap-3 transition"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium truncate">{p.name}</span>
                    {p.pharmacy?.prescription_required && (
                      <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">{t('pharmacy_pos.badge_rx', 'Rx')}</Badge>
                    )}
                    {p.pharmacy?.drug_schedule && (
                      <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600" title={t('pharmacy_pos.drug_schedule_title', 'Controlled/scheduled drug')}>
                        {p.pharmacy.drug_schedule}
                      </Badge>
                    )}
                    {p.track_batches && (
                      <Badge variant="outline" className="text-[10px]">{t('pharmacy_pos.badge_fefo', 'FEFO')}</Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {[p.pharmacy?.generic_name, p.pharmacy?.strength, p.pharmacy?.dosage_form].filter(Boolean).join(" · ") ||
                      (p.sku ? t('pharmacy_pos.sku_prefix', 'SKU {{sku}}', { sku: p.sku }) : p.barcode ?? "")}
                    {" · "}{t('pharmacy_pos.stock_inline', 'stock {{qty}} {{unit}}', { qty: fmtQty(p.stock), unit: p.unit ?? "" })}
                    {!!p.pharmacy?.units_per_pack && !!p.pharmacy?.pack_size && (
                      <> {" · "}{t('pharmacy_pos.pack_hint', '1 {{pack}} = {{count}} {{unit}}', { pack: p.pharmacy.pack_size, count: p.pharmacy.units_per_pack, unit: p.unit ?? "" })}</>
                    )}
                  </div>
                </div>
                <div className="text-right shrink-0 font-semibold">{fmtMoney(p.sell_price, sym)}</div>
              </button>
            ))}
          </Card>
        </div>

        {/* Cart */}
        <div className="flex flex-col min-h-0 gap-2">
          <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="p-3 border-b flex items-center gap-2 font-medium">
              <ShoppingCart className="h-4 w-4" /> {t('pharmacy_pos.cart_heading', 'Cart')}
              {hasScheduledItem && (
                <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">
                  {t('pharmacy_pos.badge_contains_rx', 'Contains Rx item')}
                </Badge>
              )}
              {holdBillsEnabled && (
                <Button
                  type="button" variant="ghost" size="sm"
                  className="ml-auto h-7 px-2 text-xs font-normal"
                  onClick={() => setHeldOpen(true)}
                >
                  <ListOrdered className="h-3.5 w-3.5 mr-1" />
                  {t('pharmacy_pos.held_bills_button', 'Held')}
                  {heldBills.length > 0 && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">{heldBills.length}</Badge>}
                </Button>
              )}
            </div>
            <div className="px-3 pt-2">
              <CustomerPicker customers={customers} value={customerId} onSelect={setCustomerId} sym={sym} t={t} />
            </div>
            {hasScheduledItem && (
              <div className="px-3 pt-2">
                <Label className="text-xs text-muted-foreground">{t('pharmacy_pos.prescription_ref_label', 'Prescription # / note (optional)')}</Label>
                <Input
                  value={prescriptionRef}
                  onChange={(e) => setPrescriptionRef(e.target.value)}
                  placeholder={t('pharmacy_pos.prescription_ref_placeholder', 'e.g. Dr. Ahmed, slip #45')}
                  className="h-8 text-sm mt-1"
                />
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto divide-y">
              {cart.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  {t('pharmacy_pos.cart_empty', 'Cart is empty — search and select a medicine.')}
                </div>
              )}
              {cart.map((l) => {
                const hasPack = l.units_per_pack > 0 && !!l.pack_size;
                const displayQty = l.unit_mode === "pack" && hasPack ? l.qty / l.units_per_pack : l.qty;
                return (
                <div key={l.product_id} className="px-3 py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{l.name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {l.generic_name ?? ""}
                      {l.prescription_required && <span className="text-destructive"> · {t('pharmacy_pos.badge_rx', 'Rx')}</span>}
                      {l.drug_schedule && <span className="text-amber-600"> · {l.drug_schedule}</span>}
                    </div>
                    {hasPack && (
                      <div className="flex gap-1 mt-1">
                        <button
                          type="button"
                          onClick={() => setUnitMode(l.product_id, "base")}
                          className={cn("text-[10px] px-1.5 py-0.5 rounded border", l.unit_mode === "base" ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")}
                        >
                          {t('pharmacy_pos.unit_mode_base', 'per unit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setUnitMode(l.product_id, "pack")}
                          className={cn("text-[10px] px-1.5 py-0.5 rounded border", l.unit_mode === "pack" ? "border-primary bg-primary/10 text-primary" : "border-input text-muted-foreground")}
                        >
                          {t('pharmacy_pos.unit_mode_pack', 'per {{pack}}', { pack: l.pack_size })}
                        </button>
                      </div>
                    )}
                  </div>
                  <Input
                    type="number" step="1" value={displayQty}
                    onChange={(e) => setQty(l.product_id, Number(e.target.value))}
                    className="h-8 w-16 text-right text-sm"
                  />
                  <div className="w-20 text-right text-sm font-medium">{fmtMoney(l.qty * l.price, sym)}</div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeLine(l.product_id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                );
              })}
            </div>
            <div className="border-t p-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('pharmacy_pos.subtotal_label', 'Subtotal')}</span><span>{fmtMoney(subtotal, sym)}</span></div>
              <div className="flex justify-between items-center">
                <Label className="text-muted-foreground">{t('common.discount', 'Discount')}</Label>
                <Input type="number" step="0.01" value={discount || ""} onChange={(e) => setDiscount(Number(e.target.value))} className="h-7 w-24 text-right" placeholder="0" />
              </div>
              {taxAmt > 0 && <div className="flex justify-between"><span className="text-muted-foreground">{t('purchase_returns.tax', 'Tax')}</span><span>{fmtMoney(taxAmt, sym)}</span></div>}
              <div className="flex justify-between font-semibold text-base"><span>{t('pharmacy_pos.total_label', 'Total')}</span><span>{fmtMoney(total, sym)}</span></div>
              <div className="flex justify-between items-center">
                <Label className="text-muted-foreground">{t('pharmacy_pos.paid_cash_label', 'Paid (cash)')}</Label>
                <Input type="number" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value === "" ? "" : Number(e.target.value))} className="h-7 w-24 text-right" placeholder={String(total)} />
              </div>
              <div className="flex gap-2">
                {holdBillsEnabled && (
                  <Button
                    variant="outline" className="h-10 px-3"
                    disabled={holding || cart.length === 0}
                    onClick={holdCurrent}
                    title={t('pharmacy_pos.hold_button_title', 'Hold this bill and start a new one — resume it later')}
                  >
                    {holding ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                  </Button>
                )}
                <Button className="flex-1 h-10" disabled={checkingOut || cart.length === 0} onClick={checkout}>
                  {checkingOut ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ShoppingCart className="h-4 w-4 mr-2" />}
                  {t('pharmacy_pos.checkout_button', 'Checkout')}
                </Button>
              </div>
              {lastSale && (
                <Button variant="outline" className="w-full h-9" onClick={() => settings && printInvoiceDirect(lastSale, settings as any, "sale")}>
                  <Printer className="h-4 w-4 mr-2" /> {t('pharmacy_pos.reprint_button', 'Reprint last receipt')}
                </Button>
              )}
            </div>
          </Card>
        </div>
      </div>

      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pharmacy_pos.held_bills_title', 'Held bills')}</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border max-h-[60vh] overflow-auto divide-y">
            {heldBills.length === 0 && (
              <div className="text-center py-6 text-sm text-muted-foreground">
                {t('pharmacy_pos.no_held_bills', 'No held bills')}
              </div>
            )}
            {heldBills.map((b: any) => (
              <div key={b.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{b.label || t('pharmacy_pos.untitled', 'Untitled')}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    {b.customers?.name ?? t('pharmacy_pos.walk_in_customer', 'Walk-in customer')} · {t('pharmacy_pos.items_count', '{{count}} items', { count: b.item_count ?? 0 })} · {fmtMoney(b.total, sym)}
                  </div>
                </div>
                <Button size="sm" variant="outline" className="h-7" onClick={() => resumeHeld(b.id)}>
                  {t('pharmacy_pos.resume_button', 'Resume')}
                </Button>
                <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => discardHeld(b.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
