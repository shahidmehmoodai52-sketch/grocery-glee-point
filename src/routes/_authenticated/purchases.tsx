import { createFileRoute } from "@tanstack/react-router";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Search, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { offlineFirst, cacheSuppliers, cachePurchases } from "@/lib/offline/pos";

import { db } from "@/lib/offline/db";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/purchases")({ component: Page });

type Line = { product_id: string | null; name: string; qty: number; cost: number; discount?: number; old_stock?: number; old_cost?: number; barcode?: string | null; item_code?: string | null; _total?: number | null };

type Draft = {
  open: boolean;
  supplier: string;
  lines: Line[];
  tax: number;
  taxMode: "amt" | "pct";
  discount: number;
  discountMode: "amt" | "pct";
  paid: number;
  note: string;
  date: string;
  paySource?: string;
};
const emptyDraft: Draft = { open: false, supplier: "none", lines: [], tax: 0, taxMode: "amt", discount: 0, discountMode: "amt", paid: 0, note: "", date: new Date().toISOString().slice(0,10), paySource: "" };

// Presets offered when the shop hasn't created these heads in Cash Flow yet.
// Selecting one creates the matching cash account so purchase payments always
// land on a real account (and show up in Cash Flow / reports).
const PAY_SOURCE_PRESETS = ["Cash in hand", "Cheque", "Bank", "Online"];
function guessAccountType(name: string) {
  const s = (name || "").toLowerCase();
  if (s.includes("bank") || s.includes("cheque") || s.includes("check") || s.includes("online")) return "bank";
  if (s.includes("card")) return "card";
  if (s.includes("easy") || s.includes("jazz") || s.includes("wallet")) return "mobile_wallet";
  return "cash";
}



const normalizeItemCode = (value: string | null | undefined) => {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!/^\d{1,4}$/.test(raw)) return raw;
  return raw.replace(/^0+/, "") || "0";
};

const PICKER_COLUMNS = "id,name,sku,barcode,cost_price,sell_price,stock";

