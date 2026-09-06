import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, memo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Eye, Printer, Undo2, Search, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { roundToTillixQty } from "@/lib/quantity-rounding";
import { Receipt, printReceipt } from "@/components/receipt";
import { completePurchaseReturnOfflineAware } from "@/lib/offline/purchase-returns";
import { fetchAll } from "@/lib/supabase-page";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/purchase-returns")({ component: Page });

type Line = { 
  product_id: string | null; 
  name: string; 
  qty: number; 
  cost: number;
  barcode?: string | null;
  sku?: string | null;
};

type Draft = {
  open: boolean;
  purchaseId: string;
  supplier: string;
  lines: Line[];
  tax: number;
  refund: number;
  method: string;
  note: string;
  paySource?: string;
};

const emptyDraft: Draft = {
  open: false,
  purchaseId: "none",
  supplier: "none",
  lines: [],
  tax: 0,
  refund: 0,
  method: "cash",
  note: "",
};

function Page() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [draft, setDraft, clearDraft] = usePersistentState<Draft>("purchase-return-entry", emptyDraft);
  const { open, purchaseId, supplier, lines, tax, refund, method, note } = draft;

  const [viewing, setViewing] = useState<any>(null);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryActive, setEntryActive] = useState(false);
  const [entryIndex, setEntryIndex] = useState(0);
  const [purchaseSearch, setPurchaseSearch] = useState("");
  const [processing, setProcessing] = useState(false);
  
  const searchRef = useRef<HTMLInputElement>(null);
  const entryMatchesRef = useRef<HTMLDivElement>(null);

  const setOpen = (v: boolean) => {
    if (v) {
      window.history.pushState({ modal: true }, "");
    }
    setDraft((d) => ({ ...d, open: v }));
  };

  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      if (open) {
        setOpen(false);
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [open]);
  const setPurchaseId = (v: string) => setDraft((d) => ({ ...d, purchaseId: v }));
  const setSupplier = (v: string) => setDraft((d) => ({ ...d, supplier: v }));
  const setLines = (updater: Line[] | ((l: Line[]) => Line[])) =>
    setDraft((d) => ({
      ...d,
      lines: typeof updater === "function" ? updater(d.lines) : updater,
    }));
  const setTax = (v: number) => setDraft((d) => ({ ...d, tax: v }));
  const setRefund = (v: number) => setDraft((d) => ({ ...d, refund: v }));
  const setMethod = (v: string) => setDraft((d) => ({ ...d, method: v }));
  const setNote = (v: string) => setDraft((d) => ({ ...d, note: v }));

  const { data: returns = [] } = useQuery({
    queryKey: ["purchase-returns"],
    queryFn: async () =>
      await fetchAll<any>((from, to) => supabase.from("purchase_returns").select("*, suppliers(name), purchase_return_items(*)").order("created_at", { ascending: false }).range(from, to)),
  });

  const [debouncedPurchaseSearch, setDebouncedPurchaseSearch] = useState(purchaseSearch);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedPurchaseSearch(purchaseSearch), 300);
    return () => clearTimeout(timer);
  }, [purchaseSearch]);

  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases-for-return", debouncedPurchaseSearch],
    queryFn: async () => {
      let q = supabase.from("purchases").select("id,invoice_no,supplier_id,total,created_at,purchase_items(*)").order("created_at", { ascending: false }).limit(50);
      if (debouncedPurchaseSearch) {
        q = q.ilike("invoice_no", `%${debouncedPurchaseSearch}%`);
      }
      const { data } = await q;
      return data ?? [];
    },
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
  });

  const { data: cashAccounts = [] } = useQuery({
    queryKey: ["cash-accounts", "purchase-return-pay"],
    queryFn: async () =>
      (await supabase.from("cash_accounts").select("id,name,type,is_active")
        .eq("is_active", true).order("sort_order").order("name")).data ?? [],
  });

  const [debouncedEntrySearch, setDebouncedEntrySearch] = useState(entrySearch);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedEntrySearch(entrySearch), 300);
    return () => clearTimeout(timer);
  }, [entrySearch]);

  const { data: searchResult } = useQuery({
    queryKey: ["products", "return-search", debouncedEntrySearch.trim()],
    enabled: debouncedEntrySearch.trim().length > 1,
    staleTime: 30_000,
    queryFn: async () => {
      const term = debouncedEntrySearch.trim();
      const { data } = await supabase.from("products")
        .select("id,name,sku,barcode,cost_price,sell_price,stock")
        .or(`name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%`)
        .limit(20);
      return data ?? [];
    },
  });
  const searchMatches = searchResult ?? [];

  useEffect(() => {
    if (purchaseId === "none") return;
    const p = purchases.find((x: any) => x.id === purchaseId);
    if (!p) return;
    setSupplier(p.supplier_id ?? "none");
    setLines(
      (p.purchase_items ?? []).map((it: any) => ({
        product_id: it.product_id,
        name: it.name,
        qty: Number(it.qty),
        cost: Number(it.cost),
      })),
    );
    // Auto-set refund amount to the total of the original purchase
    setRefund(Number(p.total || 0));
  }, [purchaseId, purchases]);

  const subtotal = useMemo(() => lines.reduce((s, l) => s + l.qty * l.cost, 0), [lines]);
  const total = subtotal + Number(tax || 0);

  const addLine = (p?: any) => {
    if (p) {
      setLines((ls) => [...ls, { product_id: p.id, name: p.name, qty: 1, cost: Number(p.cost_price || 0), barcode: p.barcode, sku: p.sku }]);
      setEntrySearch("");
      setEntryActive(false);
    } else {
      setLines((ls) => [...ls, { product_id: null, name: "", qty: 1, cost: 0 }]);
    }
  };

  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) =>
      ls.map((l, idx) =>
        idx === i
          ? {
              ...l,
              ...patch,
              qty: "qty" in patch ? roundToTillixQty(Number(patch.qty)) : l.qty,
            }
          : l
      )
    );

  const reset = () => {
    clearDraft();
    setEntrySearch("");
    setEntryActive(false);
    setProcessing(false);
  };

  const submit = async () => {
    if (processing) return;
    const items = lines.filter((l) => l.name && l.qty > 0);
    if (!items.length) return toast.error(t('purchase_returns.add_at_least_one_item', 'Add at least one item'));
    if (refund > total + 0.01) return toast.error(t('purchase_returns.refund_exceeds_total', 'Refund cannot exceed total'));
    
    setProcessing(true);
    let offline = false;
    let localRet: any = null;
    try {
      const res = await completePurchaseReturnOfflineAware(
        {
          purchase_id: purchaseId === "none" ? null : purchaseId,
          supplier_id: supplier === "none" ? null : supplier,
          tax,
          refund_amount: refund,
          refund_method: method === "account" ? (draft.paySource ?? "") : (method === "credit" ? "credit" : method),
          note,
          items: items.map((l) => ({ product_id: l.product_id, name: l.name, qty: l.qty, cost: l.cost })),
        },
        { original_invoice_no: purchaseId !== "none" ? (purchases.find((p: any) => p.id === purchaseId)?.invoice_no ?? null) : null },
      );
      offline = res.offline;
      localRet = res.ret;
    } catch (e: any) {
      toast.error(e.message || t('purchase_returns.failed_to_process', 'Failed to process return'));
      setProcessing(false);
      return;
    }
    toast.success(
      offline
        ? t('purchase_returns.return_saved_offline', 'Return saved offline — will sync automatically')
        : t('purchase_returns.return_recorded', 'Purchase return recorded, stock removed'),
    );
    reset();
    // Offline the cloud row doesn't exist yet — open the local record so the
    // shop can still print the return receipt.
    if (offline && localRet) setViewing(localRet);
    qc.invalidateQueries({ queryKey: ["purchase-returns"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    setProcessing(false);
  };

  const handleEntryKey = (e: React.KeyboardEvent) => {
    if (!entryActive || !searchMatches.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setEntryIndex((i) => (i + 1) % searchMatches.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setEntryIndex((i) => (i - 1 + searchMatches.length) % searchMatches.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      addLine(searchMatches[entryIndex]);
    } else if (e.key === "Escape") {
      setEntryActive(false);
    }
  };

  // Stable reference: Receipt's print-sizing effect depends on `invoice`, so
  // rebuilding this object (plus a fresh .map()) inline on every render (as
  // it was before) reran that effect on every unrelated re-render of this
  // page while the dialog was open, instead of only when the viewed return
  // actually changes.
  const viewingInvoice = useMemo(
    () =>
      viewing
        ? {
            ...viewing,
            sale_items: (viewing.purchase_return_items ?? []).map((it: any) => ({
              ...it,
              price: it.cost,
            })),
          }
        : null,
    [viewing],
  );

  if (open) {
    return (
      <div
        className="fixed inset-0 z-50 bg-background flex flex-col animate-in fade-in zoom-in duration-200"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="h-14 border-b flex items-center justify-between px-6 bg-muted/40 shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="font-semibold text-lg">{t('purchase_returns.new_return_title', 'New Purchase Return')}</h2>
            <Badge variant="outline" className="bg-background">{t('purchase_returns.draft_badge', 'Draft')}</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>{t('purchase_returns.close_draft', 'Close Draft')}</Button>
            <Button variant="outline" size="sm" onClick={reset} className="text-destructive border-destructive/20 hover:bg-destructive/10">{t('purchase_returns.clear_all', 'Clear All')}</Button>
          </div>
        </header>

        <main className="flex-1 flex flex-col md:flex-row min-h-0 overflow-y-auto md:overflow-hidden">
          {/* Left: Return Cart */}
          <div className="flex-1 flex flex-col bg-background border-r min-h-[50vh] md:min-h-0">
            <div className="p-4 border-b flex items-center gap-4">
              <div className="relative flex-1 max-w-xl">
                <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  ref={searchRef}
                  placeholder={t('purchase_returns.search_add_placeholder', 'Scan barcode or type product name to add...')}
                  className="pl-10 h-10"
                  value={entrySearch}
                  onChange={(e) => {
                    setEntrySearch(e.target.value);
                    setEntryActive(true);
                    setEntryIndex(0);
                  }}
                  onKeyDown={handleEntryKey}
                  onFocus={() => setEntryActive(true)}
                />
                
                {entryActive && searchMatches.length > 0 && (
                  <div 
                    ref={entryMatchesRef}
                    className="absolute top-full left-0 right-0 z-[100] mt-1 bg-popover border rounded-md shadow-xl overflow-hidden max-h-[400px] overflow-y-auto"
                  >
                    {searchMatches.map((m: any, i) => (
                      <div
                        key={m.id}
                        className={cn(
                          "px-4 py-2.5 flex items-center justify-between cursor-pointer border-b last:border-0",
                          i === entryIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                        )}
                        onClick={() => addLine(m)}
                      >
                        <div className="flex flex-col">
                          <span className="font-medium">{m.name}</span>
                          <span className="text-xs text-muted-foreground">{m.sku || m.barcode || t('purchase_returns.no_code', 'No Code')}</span>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm">{fmtMoney(m.cost_price, sym)}</div>
                          <div className="text-[10px] text-muted-foreground">{t('purchase_returns.stock_label', 'Stock: {{qty}}', { qty: m.stock })}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="secondary" onClick={() => addLine()}>
                <Plus className="h-4 w-4 mr-2" /> {t('purchase_returns.add_adhoc_item', 'Add Ad-hoc Item')}
              </Button>
            </div>

            <div className="flex-1 overflow-auto">
              <Table>
                <TableHeader className="bg-muted/30 sticky top-0 z-10">
                  <TableRow>
                    <TableHead className="w-12 text-center">{t('purchase_returns.th_num', '#')}</TableHead>
                    <TableHead>{t('purchase_returns.th_item_details', 'Item Details')}</TableHead>
                    <TableHead className="w-32 text-center">{t('purchase_returns.th_qty', 'Qty')}</TableHead>
                    <TableHead className="w-32 text-right">{t('purchase_returns.th_cost_sym', 'Cost ({{sym}})', { sym })}</TableHead>
                    <TableHead className="w-32 text-right">{t('purchase_returns.th_total_sym', 'Total ({{sym}})', { sym })}</TableHead>
                    <TableHead className="w-12"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((l, i) => (
                    <MemoizedRow
                      key={i}
                      index={i}
                      line={l}
                      onUpdate={(patch) => setLine(i, patch)}
                      onRemove={() => setLines(lines.filter((_, idx) => idx !== i))}
                      sym={sym}
                    />
                  ))}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="h-64 text-center">
                        <div className="flex flex-col items-center justify-center text-muted-foreground">
                          <Undo2 className="h-12 w-12 mb-2 opacity-20" />
                          <p>{t('purchase_returns.cart_empty', 'Return cart is empty.')}</p>
                          <p className="text-sm">{t('purchase_returns.cart_empty_sub', 'Search for products or pick a purchase to start.')}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>

            <footer className="h-12 border-t px-6 flex items-center justify-between text-sm bg-muted/20 shrink-0">
              <div className="flex items-center gap-6">
                <span>{t('purchase_returns.items_label', 'Items:')} <span className="font-bold">{lines.length}</span></span>
                <span>{t('purchase_returns.total_qty_label', 'Total Qty:')} <span className="font-bold">{lines.reduce((a, b) => a + b.qty, 0)}</span></span>
              </div>
              <div className="text-muted-foreground italic">
                {t('purchase_returns.tip_prefix', 'Tip: Press')} <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100">Esc</kbd> {t('purchase_returns.tip_suffix', 'to close picker.')}
              </div>
            </footer>
          </div>

          {/* Right: Search & Summary (full-width below the cart on mobile) */}
          <div className="w-full md:w-[350px] border-t md:border-t-0 md:border-l flex flex-col shrink-0 bg-muted/10">
            <div className="p-4 space-y-4 border-b bg-background">
              <div className="space-y-2">
                <Label>{t('purchase_returns.original_purchase', 'Original Purchase')}</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder={t('purchase_returns.search_invoice_placeholder', 'Search invoice #...')}
                    className="pl-8"
                    value={purchaseSearch}
                    onChange={(e) => setPurchaseSearch(e.target.value)}
                  />
                </div>
                <Select value={purchaseId} onValueChange={setPurchaseId}>
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder={t('purchase_returns.pick_purchase_placeholder', 'Pick a purchase')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[60vh] overflow-y-auto">
                    <SelectItem value="none">{t('purchase_returns.manual_entry', '— Manual Entry —')}</SelectItem>
                    {purchases.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.invoice_no} ({fmtMoney(p.total, sym)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>{t('purchase_returns.th_supplier', 'Supplier')}</Label>
                <Select value={supplier} onValueChange={setSupplier}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('purchase_returns.select_supplier_placeholder', 'Select supplier')} />
                  </SelectTrigger>
                  <SelectContent className="max-h-[60vh] overflow-y-auto">
                    <SelectItem value="none">{t('purchase_returns.walk_in_option', '— Walk-in —')}</SelectItem>
                    {suppliers.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
              <div className="p-4 bg-muted/20 border-b flex items-center justify-between shrink-0">
                <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">{t('purchase_returns.return_summary', 'Return Summary')}</h3>
                <div className="text-xs text-muted-foreground">{t('purchase_returns.items_suffix', '{{count}} items', { count: lines.length })}</div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-3">
                  <Card className="p-3 space-y-3 shadow-none border-dashed">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{t('purchase_returns.subtotal', 'Subtotal')}</span>
                      <span>{fmtMoney(subtotal, sym)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">{t('purchase_returns.tax', 'Tax')}</span>
                      <Input
                        type="number"
                        className="h-8 w-24 text-right"
                        value={tax || ""}
                        onChange={(e) => setTax(Number(e.target.value))}
                      />
                    </div>
                    <div className="pt-2 border-t flex justify-between font-bold text-lg text-primary">
                      <span>{t('sales.th_total', 'Total')}</span>
                      <span>{fmtMoney(total, sym)}</span>
                    </div>
                  </Card>

                  <div className="space-y-2 pt-2">
                    <Label>{t('purchase_returns.refund_received', 'Refund Received')}</Label>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={refund || ""}
                      onChange={(e) => setRefund(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>{t('purchase_returns.refund_method', 'Refund Method')}</Label>
                    <Select value={method} onValueChange={setMethod}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">{t('purchase_returns.method_cash', 'Cash')}</SelectItem>
                        <SelectItem value="transfer">{t('purchase_returns.method_transfer', 'Transfer')}</SelectItem>
                        <SelectItem value="account">{t('purchase_returns.method_account', 'Cash Account')}</SelectItem>
                        <SelectItem value="credit">{t('purchase_returns.method_credit', 'Supplier Credit')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {method === "account" && (
                    <div className="space-y-2">
                      <Label>{t('purchase_returns.account_label', 'Account')}</Label>
                      <Select
                        value={draft.paySource}
                        onValueChange={(v) => setDraft(d => ({ ...d, paySource: v }))}
                      >
                        <SelectTrigger><SelectValue placeholder={t('purchase_returns.select_account_placeholder', 'Select account')} /></SelectTrigger>
                        <SelectContent>
                          {cashAccounts.map((a: any) => (
                            <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label>{t('common.note', 'Note')}</Label>
                    <Input
                      placeholder={t('purchase_returns.reason_placeholder', 'Reason for return...')}
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t bg-background">
              <Button
                className="w-full h-12 text-lg font-bold"
                onClick={submit}
                disabled={processing || lines.length === 0}
              >
                {processing ? t('purchase_returns.processing', 'Processing...') : t('purchase_returns.process_return', 'Process Return')}
                {!processing && <Undo2 className="ml-2 h-5 w-5" />}
              </Button>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('purchase_returns.title', 'Purchase Returns')}</h1>
          <p className="text-muted-foreground">{t('purchase_returns.subtitle', 'Manage and track inventory sent back to suppliers')}</p>
        </div>
        <Button size="lg" onClick={() => setOpen(true)} className="shadow-lg hover:shadow-xl transition-all">
          <Plus className="h-5 w-5 mr-2" />{t('purchase_returns.new_return', 'New Return')}
        </Button>
      </div>

      <Card className="overflow-hidden border-none shadow-md ring-1 ring-border">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="pl-6">{t('purchase_returns.th_return_no', 'Return #')}</TableHead>
              <TableHead>{t('sales.th_date', 'Date')}</TableHead>
              <TableHead>{t('purchase_returns.th_supplier', 'Supplier')}</TableHead>
              <TableHead className="text-right">{t('sales.th_total', 'Total')}</TableHead>
              <TableHead className="text-right">{t('sales.th_refund', 'Refund')}</TableHead>
              <TableHead>{t('sales.th_method', 'Method')}</TableHead>
              <TableHead className="pr-6 text-right">{t('customers.th_actions', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {returns.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-12">
                  {t('purchase_returns.no_returns_yet', 'No purchase returns recorded yet.')}
                </TableCell>
              </TableRow>
            )}
            {returns.map((r: any) => (
              <TableRow key={r.id} className="group hover:bg-muted/30 transition-colors">
                <TableCell className="pl-6 font-mono text-xs font-semibold text-primary">{r.return_no}</TableCell>
                <TableCell className="text-sm">{new Date(r.created_at).toLocaleDateString()} <span className="text-muted-foreground ml-1 text-[10px]">{new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></TableCell>
                <TableCell>{r.suppliers?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right font-bold text-base">{fmtMoney(r.total, sym)}</TableCell>
                <TableCell className="text-right font-medium text-green-600 dark:text-green-400">{fmtMoney(r.refund_amount, sym)}</TableCell>
                <TableCell><Badge variant="outline" className="capitalize bg-background">{String(t(`purchase_returns.method_${r.refund_method}`, r.refund_method))}</Badge></TableCell>
                <TableCell className="pr-6 text-right">
                  <Button variant="ghost" size="icon" onClick={() => setViewing(r)} className="hover:bg-primary/10 hover:text-primary transition-colors">
                    <Eye className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent 
          className="max-w-[400px] p-0 overflow-hidden rounded-xl"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader className="p-6 border-b bg-muted/20">
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-5 w-5 text-primary" />
              {t('sales.return_title', 'Return {{no}}', { no: viewing?.return_no })}
            </DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="p-6 max-h-[70vh] overflow-y-auto bg-background">
              <div className="print-area mx-auto">
                <Receipt
                  kind="purchase-return"
                  invoice={viewingInvoice}
                  settings={settings}
                />
              </div>
            </div>
          )}
          <DialogFooter className="p-4 border-t bg-muted/20 gap-2 no-print flex-row">
            <Button variant="outline" className="flex-1" onClick={() => setViewing(null)}>{t('common.close', 'Close')}</Button>
            <Button className="flex-1" onClick={() => printReceipt()}>
              <Printer className="h-4 w-4 mr-2" />{t('purchase_returns.print_receipt', 'Print Receipt')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const MemoizedRow = memo(function Row({ 
  index, 
  line, 
  onUpdate, 
  onRemove, 
  sym 
}: { 
  index: number; 
  line: Line; 
  onUpdate: (p: Partial<Line>) => void; 
  onRemove: () => void;
  sym: string;
}) {
  const { t } = useTranslation();
  return (
    <TableRow className="group border-b">
      <TableCell className="text-center text-muted-foreground font-mono text-xs">{index + 1}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          {line.product_id ? (
            <>
              <span className="font-semibold text-sm leading-none">{line.name}</span>
              <span className="text-[10px] text-muted-foreground font-mono">{line.barcode || line.sku || t('purchase_returns.custom_item', 'Custom Item')}</span>
            </>
          ) : (
            <Input
              value={line.name}
              onChange={(e) => onUpdate({ name: e.target.value })}
              className="h-8 text-sm"
              placeholder={t('purchase_returns.item_name_placeholder', 'Item name...')}
              autoFocus
            />
          )}
        </div>
      </TableCell>
      <TableCell className="text-center">
        <Input 
          type="number" 
          step="0.001" 
          value={line.qty || ""} 
          onChange={(e) => onUpdate({ qty: Number(e.target.value) })} 
          className="h-8 w-24 mx-auto text-center font-bold" 
          onFocus={(e) => e.target.select()}
        />
      </TableCell>
      <TableCell className="text-right">
        <Input 
          type="number" 
          step="0.01" 
          value={line.cost || ""} 
          onChange={(e) => onUpdate({ cost: Number(e.target.value) })} 
          className="h-8 w-24 ml-auto text-right font-mono text-sm" 
          onFocus={(e) => e.target.select()}
        />
      </TableCell>
      <TableCell className="text-right font-mono font-bold text-sm">
        {fmtMoney(line.qty * line.cost, sym)}
      </TableCell>
      <TableCell className="pr-4">
        <Button 
          variant="ghost" 
          size="icon" 
          onClick={onRemove}
          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
});