function useDebounced<T>(value: T, ms: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/**
 * Server-side product lookup for the purchase entry box.
 * Runs a handful of narrow indexed queries instead of pulling the whole
 * catalogue into the browser, so 2-4 letters return results immediately.
 */
async function searchPurchaseProducts(term: string): Promise<{ products: PickerProduct[]; barcodes: { product_id: string; barcode: string }[] }> {
  const q = term.trim().replace(/\s+/g, " ");
  if (!q) return { products: [], barcodes: [] };
  const like = `%${q}%`;
  const prefix = `${q}%`;

  const online = typeof navigator === "undefined" || navigator.onLine;
  if (!online) {
    // Offline: fall back to the local Dexie mirror.
    const t = q.toLowerCase();
    const rows = await db().products.toArray();
    const hits = rows
      .filter((p: any) =>
        (p.name ?? "").toLowerCase().includes(t) ||
        (p.sku ?? "").toLowerCase().includes(t) ||
        (p.barcode ?? "").toLowerCase().includes(t))
      .slice(0, 25);
    return { products: hits as PickerProduct[], barcodes: [] };
  }

  const [nameRes, namePrefixRes, skuRes, barcodeRes, extraBcRes] = await Promise.all([
    supabase.from("products").select(PICKER_COLUMNS).ilike("name", like).order("name").limit(25),
    supabase.from("products").select(PICKER_COLUMNS).ilike("name", prefix).order("name").limit(25),
    supabase.from("products").select(PICKER_COLUMNS).ilike("sku", prefix).order("sku").limit(25),
    supabase.from("products").select(PICKER_COLUMNS).ilike("barcode", prefix).order("name").limit(25),
    supabase.from("product_barcodes").select("product_id,barcode").ilike("barcode", prefix).limit(25),
  ]);

  const barcodes = (extraBcRes.data ?? []) as { product_id: string; barcode: string }[];
  const extraIds = barcodes.map((b) => b.product_id);
  const extraRes = extraIds.length
    ? await supabase.from("products").select(PICKER_COLUMNS).in("id", extraIds).limit(25)
    : { data: [] as any[] };

  const merged = new Map<string, PickerProduct>();
  for (const p of [
    ...(namePrefixRes.data ?? []),
    ...(skuRes.data ?? []),
    ...(barcodeRes.data ?? []),
    ...(extraRes.data ?? []),
    ...(nameRes.data ?? []),
  ]) merged.set((p as any).id, p as PickerProduct);

  return { products: [...merged.values()], barcodes };
}



function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const today = new Date().toISOString().slice(0,10);

  const [draft, setDraft, clearDraft] = usePersistentState<Draft>("purchase-entry", emptyDraft);
  const { open, supplier, lines, tax, paid, note, date } = draft;
  const taxMode: "amt" | "pct" = draft.taxMode ?? "amt";
  const billDiscount = Number(draft.discount ?? 0);
  const discountMode: "amt" | "pct" = draft.discountMode ?? "amt";
  const setOpen = (v: boolean) => setDraft((d) => ({ ...d, open: v }));
  const setSupplier = (v: string) => setDraft((d) => ({ ...d, supplier: v }));
  const setDate = (v: string) => setDraft((d) => ({ ...d, date: v }));
  const setLines = (updater: Line[] | ((l: Line[]) => Line[])) =>
    setDraft((d) => ({ ...d, lines: typeof updater === "function" ? (updater as any)(d.lines) : updater }));
  const setTax = (v: number) => setDraft((d) => ({ ...d, tax: v }));
  const setTaxMode = (v: "amt" | "pct") => setDraft((d) => ({ ...d, taxMode: v }));
  const setBillDiscount = (v: number) => setDraft((d) => ({ ...d, discount: v }));
  const setDiscountMode = (v: "amt" | "pct") => setDraft((d) => ({ ...d, discountMode: v }));
  const setPaid = (v: number) => setDraft((d) => ({ ...d, paid: v }));
  const setNote = (v: string) => setDraft((d) => ({ ...d, note: v }));
  const paySource = draft.paySource ?? "";
  const setPaySource = (v: string) => setDraft((d) => ({ ...d, paySource: v }));



  const [search, setSearch] = useState("");
  const [dateFilter, setDateFilter] = useState<"today" | "yesterday" | "week" | "month" | "custom">("today");
  const [filterFrom, setFilterFrom] = useState(today);
  const [filterTo, setFilterTo] = useState(today);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryActive, setEntryActive] = useState(false);
  const [entryIndex, setEntryIndex] = useState(0);
  const [newProdOpen, setNewProdOpen] = useState(false);
  const [newProd, setNewProd] = useState({ name: "", sku: "", barcode: "", unit: "pcs", cost_price: 0, sell_price: 0, stock: 0, supplier_id: "" });
  const [newProdSaving, setNewProdSaving] = useState(false);
  const openNewProduct = (term: string) => {
    const t = term.trim();
    const isCode = /^\d+$/.test(t);
    setNewProd({
      name: isCode ? "" : t,
      sku: isCode && t.length <= 6 ? t : "",
      barcode: isCode && t.length > 4 ? t : (isCode ? "" : ""),
      unit: "pcs",
      cost_price: 0,
      sell_price: 0,
      stock: 0,
      supplier_id: supplier && supplier !== "none" ? supplier : "",
    });
    setNewProdOpen(true);
  };
  const saveNewProduct = async () => {
    if (!newProd.name.trim()) return toast.error("Name required");
    const primary = newProd.barcode.trim() || newProd.sku.trim() || newProd.name.trim();
    setNewProdSaving(true);
    const payload = {
      name: newProd.name.trim(),
      sku: newProd.sku.trim() || null,
      barcode: primary,
      unit: newProd.unit || "pcs",
      cost_price: Number(newProd.cost_price) || 0,
      sell_price: Number(newProd.sell_price) || 0,
      stock: Number(newProd.stock) || 0,
      preferred_supplier_id: newProd.supplier_id || null,
    };
    const { data, error } = await supabase.from("products").insert(payload).select("id,name,sku,barcode,cost_price,stock").single();
    if (!error && data) {
      await supabase.from("product_barcodes").insert({ product_id: data.id, barcode: primary });
    }
    setNewProdSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Product added");
    setNewProdOpen(false);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_barcodes"] });
    addProductLine(data as any);
  };
  const [editRow, setEditRow] = useState<any | null>(null);
  const [editItems, setEditItems] = useState<any[]>([]);
  const [editItemsOriginal, setEditItemsOriginal] = useState<any[]>([]);
  const [editLoading, setEditLoading] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const openEdit = async (p: any) => {
    setEditRow({ ...p, supplier_id: p.supplier_id ?? "none" });
    setEditItems([]);
    setEditItemsOriginal([]);
    setEditLoading(true);
    const { data, error } = await supabase
      .from("purchase_items")
      .select("id,product_id,name,qty,cost,line_total")
      .eq("purchase_id", p.id);
    setEditLoading(false);
    if (error) { toast.error(error.message); return; }
    const rows = (data ?? []).map((r: any) => ({ ...r, qty: Number(r.qty), cost: Number(r.cost) }));
    setEditItems(rows);
    setEditItemsOriginal(rows.map((r) => ({ ...r })));
  };

  const handleDeletePurchase = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error } = await supabase.from("purchases").delete().eq("id", deleteTarget.id);
    setDeleting(false);
    if (error) return toast.error(error.message);
    toast.success("Purchase deleted");
    setDeleteTarget(null);
    qc.invalidateQueries({ queryKey: ["purchases"] });
  };
  const searchRef = useRef<HTMLInputElement>(null);
  const focusCell = (kind: "cost" | "qty", i: number) => {
    setTimeout(() => {
      const el = document.getElementById(`purchase-${kind}-${i}`) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 0);
  };
  const focusSearch = () => setTimeout(() => searchRef.current?.focus(), 0);
  const addProductLine = (product: PickerProduct | null, fallbackName?: string) => {
    let newIndex = 0;
    setLines((ls) => {
      newIndex = ls.length;
      if (product) {
        return [...ls, {
          product_id: product.id,
          name: product.name ?? "",
          qty: 1,
          cost: Number(product.cost_price ?? 0),
          old_stock: Number(product.stock ?? 0),
          old_cost: Number(product.cost_price ?? 0),
          barcode: product.barcode ?? null,
          item_code: product.sku ?? null,
        }];
      }
      return [...ls, { product_id: null, name: fallbackName ?? "", qty: 1, cost: 0 }];
    });
    setEntrySearch("");
    setEntryActive(false);
    setEntryIndex(0);
    focusCell("cost", newIndex);
  };
  const addFromSearch = async () => {
    const term = entrySearch.trim();
    if (!term) return;
    const t = term.toLowerCase();
    const normalizedItemCode = normalizeItemCode(term);
    // Candidates from the debounced server search. When the user (or a barcode
    // scanner) types+Enters faster than the debounce, this list can still be
    // stale, so we fall back to a direct awaited lookup below.
    let prods = products as PickerProduct[];
    const isFourDigitItemCode = /^\d{4}$/.test(term);

    const findExact = (list: PickerProduct[], barcodeRows: { product_id: string; barcode: string }[]) => {
      // Item Code/SKU is different from barcode. In purchases, manual 4-digit codes
      // should resolve by item_code first, then scanner barcodes.
      let hit = list.find((p) => normalizeItemCode(p.sku) === normalizedItemCode);
      if (!hit && isFourDigitItemCode) hit = list.find((p) => (p.sku ?? "").toLowerCase().startsWith(t));
      // 2) exact match on primary barcode
      if (!hit) hit = list.find((p) => (p.barcode ?? "").toLowerCase() === t);
      // 3) exact match on extra barcodes (product_barcodes table)
      if (!hit) {
        const bcRow = barcodeRows.find((b) => (b.barcode ?? "").toLowerCase() === t);
        if (bcRow) hit = list.find((p) => p.id === bcRow.product_id);
      }
      // 4) exact match on name
      if (!hit) hit = list.find((p) => (p.name ?? "").toLowerCase() === t);
      return hit;
    };

    let exact = findExact(prods, extraBarcodes as { product_id: string; barcode: string }[]);

    // Search results for this exact term aren't in yet (debounce race) — resolve
    // synchronously against the server so scanning never drops an item.
    if (!exact && debouncedEntry !== term) {
      const fresh = await searchPurchaseProducts(term);
      prods = fresh.products;
      exact = findExact(fresh.products, fresh.barcodes);
      if (!exact && fresh.products.length) {
        addProductLine(fresh.products[0]);
        return;
      }
    }

    // If the term looks like a code (digits) but has no exact match, prompt to create a new product
    const looksLikeCode = /^\d+$/.test(term);
    if (!exact && looksLikeCode) {
      openNewProduct(term);
      return;
    }
    const match = exact || entryMatches[Math.min(entryIndex, Math.max(entryMatches.length - 1, 0))];
    if (!match) {
      openNewProduct(term);
      return;
    }
    addProductLine(match);
  };




  // Payment heads come from Cash Flow accounts so both screens stay in sync.
  const { data: cashAccounts = [] } = useQuery({
    queryKey: ["cash-accounts", "purchase-pay"],
    staleTime: 30_000,
    queryFn: async () =>
      (await supabase.from("cash_accounts").select("id,name,type,is_active")
        .eq("is_active", true).order("sort_order").order("name")).data ?? [],
  });
  const paySourceOptions = useMemo(() => [
    ...(cashAccounts as any[]).map((a) => ({ id: a.id as string, name: a.name as string, preset: false })),
    ...PAY_SOURCE_PRESETS
      .filter((p) => !(cashAccounts as any[]).some((a) => String(a.name).toLowerCase() === p.toLowerCase()))
      .map((p) => ({ id: `preset:${p}`, name: p, preset: true })),
  ], [cashAccounts]);

  const { data: suppliers = [] } = useQuery({

    queryKey: ["suppliers"],
    staleTime: 60_000,
    queryFn: async () => offlineFirst<any[]>(
      async () => (await supabase.from("suppliers").select("id,name").order("name")).data ?? [],
      async () => (await db().suppliers.orderBy("name").toArray()).map((s: any) => ({ id: s.id, name: s.name })),
      cacheSuppliers,
    ),
  });
  // Server-side product search. Previously this downloaded every product row
  // (49k+ on real tenants) before the first result could render, so typing a
  // few letters showed nothing for minutes. Now we ask Postgres for a small
  // ranked candidate set per keystroke (debounced).
  const debouncedEntry = useDebounced(entrySearch.trim(), 180);
  const { data: searchResult } = useQuery({
    queryKey: ["products", "purchase-search", debouncedEntry],
    enabled: debouncedEntry.length > 0,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    queryFn: () => searchPurchaseProducts(debouncedEntry),
  });
  const products = searchResult?.products ?? [];
  const extraBarcodes = searchResult?.barcodes ?? [];

  const entryMatches = useMemo(() => {
    const term = entrySearch.trim().toLowerCase();
    if (!term) return [] as PickerProduct[];
    const normalizedTermItemCode = normalizeItemCode(term);
    const bcProductIds = new Set(
      (extraBarcodes as { product_id: string; barcode: string }[])
        .filter((b) => (b.barcode ?? "").toLowerCase().includes(term))
        .map((b) => b.product_id)
    );
    // Multi-word name search: "co mi" should match "Coca Cola Mini".
    const tokens = term.split(/\s+/).filter(Boolean);
    return (products as PickerProduct[])
      .map((p) => {
        const sku = (p.sku ?? "").toLowerCase();
        const normalizedSku = normalizeItemCode(p.sku);
        const name = (p.name ?? "").toLowerCase();
        const words = name.split(/\s+/);
        const barcode = (p.barcode ?? "").toLowerCase();
        const extraBarcodeMatch = bcProductIds.has(p.id);
        const allTokensMatch = tokens.length > 1 && tokens.every((t) => name.includes(t));
        let rank = Number.POSITIVE_INFINITY;
        if (normalizedSku === normalizedTermItemCode) rank = 0;
        else if (sku === term) rank = 1;
        else if (sku.startsWith(term)) rank = 2;
        else if (name.startsWith(term)) rank = 3;                       // "chi" → "Chips…"
        else if (words.some((w) => w.startsWith(term))) rank = 4;       // word-prefix match
        else if (sku.includes(term)) rank = 5;
        else if (name.includes(term)) rank = 6;
        else if (allTokensMatch) rank = 7;
        else if (barcode === term) rank = 8;
        else if (barcode.includes(term) || extraBarcodeMatch) rank = 9;
        return { p, rank };
      })
      .filter(({ rank }) => Number.isFinite(rank))
      .sort((a, b) => a.rank - b.rank || (a.p.name ?? "").localeCompare(b.p.name ?? ""))
      .map(({ p }) => p)
      .slice(0, 25);
  }, [entrySearch, products, extraBarcodes]);
  const { data: purchases = [] } = useQuery({
    queryKey: ["purchases"],
    staleTime: 30_000,
    queryFn: async () => offlineFirst<any[]>(
      async () => await fetchAll<any>((from, to) => supabase.from("purchases").select("*, suppliers(name)").order("created_at", { ascending: false }).range(from, to)),
      async () => {
        const rows = await db().purchases.orderBy("created_at").reverse().toArray();
        const supMap = new Map((await db().suppliers.toArray()).map((s: any) => [s.id, s.name]));
        return rows.map((r: any) => ({ ...r, suppliers: r.supplier_id ? { name: supMap.get(r.supplier_id) ?? null } : null }));
      },
      cachePurchases,
    ),
  });

  const formatLocalDate = (value: Date) => {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const getPresetRange = (preset: typeof dateFilter) => {
    const now = new Date();
    const todayKey = formatLocalDate(now);
    if (preset === "yesterday") {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      const key = formatLocalDate(d);
      return { from: key, to: key };
    }
    if (preset === "week") {
      const d = new Date(now);
      const day = d.getDay();
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((day + 6) % 7));
      return { from: formatLocalDate(monday), to: todayKey };
    }
    if (preset === "month") {
      const d = new Date(now);
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      return { from: formatLocalDate(first), to: todayKey };
    }
    return { from: todayKey, to: todayKey };
  };

  useEffect(() => {
    if (dateFilter !== "custom") {
      const range = getPresetRange(dateFilter);
      setFilterFrom(range.from);
      setFilterTo(range.to);
    }
  }, [dateFilter]);

  const filteredPurchases = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (purchases as any[])
      .filter((p) => {
        const createdAt = formatLocalDate(new Date(p.created_at));
        if (createdAt < filterFrom || createdAt > filterTo) return false;
        if (!query) return true;
        return (
          (p.invoice_no ?? "").toLowerCase().includes(query) ||
          (p.suppliers?.name ?? "").toLowerCase().includes(query) ||
          (p.note ?? "").toLowerCase().includes(query)
        );
      });
  }, [purchases, search, filterFrom, filterTo]);

  const filteredTotals = useMemo(() => {
    const todayKey = formatLocalDate(new Date());
    return {
      totalAmount: filteredPurchases.reduce((sum, p) => sum + Number(p.total || 0), 0),
      todayAmount: filteredPurchases.reduce(
        (sum, p) => sum + (formatLocalDate(new Date(p.created_at)) === todayKey ? Number(p.total || 0) : 0),
        0,
      ),
    };
  }, [filteredPurchases]);

  const discountTotal = lines.reduce((s, l) => s + Number(l.discount || 0), 0);
  const subtotal = lines.reduce((s, l) => s + Math.max(0, l.qty * l.cost - Number(l.discount || 0)), 0);
  const taxAmt = taxMode === "pct" ? +(subtotal * (Number(tax || 0) / 100)).toFixed(2) : Number(tax || 0);
  const billDiscountAmt = Math.min(
    subtotal + taxAmt,
    Math.max(0, discountMode === "pct" ? +(subtotal * (billDiscount / 100)).toFixed(2) : billDiscount),
  );
  const total = Math.max(0, subtotal + taxAmt - billDiscountAmt);


  const setLine = (i: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const defaultPaySource =
    paySourceOptions.find((a) => a.name.toLowerCase() === "cash in hand")
    ?? paySourceOptions.find((a) => a.name.toLowerCase().includes("cash"))
    ?? paySourceOptions[0];
  const effectivePaySource = paySource || defaultPaySource?.id || "";

  /** Turn the selected option into a real cash_accounts row (creating presets on demand). */
  const resolvePayAccount = async (): Promise<{ id: string | null; name: string }> => {
    const selected = paySourceOptions.find((a) => a.id === effectivePaySource) ?? defaultPaySource;
    if (!selected) return { id: null, name: "cash" };
    if (!selected.preset) return { id: selected.id, name: selected.name };
    const { data, error } = await supabase
      .from("cash_accounts")
      .insert({ name: selected.name, type: guessAccountType(selected.name), opening_balance: 0, is_active: true })
      .select("id,name")
      .single();
    if (error) throw error;
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
    return { id: data.id as string, name: data.name as string };
  };

  const submit = async () => {
    if (savingRef.current) return;
    if (!supplier || supplier === "none") return toast.error("Supplier is required");
    const items = lines.filter((l) => l.name && l.qty > 0);
    if (!items.length) return toast.error("Add at least one item");
    const sub = items.reduce((s, l) => s + Math.max(0, l.qty * l.cost - Number(l.discount || 0)), 0);
    savingRef.current = true;
    setSaving(true);
    let account: { id: string | null; name: string };
    try {
      account = await resolvePayAccount();
    } catch (e: any) {
      setSaving(false);
      savingRef.current = false;
      return toast.error(e?.message ?? "Could not resolve payment account");
    }
    const clientUuid = typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const { error } = await supabase.rpc("complete_purchase", {
      payload: {
        supplier_id: supplier && supplier !== "none" ? supplier : null,
        tax: taxAmt, paid, note,
        payment_method: account.name,
        account_id: account.id ?? undefined,
        created_at: date || undefined,
        client_uuid: clientUuid,
        items: items.map((l) => {
          const lineNet = Math.max(0, l.qty * l.cost - Number(l.discount || 0));
          const discShare = sub > 0 ? billDiscountAmt * (lineNet / sub) : 0;
          // Keep per-line cost pre-tax because complete_purchase() stores tax
          // separately and computes total as subtotal + tax.
          const effCost = l.qty > 0 ? Math.max(0, lineNet - discShare) / l.qty : l.cost;
          return { product_id: l.product_id, name: l.name, qty: l.qty, cost: +effCost.toFixed(4) };
        }),
      },
    });
    setSaving(false);
    savingRef.current = false;
    if (error) return toast.error(error.message);
    toast.success("Purchase recorded, stock updated");
    setConfirmOpen(false);
    clearDraft();
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
    qc.invalidateQueries({ queryKey: ["cf-purchases"] });
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });

  };


  const hasDraft = lines.length > 0 || !!note || tax > 0 || billDiscount > 0 || paid > 0 || supplier !== "none";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Purchases</h1>
          <p className="text-sm text-muted-foreground">Record stock received from suppliers</p>
        </div>
        <div className="flex items-center gap-2">
          {hasDraft && !open && (
            <Button variant="outline" onClick={() => setOpen(true)} className="border-amber-500/50 text-amber-700 dark:text-amber-300 bg-amber-500/10 hover:bg-amber-500/20">
              <Pencil className="h-4 w-4 mr-2" />
              Draft ({lines.length} item{lines.length === 1 ? "" : "s"})
            </Button>
          )}
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New purchase</Button></DialogTrigger>
          <DialogContent className="w-[98vw] max-w-[1400px] h-[95vh] p-0 flex flex-col gap-0">
            <DialogHeader className="px-6 py-2 border-b shrink-0">
              <DialogTitle>New purchase{hasDraft ? " · Draft in progress" : ""}</DialogTitle>
            </DialogHeader>


            {/* Top bar: compact scan/search + manual add */}
            <div className="px-6 py-2 border-b bg-muted/30 shrink-0">
              <Label className="text-xs">Item code, barcode, or product name</Label>
              <div className="flex items-start gap-2">
                <div className="relative flex-1 max-w-2xl">
                  <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    ref={searchRef}
                    value={entrySearch}
                    onFocus={() => setEntryActive(true)}
                    onBlur={() => setTimeout(() => setEntryActive(false), 120)}
                    onChange={(e) => { setEntrySearch(e.target.value); setEntryActive(true); setEntryIndex(0); }}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowDown") { e.preventDefault(); setEntryIndex((n) => Math.min(n + 1, Math.max(entryMatches.length - 1, 0))); }
                      if (e.key === "ArrowUp") { e.preventDefault(); setEntryIndex((n) => Math.max(n - 1, 0)); }
                      if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); addFromSearch(); }
                    }}
                    placeholder="🔍  Type 4-digit item code first, scan barcode, or type name…"
                    className="pl-10 h-9 text-sm"
                    autoFocus
                  />
                  {entryActive && entrySearch.trim() && (
                    <div className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-popover p-1 shadow-lg">
                      {entryMatches.length === 0 ? (
                        <button
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); openNewProduct(entrySearch); }}
                          className="flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                        >
                          <Plus className="h-4 w-4 text-primary" />
                          <span>Add <b>{entrySearch.trim()}</b> as a new product…</span>
                        </button>
                      ) : entryMatches.map((p, idx) => (
                        <button
                          key={p.id}
                          ref={(el) => { if (el && idx === entryIndex) el.scrollIntoView({ block: "nearest" }); }}
                          type="button"
                          onMouseDown={(e) => { e.preventDefault(); addProductLine(p); }}
                          onMouseEnter={() => setEntryIndex(idx)}
                          className={`flex w-full items-center justify-between gap-3 rounded-sm px-3 py-2 text-left text-sm ${idx === entryIndex ? "bg-accent text-accent-foreground ring-1 ring-primary/40" : "hover:bg-accent hover:text-accent-foreground"}`}
                        >
                          <span className="min-w-0">
                            <span className="block truncate font-medium">{p.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              Code {p.sku || "—"}{p.barcode ? ` · Barcode ${p.barcode}` : ""}
                            </span>
                          </span>
                          <span className="shrink-0 text-right text-xs text-muted-foreground">
                            <span className="block">stock {Number(p.stock ?? 0)}</span>
                            <span className="block">P: {fmtMoney(Number(p.cost_price ?? 0), sym)}</span>
                            <span className="block">S: {fmtMoney(Number(p.sell_price ?? 0), sym)}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Button type="button" variant="outline" className="h-9 mt-0 shrink-0" onClick={() => openNewProduct("")}>
                  <Plus className="h-4 w-4 mr-1" /> New item
                </Button>
                <div className="w-[240px] shrink-0">
                  <select
                    value={supplier}
                    onChange={(e) => { setSupplier(e.target.value); focusSearch(); }}
                    className={`flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${supplier === "none" ? "border-destructive" : ""}`}
                  >
                    <option value="none">— None —</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div className="w-[180px] shrink-0">
                  <Label className="text-xs">Purchase date</Label>
                  <Input
                    type="date"
                    value={date || today}
                    onChange={(e) => setDate(e.target.value)}
                    className="h-9"
                  />
                </div>
              </div>
            </div>


            {/* Body: items table on left, totals side panel on right */}
            <div className="flex-1 min-h-0 flex overflow-hidden">
              {/* Items area */}
              <div className="flex-1 min-w-0 flex flex-col px-6 py-2 overflow-hidden">
                <div className="flex items-center justify-between mb-1 shrink-0">
                  <div className="text-sm">
                    <span className="font-semibold">{lines.length}</span>
                    <span className="text-muted-foreground"> item{lines.length === 1 ? "" : "s"}</span>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => { addProductLine(null, ""); }} className="h-7">
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add empty row
                  </Button>
                </div>

                <div className="flex-1 min-h-0 border rounded-md overflow-auto">
                  {lines.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
                      <Search className="h-10 w-10 mb-3 opacity-40" />
                      <p className="text-sm font-medium">No items added yet</p>
                      <p className="text-xs mt-1">Type the 4-digit item code, scan barcode, or type product name above, then press Enter.</p>
                    </div>
                  ) : (
                    <Table className="w-full [&_td]:py-1 [&_th]:py-1.5 [&_th]:h-8">
                      <TableHeader className="sticky top-0 bg-background z-10">
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead className="w-[120px]">Cost</TableHead>
                          <TableHead className="w-[100px]">Qty</TableHead>
                          <TableHead className="w-16 text-right">Old Avg</TableHead>
                          <TableHead className="w-16 text-right">New Avg</TableHead>
                          <TableHead className="w-12 text-right">Δ%</TableHead>
                          <TableHead className="w-[90px] text-right">Tax</TableHead>
                          <TableHead className="w-[100px] text-right">Discount</TableHead>
                          <TableHead className="w-[120px]">Total</TableHead>
                          <TableHead className="w-9"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {lines.map((l, i) => {
                          const oldStock = Number(l.old_stock ?? 0);
                          const oldCost = Number(l.old_cost ?? 0);
                          const qty = Number(l.qty || 0);
                          const cost = Number(l.cost || 0);
                          const hasProduct = !!l.product_id;
                          const lineDiscount = Number(l.discount || 0);
                          const lineGross = qty * cost;
                          const lineSub = Math.max(0, lineGross - lineDiscount);
                          const taxShare = subtotal > 0 ? taxAmt * (lineSub / subtotal) : 0;
                          const effCost = qty > 0 ? (lineSub + taxShare) / qty : cost;
                          const newAvg = hasProduct
                            ? (oldStock > 0 ? (oldStock * oldCost + qty * effCost) / (oldStock + qty) : effCost)
                            : effCost;
                          const delta = hasProduct && oldCost > 0 ? ((newAvg - oldCost) / oldCost) * 100 : 0;
                          const deltaClass = delta > 0 ? "text-destructive" : delta < 0 ? "text-emerald-600" : "text-muted-foreground";
                          const totalDisplay = l._total != null ? l._total : (qty && cost ? +lineGross.toFixed(2) : 0);
                          return (
                            <TableRow key={i}>
                              <TableCell>
                                <Input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} className="h-8 text-sm" />
                                {(l.item_code || l.barcode) && (
                                  <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                                    {l.item_code ? `Code ${l.item_code}` : `BC ${l.barcode}`} · stock {oldStock}
                                  </div>
                                )}
                              </TableCell>

                              <TableCell>
                                <Input
                                  id={`purchase-cost-${i}`}
                                  type="number"
                                  step="0.01"
                                  value={l.cost ? l.cost : ""}
                                  placeholder="0"
                                  onChange={(e) => setLine(i, { cost: Number(e.target.value), _total: null })}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); focusCell("qty", i); } }}
                                  className="h-8 text-right text-sm"
                                />
                                {taxShare > 0 && qty > 0 && (
                                  <div className="mt-0.5 text-right text-[10px] text-muted-foreground" title="Cost including distributed tax">
                                    +tax = {fmtMoney(effCost, sym)}
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Input
                                  id={`purchase-qty-${i}`}
                                  type="number"
                                  step="0.001"
                                  value={l.qty ? l.qty : ""}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const newQty = Number(e.target.value);
                                    if (l._total != null && newQty > 0) {
                                      setLine(i, { qty: newQty, cost: +(l._total / newQty).toFixed(4) });
                                    } else {
                                      setLine(i, { qty: newQty });
                                    }
                                  }}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); focusSearch(); } }}
                                  className="h-8 text-right text-sm"
                                />
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">
                                {hasProduct ? fmtMoney(oldCost, sym) : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs font-medium">
                                {hasProduct ? fmtMoney(newAvg, sym) : "—"}
                              </TableCell>
                              <TableCell className={`text-right text-xs font-semibold ${deltaClass}`}>
                                {hasProduct && oldCost > 0 ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"}
                              </TableCell>
                              <TableCell className="text-right text-xs">
                                {taxShare > 0 ? (
                                  <span title={qty > 0 ? `${fmtMoney(taxShare / qty, sym)} /unit` : ""}>
                                    {fmtMoney(taxShare, sym)}
                                  </span>
                                ) : <span className="text-muted-foreground">—</span>}
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={l.discount ? l.discount : ""}
                                  placeholder="0"
                                  onChange={(e) => setLine(i, { discount: Number(e.target.value) })}
                                  className="h-8 text-right text-sm"
                                  title="Discount amount on this line (subtracted before tax)"
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={totalDisplay ? totalDisplay : ""}
                                  placeholder="0"
                                  onChange={(e) => {
                                    const t = Number(e.target.value);
                                    if (!t) {
                                      setLine(i, { _total: null });
                                    } else if (qty > 0) {
                                      setLine(i, { cost: +(t / qty).toFixed(4), _total: t });
                                    } else {
                                      // No qty yet — remember total, cost stays 0 until qty entered
                                      setLine(i, { _total: t });
                                    }
                                  }}
                                  title="Base total — cost auto-calculates as total ÷ qty. Tax is added below."
                                  className="h-8 text-right text-sm font-medium"
                                />
                                {(taxShare > 0 || lineDiscount > 0) && (
                                  <div className="mt-0.5 text-right text-[10px] text-muted-foreground" title="Net line total: gross − discount + tax">
                                    net = <span className="font-medium text-foreground">{fmtMoney(Math.max(0, totalDisplay - lineDiscount) + taxShare, sym)}</span>
                                  </div>
                                )}
                              </TableCell>
                              <TableCell>
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLines(lines.filter((_, x) => x !== i))}>
                                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </div>

              {/* Side panel — totals & extras */}
              <aside className="w-[260px] shrink-0 border-l bg-muted/20 flex flex-col overflow-y-auto">
                <div className="px-4 py-3 border-b">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</div>
                  <div className="text-2xl font-bold text-primary leading-tight">{fmtMoney(total, sym)}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">Subtotal {fmtMoney(subtotal, sym)}{taxAmt > 0 ? ` · Tax +${fmtMoney(taxAmt, sym)}` : ""}{billDiscountAmt > 0 ? ` · Bill disc −${fmtMoney(billDiscountAmt, sym)}` : ""}{discountTotal > 0 ? ` · Line disc −${fmtMoney(discountTotal, sym)}` : ""}</div>
                </div>
                <div className="px-4 py-3 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs">Tax</Label>
                    <div className="inline-flex rounded-md border overflow-hidden text-[11px]">
                      <button
                        type="button"
                        onClick={() => setTaxMode("amt")}
                        className={`px-2 py-0.5 ${taxMode === "amt" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >{sym}</button>
                      <button
                        type="button"
                        onClick={() => setTaxMode("pct")}
                        className={`px-2 py-0.5 border-l ${taxMode === "pct" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >%</button>
                    </div>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={tax || ""}
                    onChange={(e) => setTax(Number(e.target.value))}
                    className="h-9"
                    placeholder={taxMode === "pct" ? "e.g. 5" : "0.00"}
                  />
                  {taxAmt > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Tax on bill: <span className="font-medium text-foreground">{fmtMoney(taxAmt, sym)}</span>
                      {taxMode === "pct" ? ` (${Number(tax || 0)}% of subtotal)` : ""} — distributed across all items.
                    </div>
                  )}
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <Label className="text-xs">Discount</Label>
                    <div className="inline-flex rounded-md border overflow-hidden text-[11px]">
                      <button
                        type="button"
                        onClick={() => setDiscountMode("amt")}
                        className={`px-2 py-0.5 ${discountMode === "amt" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >{sym}</button>
                      <button
                        type="button"
                        onClick={() => setDiscountMode("pct")}
                        className={`px-2 py-0.5 border-l ${discountMode === "pct" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >%</button>
                    </div>
                  </div>
                  <Input
                    type="number"
                    step="0.01"
                    value={billDiscount || ""}
                    onChange={(e) => setBillDiscount(Number(e.target.value))}
                    className="h-9"
                    placeholder={discountMode === "pct" ? "e.g. 2" : "0.00"}
                  />
                  {billDiscountAmt > 0 && (
                    <div className="text-[10px] text-muted-foreground mt-1">
                      Bill discount: <span className="font-medium text-foreground">−{fmtMoney(billDiscountAmt, sym)}</span>
                      {discountMode === "pct" ? ` (${Number(billDiscount || 0)}% of subtotal)` : ""} — distributed across all items.
                    </div>
                  )}
                </div>


                <div>
                  <Label className="text-xs">Paid</Label>
                  <Input type="number" step="0.01" value={paid || ""} onChange={(e) => setPaid(Number(e.target.value))} className="h-9" />
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Due: <span className="font-medium text-foreground">{fmtMoney(Math.max(0, total - Number(paid || 0)), sym)}</span>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Pay from</Label>
                  <Select value={effectivePaySource} onValueChange={setPaySource}>
                    <SelectTrigger className="h-9"><SelectValue placeholder="Cash / Cheque / Bank…" /></SelectTrigger>
                    <SelectContent>
                      {paySourceOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    Paid amount is deducted from this account in Cash Flow.
                  </div>
                </div>

                  <div>
                    <Label className="text-xs">Note</Label>
                    <Input value={note} onChange={(e) => setNote(e.target.value)} className="h-9" placeholder="Reference / remarks" />
                  </div>
                </div>
              </aside>
            </div>

            <DialogFooter className="border-t bg-background px-6 py-2 shrink-0 sm:flex-row sm:justify-between gap-2">
              <div className="text-sm text-muted-foreground">
                {lines.length} item{lines.length === 1 ? "" : "s"} • Total <span className="font-semibold text-foreground">{fmtMoney(total, sym)}</span>
              </div>
              <div className="flex flex-wrap gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Hide (keep draft)</Button>
                <Button variant="outline" size="sm" onClick={clearDraft}>Discard</Button>
                <Button onClick={() => setConfirmOpen(true)} disabled={lines.length === 0}>Record purchase</Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>




        <Dialog open={confirmOpen} onOpenChange={(v) => { if (!saving) setConfirmOpen(v); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Confirm purchase</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Save this purchase with <b>{lines.length}</b> item{lines.length === 1 ? "" : "s"}?</p>
              <p className="text-muted-foreground">Total: <span className="font-semibold text-foreground">{fmtMoney(total, sym)}</span></p>
              <p className="text-xs text-muted-foreground">Stock and costs will be updated. This cannot be undone.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>Keep editing</Button>
              <Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Yes, save purchase"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={!!deleteTarget} onOpenChange={(v) => { if (!deleting && !v) setDeleteTarget(null); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Delete purchase</DialogTitle></DialogHeader>
            <div className="space-y-2 text-sm">
              <p>Delete purchase <b>{deleteTarget?.invoice_no ?? ""}</b>?</p>
              <p className="text-muted-foreground">This will delete the purchase and its related items permanently.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>Cancel</Button>
              <Button variant="destructive" onClick={handleDeletePurchase} disabled={deleting}>{deleting ? "Deleting…" : "Delete purchase"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={newProdOpen} onOpenChange={(v) => { if (!newProdSaving) setNewProdOpen(v); }}>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>Add new product</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Name</Label>
                <Input autoFocus value={newProd.name} onChange={(e) => setNewProd({ ...newProd, name: e.target.value })} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Item code (SKU)</Label>
                  <Input value={newProd.sku} onChange={(e) => setNewProd({ ...newProd, sku: e.target.value })} />
                </div>
                <div>
                  <Label>Barcode</Label>
                  <Input value={newProd.barcode} onChange={(e) => setNewProd({ ...newProd, barcode: e.target.value })} />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label>Unit</Label>
                  <Input value={newProd.unit} onChange={(e) => setNewProd({ ...newProd, unit: e.target.value })} />
                </div>
                <div>
                  <Label>Cost</Label>
                  <Input type="number" step="0.01" value={newProd.cost_price || ""} onChange={(e) => setNewProd({ ...newProd, cost_price: Number(e.target.value) })} />
                </div>
                <div>
                  <Label>Sell</Label>
                  <Input type="number" step="0.01" value={newProd.sell_price || ""} onChange={(e) => setNewProd({ ...newProd, sell_price: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label>Supplier</Label>
                <select
                  value={newProd.supplier_id || "none"}
                  onChange={(e) => setNewProd((prev) => ({ ...prev, supplier_id: e.target.value === "none" ? "" : e.target.value }))}
                  className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="none">— None —</option>
                  {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <p className="text-xs text-muted-foreground">Opening stock stays 0 — this purchase will add the actual quantity.</p>
            </div>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setNewProdOpen(false)} disabled={newProdSaving}>Cancel</Button>
              <Button onClick={saveNewProduct} disabled={newProdSaving}>{newProdSaving ? "Saving…" : "Save & add to purchase"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>



        <Dialog open={!!editRow} onOpenChange={(v) => { if (!editSaving && !v) { setEditRow(null); setEditItems([]); setEditItemsOriginal([]); } }}>
          <DialogContent className="w-[96vw] max-w-5xl max-h-[92vh] overflow-y-auto">
            <DialogHeader><DialogTitle>Edit purchase {editRow?.invoice_no}</DialogTitle></DialogHeader>
            {editRow && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Invoice #</Label>
                    <Input value={editRow.invoice_no ?? ""} onChange={(e) => setEditRow({ ...editRow, invoice_no: e.target.value })} />
                  </div>
                  <div>
                    <Label>Supplier</Label>
                    <select
                      value={editRow.supplier_id ?? "none"}
                      onChange={(e) => setEditRow({ ...editRow, supplier_id: e.target.value })}
                      className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="none">— None —</option>
                      {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <div className="border rounded-md overflow-x-auto">
                  <Table className="min-w-[720px]">
                    <TableHeader><TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead className="w-[150px]">Cost</TableHead>
                      <TableHead className="w-[140px]">Qty</TableHead>
                      <TableHead className="text-right w-[120px]">Total</TableHead>
                      <TableHead className="w-11"></TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {editLoading && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">Loading items…</TableCell></TableRow>}
                      {!editLoading && editItems.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-6 text-muted-foreground text-sm">No items on this invoice</TableCell></TableRow>}
                      {editItems.map((it, i) => (
                        <TableRow key={it.id ?? `new-${i}`}>
                          <TableCell><Input value={it.name ?? ""} onChange={(e) => setEditItems((xs) => xs.map((r, x) => x === i ? { ...r, name: e.target.value } : r))} className="h-9" /></TableCell>
                          <TableCell><Input type="number" step="0.01" value={it.cost} onChange={(e) => setEditItems((xs) => xs.map((r, x) => x === i ? { ...r, cost: Number(e.target.value) } : r))} className="h-9 text-right" /></TableCell>
                          <TableCell><Input type="number" step="0.001" value={it.qty} onChange={(e) => setEditItems((xs) => xs.map((r, x) => x === i ? { ...r, qty: Number(e.target.value) } : r))} className="h-9 text-right" /></TableCell>
                          <TableCell className="text-right font-medium">{fmtMoney(Number(it.qty || 0) * Number(it.cost || 0), sym)}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => setEditItems((xs) => xs.filter((_, x) => x !== i))}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  <div><Label>Tax</Label><Input type="number" step="0.01" value={editRow.tax ?? 0} onChange={(e) => setEditRow({ ...editRow, tax: Number(e.target.value) })} /></div>
                  <div><Label>Paid</Label><Input type="number" step="0.01" value={editRow.paid ?? 0} onChange={(e) => setEditRow({ ...editRow, paid: Number(e.target.value) })} /></div>
                  <div>
                    <Label>Status</Label>
                    <Select value={editRow.status ?? "completed"} onValueChange={(v) => setEditRow({ ...editRow, status: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="completed">completed</SelectItem>
                        <SelectItem value="pending">pending</SelectItem>
                        <SelectItem value="cancelled">cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="text-sm text-muted-foreground">Total</div>
                    <div className="text-2xl font-semibold text-primary">
                      {fmtMoney(editItems.reduce((s, it) => s + Number(it.qty || 0) * Number(it.cost || 0), 0) + Number(editRow.tax || 0), sym)}
                    </div>
                  </div>
                </div>
                <div>
                  <Label>Note</Label>
                  <Input value={editRow.note ?? ""} onChange={(e) => setEditRow({ ...editRow, note: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">
                  Changing item quantity adjusts product stock by the difference. Deleting an item removes its qty from stock. Cost changes update this invoice only (product average cost is not recalculated).
                </p>
              </div>
            )}
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setEditRow(null); setEditItems([]); setEditItemsOriginal([]); }} disabled={editSaving}>Cancel</Button>
              <Button
                disabled={editSaving || editLoading}
                onClick={async () => {
                  if (!editRow) return;
                  setEditSaving(true);
                  try {
                    const origById = new Map(editItemsOriginal.map((r) => [r.id, r]));
                    const keptIds = new Set(editItems.filter((r) => r.id).map((r) => r.id));

                    // 1) Stock deltas: kept items (new - old) + deleted items (0 - old)
                    const deltas = new Map<string, number>(); // product_id -> qty delta (positive = add stock)
                    for (const it of editItems) {
                      if (!it.product_id) continue;
                      const orig = it.id ? origById.get(it.id) : null;
                      const oldQty = orig ? Number(orig.qty) : 0;
                      const delta = Number(it.qty || 0) - oldQty;
                      if (delta !== 0) deltas.set(it.product_id, (deltas.get(it.product_id) ?? 0) + delta);
                    }
                    for (const orig of editItemsOriginal) {
                      if (!orig.product_id) continue;
                      if (keptIds.has(orig.id)) continue;
                      const delta = -Number(orig.qty);
                      if (delta !== 0) deltas.set(orig.product_id, (deltas.get(orig.product_id) ?? 0) + delta);
                    }

                    // Apply stock deltas
                    if (deltas.size) {
                      const ids = Array.from(deltas.keys());
                      const { data: prods, error: pErr } = await supabase.from("products").select("id,stock").in("id", ids);
                      if (pErr) throw pErr;
                      for (const p of prods ?? []) {
                        const newStock = Number(p.stock ?? 0) + (deltas.get(p.id) ?? 0);
                        const { error: uErr } = await supabase.from("products").update({ stock: newStock }).eq("id", p.id);
                        if (uErr) throw uErr;
                      }
                    }

                    // 2) Delete removed items
                    const removedIds = editItemsOriginal.filter((r) => !keptIds.has(r.id)).map((r) => r.id);
                    if (removedIds.length) {
                      const { error: dErr } = await supabase.from("purchase_items").delete().in("id", removedIds);
                      if (dErr) throw dErr;
                    }

                    // 3) Update kept items where changed
                    for (const it of editItems) {
                      if (!it.id) continue;
                      const orig = origById.get(it.id);
                      if (!orig) continue;
                      if (orig.name === it.name && Number(orig.qty) === Number(it.qty) && Number(orig.cost) === Number(it.cost)) continue;
                      const line_total = Number(it.qty || 0) * Number(it.cost || 0);
                      const { error: iErr } = await supabase.from("purchase_items")
                        .update({ name: it.name, qty: Number(it.qty || 0), cost: Number(it.cost || 0), line_total })
                        .eq("id", it.id);
                      if (iErr) throw iErr;
                    }

                    // 4) Recompute purchase totals & update header
                    const subtotal = editItems.reduce((s, it) => s + Number(it.qty || 0) * Number(it.cost || 0), 0);
                    const newTax = Number(editRow.tax ?? 0);
                    const newTotal = subtotal + newTax;
                    const { error: hErr } = await supabase
                      .from("purchases")
                      .update({
                        invoice_no: editRow.invoice_no,
                        supplier_id: editRow.supplier_id === "none" ? null : editRow.supplier_id,
                        subtotal,
                        tax: newTax,
                        total: newTotal,
                        paid: Number(editRow.paid ?? 0),
                        note: editRow.note ?? null,
                        status: editRow.status ?? "completed",
                      })
                      .eq("id", editRow.id);
                    if (hErr) throw hErr;

                    toast.success("Purchase updated");
                    setEditRow(null);
                    setEditItems([]);
                    setEditItemsOriginal([]);
                    qc.invalidateQueries({ queryKey: ["purchases"] });
                    qc.invalidateQueries({ queryKey: ["products"] });
                  } catch (e: any) {
                    toast.error(e?.message ?? "Failed to update purchase");
                  } finally {
                    setEditSaving(false);
                  }
                }}
              >
                {editSaving ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>


      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Total purchases</div>
            <div className="mt-2 text-2xl font-semibold">{filteredPurchases.length}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Filtered amount</div>
            <div className="mt-2 text-2xl font-semibold">{fmtMoney(filteredTotals.totalAmount, sym)}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Today's purchase amount</div>
            <div className="mt-2 text-2xl font-semibold">{fmtMoney(filteredTotals.todayAmount, sym)}</div>
          </Card>
        </div>
        <Card className="p-4">
          <div className="grid gap-3 md:grid-cols-[220px_1fr_1fr] items-end">
            <div>
              <Label className="text-xs">Date filter</Label>
              <Select value={dateFilter} onValueChange={(v) => setDateFilter(v as typeof dateFilter)}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="yesterday">Yesterday</SelectItem>
                  <SelectItem value="week">This week</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="custom">Custom range</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={filterFrom} onChange={(e) => { setDateFilter("custom"); setFilterFrom(e.target.value); }} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={filterTo} onChange={(e) => { setDateFilter("custom"); setFilterTo(e.target.value); }} className="h-9" />
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-3 space-y-3">
        <div className="relative max-w-sm">
          <Search className="h-4 w-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search invoice, supplier, or note…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9"
          />
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Invoice</TableHead><TableHead>Date</TableHead><TableHead>Supplier</TableHead>
            <TableHead className="text-right">Total</TableHead><TableHead className="text-right">Paid</TableHead><TableHead>Status</TableHead><TableHead className="w-24 text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {filteredPurchases.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{search.trim() ? "No matching purchases" : "No purchases yet"}</TableCell></TableRow>}
            {filteredPurchases.map((p: any) => (
              <TableRow key={p.id}>
                <TableCell className="font-mono text-xs">{p.invoice_no}</TableCell>
                <TableCell className="text-sm">{new Date(p.created_at).toLocaleString()}</TableCell>
                <TableCell>{p.suppliers?.name ?? "—"}</TableCell>
                <TableCell className="text-right font-medium">{fmtMoney(p.total, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(p.paid, sym)}</TableCell>
                <TableCell><span className="text-xs">{p.status}</span></TableCell>
                <TableCell className="text-right space-x-1">
                  <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(p)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {filteredPurchases.length > 0 && (() => {
              const allTotal = filteredPurchases.reduce((s: number, p: any) => s + Number(p.total), 0);
              const allPaid = filteredPurchases.reduce((s: number, p: any) => s + Number(p.paid), 0);
              const due = allTotal - allPaid;
              return (
                <>
                  <TableRow className="bg-muted/40 font-semibold border-t-2">
                    <TableCell colSpan={3} className="text-right">Column totals</TableCell>
                    <TableCell className="text-right text-primary">{fmtMoney(allTotal, sym)}</TableCell>
                    <TableCell className="text-right text-success">{fmtMoney(allPaid, sym)}</TableCell>
                    <TableCell colSpan={2}></TableCell>
                  </TableRow>
                  <TableRow className="bg-primary/5 font-bold">
                    <TableCell colSpan={5} className="text-right text-base">Grand Total (Outstanding due)</TableCell>
                    <TableCell className={`text-right text-base ${due > 0 ? "text-destructive" : "text-success"}`}>{fmtMoney(due, sym)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </>
              );
            })()}
          </TableBody>
        </Table>
        <div className="flex flex-wrap gap-6 justify-end border-t mt-2 pt-3 px-2 text-sm">
          <div><span className="text-muted-foreground">Filtered total: </span><span className="font-semibold text-primary">{fmtMoney(filteredTotals.totalAmount, sym)}</span></div>
          <div><span className="text-muted-foreground">Today's filtered total: </span><span className="font-semibold">{fmtMoney(filteredTotals.todayAmount, sym)}</span></div>
        </div>
      </Card>
    </div>
  );
}

type PickerProduct = { id: string; name: string; sku?: string | null; barcode?: string | null; cost_price?: number | null; sell_price?: number | null; stock?: number | null };

