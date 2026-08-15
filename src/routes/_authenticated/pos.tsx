import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  X,
  Search,
  Trash2,
  Printer,
  ShoppingCart,
  Loader2,
  Eye,
  EyeOff,
  History,
  Clock,
  UserCog,
  PauseCircle,
  Play,
  ChevronDown,
  Pencil,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePersistentState } from "@/hooks/use-persistent-state";
import { fmtMoney, fmtQty, fmtDate } from "@/lib/format";
import {
  deriveDigitalCashBackSummary,
  normalizePaymentAllocations,
  normalizePaymentMethodValue,
  sumPaymentAllocations,
  type PaymentAllocation,
} from "@/lib/pos-payments";
import { Receipt, printInvoiceDirect } from "@/components/receipt";
import { fetchAll } from "@/lib/supabase-page";
import { ShiftBanner } from "@/components/shift-banner";
import {
  offlineFirst,
  cacheProducts,
  cacheCustomers,
  cacheProductBarcodes,
  completeSaleOfflineAware,
  cacheSuppliers,
  insertOfflineAware,
} from "@/lib/offline/pos";
import { db as offlineDb } from "@/lib/offline/db";
import { enqueueWrite } from "@/lib/offline/sync";
import { isOfflineNow } from "@/lib/offline/session";
import { searchProductsLocal } from "@/lib/offline/pos";

export const Route = createFileRoute("/_authenticated/pos")({
  component: POSPage,
});

type CartItem = {
  product_id: string | null;
  code: string;
  name: string;
  qty: number;
  price: number; // Unit rate (editable)
  mrp: number; // Original MRP / sell price
  cost: number; // Purchase rate (internal only)
  disc_pct: number; // line discount %
  tax_pct: number; // line tax %
  disc: number; // derived flat discount
};
type Tab = {
  id: string;
  name: string;
  items: CartItem[];
  customer_id: string | null;
  expense_person_id: string | null;
  payment_method: string;
  payments: PaymentAllocation[];
  discount: number;
  discount_pct: string;
  charge: number;
  charge_pct: string;
  paid: string;
  note: string;
  digital_received_amount?: string;
  digital_account_id?: string | null;
  restored?: boolean;
  editing_sale_id?: string | null;
  editing_invoice_no?: string | null;
};

const UNDO_REASONS = [
  "Customer forgot item",
  "Wrong quantity",
  "Wrong customer",
  "Wrong payment method",
  "Cashier mistake",
  "Other",
];

const PRODUCT_COLUMNS = "id,name,sku,barcode,sell_price,cost_price,stock,unit,category";
const STAFF_CACHE_KEY = "pos:expense-persons:cache";
const POS_CASH_ACCOUNTS_QUERY_KEY = ["cash-accounts", "pos-payment"] as const;

async function readCachedExpensePersons(): Promise<any[]> {
  try {
    const raw = window.localStorage.getItem(STAFF_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function cacheExpensePersons(rows: any[]) {
  try {
    window.localStorage.setItem(STAFF_CACHE_KEY, JSON.stringify(rows ?? []));
  } catch {
    // best effort
  }
}

async function insertProductOfflineAware(payload: {
  name: string;
  barcode: string | null;
  unit: string;
  category: string | null;
  cost_price: number;
  sell_price: number;
  stock: number;
  tax_rate: number;
  is_active: boolean;
  preferred_supplier_id: string | null;
}) {
  const now = new Date().toISOString();
  const localId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const product = {
    id: localId,
    ...payload,
    created_at: now,
    updated_at: now,
    _offline_pending: true,
    _sync: "pending",
    _deleted: 0,
    _v: 1,
  } as any;

  const saveOffline = async () => {
    await offlineDb().products.put(product);
    await enqueueWrite({
      op: "insert",
      table: "products",
      payload: { ...product, _offline_pending: undefined },
    });
    if (payload.barcode) {
      const barcodeRow = {
        id: `${localId}:${payload.barcode}`,
        product_id: localId,
        barcode: payload.barcode,
        created_at: now,
        updated_at: now,
        _offline_pending: true,
        _sync: "pending",
        _deleted: 0,
        _v: 1,
      } as any;
      await offlineDb().product_barcodes.put(barcodeRow);
      await enqueueWrite({
        op: "insert",
        table: "product_barcodes",
        payload: { ...barcodeRow, _offline_pending: undefined },
      });
    }
    return product;
  };

  if (!isOfflineNow()) {
    try {
      const { data, error } = await supabase
        .from("products")
        .insert(payload)
        .select(PRODUCT_COLUMNS)
        .single();
      if (error) throw error;
      if (payload.barcode) {
        await supabase
          .from("product_barcodes")
          .insert({ product_id: data.id, barcode: payload.barcode });
      }
      try {
        await offlineDb().products.put({ ...data, updated_at: now });
        if (payload.barcode) {
          await offlineDb().product_barcodes.put({
            id: `${data.id}:${payload.barcode}`,
            product_id: data.id,
            barcode: payload.barcode,
          });
        }
      } catch {
        // best effort
      }
      return data;
    } catch (e: any) {
      const msg = String(e?.message ?? e ?? "").toLowerCase();
      const networkish =
        /failed to fetch|network(error)?|fetch failed|timeout|timed out|offline|dns|err_(internet|network|name_not_resolved|connection)|socket|aborted|econn|enotfound/.test(
          msg,
        );
      if (!networkish) throw e;
      return saveOffline();
    }
  }

  return saveOffline();
}

async function fetchActiveCashAccounts() {
  return offlineFirst<any[]>(
    async () => {
      const { data, error } = await supabase
        .from("cash_accounts")
        .select("id,name,type,is_active,sort_order,created_at")
        .eq("is_active", true)
        .order("sort_order")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    async () =>
      (await offlineDb().cash_accounts.toArray())
        .filter((a: any) => a.is_active)
        .sort((a: any, b: any) => {
          const bySort = Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0);
          if (bySort !== 0) return bySort;
          return String(a.name ?? "").localeCompare(String(b.name ?? ""));
        }),
    async (rows) => {
      try {
        await offlineDb().cash_accounts.bulkPut(rows as any[]);
      } catch {
        // best effort
      }
    },
  );
}

const cleanItemCode = (value: unknown) => {
  const code = String(value ?? "").trim();
  return code && code !== "null" && code !== "undefined" ? code : "";
};

const newTab = (n: number): Tab => ({
  id: crypto.randomUUID(),
  name: `Invoice ${n}`,
  items: [],
  customer_id: null,
  expense_person_id: null,
  payment_method: "cash",
  payments: [{ method: "cash", amount: 0 }],
  discount: 0,
  discount_pct: "",
  charge: 0,
  charge_pct: "",
  paid: "",
  note: "",
  digital_received_amount: "",
  digital_account_id: null,
});

const SPLIT_PAYMENT_PREFIX = "split:";

function toStoredSplitPayments(allocations: PaymentAllocation[], targetPaid: number) {
  const positive = (allocations ?? []).filter((entry) => Number(entry.amount ?? 0) > 0);
  const totalInput = positive.reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  const target = +Math.max(0, Number(targetPaid || 0)).toFixed(2);
  if (positive.length === 0 || totalInput <= 0 || target <= 0)
    return [] as { method: string; amount: number }[];

  const scaled = positive.map((entry) => ({
    method: (entry.method || "cash").trim() || "cash",
    amount: +((Number(entry.amount ?? 0) * target) / totalInput).toFixed(2),
  }));
  const current = scaled.reduce((sum, entry) => sum + entry.amount, 0);
  const delta = +(target - current).toFixed(2);
  if (scaled.length > 0 && Math.abs(delta) >= 0.01) {
    scaled[scaled.length - 1] = {
      ...scaled[scaled.length - 1],
      amount: +(scaled[scaled.length - 1].amount + delta).toFixed(2),
    };
  }
  return scaled.filter((entry) => entry.amount > 0);
}

function serializePaymentMethod(allocations: PaymentAllocation[], fallback: string, paid: number) {
  const rows = toStoredSplitPayments(allocations, paid);
  if (rows.length <= 1) return rows[0]?.method || fallback || "cash";
  const encoded = rows
    .map((entry) => `${encodeURIComponent(entry.method)}=${entry.amount.toFixed(2)}`)
    .join("|");
  return `${SPLIT_PAYMENT_PREFIX}${encoded}`;
}

function parsePaymentMethod(
  methodValue: string | null | undefined,
  paidValue: number,
): PaymentAllocation[] {
  const raw = String(methodValue ?? "").trim();
  const paid = +Math.max(0, Number(paidValue || 0)).toFixed(2);
  if (!raw.startsWith(SPLIT_PAYMENT_PREFIX)) {
    return [{ method: normalizePaymentMethodValue(raw || "cash"), amount: paid }];
  }
  const body = raw.slice(SPLIT_PAYMENT_PREFIX.length);
  const parts = body.split("|").filter(Boolean);
  const rows = parts
    .map((part) => {
      const [methodEncoded, amountRaw] = part.split("=");
      let decoded = methodEncoded || "";
      try {
        decoded = decodeURIComponent(methodEncoded || "");
      } catch {
        decoded = methodEncoded || "";
      }
      const method = normalizePaymentMethodValue(decoded.trim() || "cash");
      const amount = +Math.max(0, Number(amountRaw || 0)).toFixed(2);
      return { method, amount };
    })
    .filter((entry) => entry.amount > 0);
  if (!rows.length) return [{ method: "cash", amount: paid }];
  return rows;
}

async function searchProducts(term: string) {
  const q = term.trim().replace(/\s+/g, " ");
  if (!q) return [];
  // Offline (or flaky network): search the local mirror instead.
  if (isOfflineNow()) return searchProductsLocal(q);
  try {
    return await searchProductsOnline(q);
  } catch (e: any) {
    const local = await searchProductsLocal(q);
    if (local.length) return local;
    throw e;
  }
}

async function searchProductsOnline(q: string) {
  const like = `%${q}%`;
  const [nameRes, skuRes, barcodeRes, extraBarcodeRes] = await Promise.all([
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("is_active", true)
      .ilike("name", like)
      .order("name")
      .limit(200),
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("is_active", true)
      .ilike("sku", like)
      .order("name")
      .limit(50),
    supabase
      .from("products")
      .select(PRODUCT_COLUMNS)
      .eq("is_active", true)
      .ilike("barcode", like)
      .order("name")
      .limit(50),
    supabase.from("product_barcodes").select("product_id,barcode").ilike("barcode", like).limit(50),
  ]);

  const firstError = nameRes.error ?? skuRes.error ?? barcodeRes.error ?? extraBarcodeRes.error;
  if (firstError) throw firstError;

  const matchedBarcodesByProduct: Record<string, string[]> = {};
  for (const row of extraBarcodeRes.data ?? []) {
    if (!matchedBarcodesByProduct[row.product_id]) matchedBarcodesByProduct[row.product_id] = [];
    matchedBarcodesByProduct[row.product_id].push(row.barcode);
  }

  const extraIds = Object.keys(matchedBarcodesByProduct);
  const extraProductsRes = extraIds.length
    ? await supabase
        .from("products")
        .select(PRODUCT_COLUMNS)
        .eq("is_active", true)
        .in("id", extraIds)
        .limit(24)
    : { data: [], error: null };
  if (extraProductsRes.error) throw extraProductsRes.error;

  const merged = new Map<string, any>();
  for (const p of [
    ...(nameRes.data ?? []),
    ...(skuRes.data ?? []),
    ...(barcodeRes.data ?? []),
    ...(extraProductsRes.data ?? []),
  ]) {
    merged.set(p.id, {
      ...p,
      _matched_barcodes: matchedBarcodesByProduct[p.id] ?? [],
    });
  }

  return Array.from(merged.values());
}

function POSPage() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  // Billing in progress survives navigation to other sections (and refresh):
  // cart lines, customer, payment, discounts and the active tab are persisted.
  const [tabs, setTabs] = usePersistentState<Tab[]>("pos-tabs", [newTab(1)]);
  const [active, setActive] = usePersistentState<string>("pos-active-tab", tabs[0]?.id ?? "");
  const tab = tabs.find((t) => t.id === active) ?? tabs[0];

  // Guard against a corrupted/empty persisted draft.
  useEffect(() => {
    if (!tabs.length) {
      const t = newTab(1);
      setTabs([t]);
      setActive(t.id);
    } else if (!tabs.some((t) => t.id === active)) {
      setActive(tabs[0].id);
    }
  }, [tabs, active, setTabs, setActive]);

  const [search, setSearch] = useState("");
  const searchTerm = useMemo(() => search.trim().replace(/\s+/g, " "), [search]);
  const [, setLastInvoice] = useState<any>(null);
  const [reprintOpen, setReprintOpen] = useState(false);
  const [reprintView, setReprintView] = useState<any>(null);
  const [printAsk, setPrintAsk] = useState<any>(null);
  const [heldOpen, setHeldOpen] = useState(false);
  const [holding, setHolding] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous lock: React state updates are async, so rapid Enter presses /
  // double clicks could fire handleSale twice before `submitting` flipped and
  // create duplicate invoices. This ref closes that window.
  const saleLockRef = useRef(false);
  const [undoCandidate, setUndoCandidate] = useState<{
    sale_id: string;
    invoice_no: string;
    total: number;
    item_count: number;
    created_at: string;
  } | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoTick, setUndoTick] = useState(0);
  const undoWindowMin = Math.max(1, Number((settings as any)?.undo_window_minutes ?? 5));
  const [showCost, setShowCost] = useState(false);
  const [showStaff, setShowStaff] = useState(false);
  const [showProfit, setShowProfit] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [cartCursor, setCartCursor] = useState<number>(-1);
  const cartRowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  const searchRowRefs = useRef<Array<HTMLTableRowElement | null>>([]);
  // True while the user is navigating results with the keyboard — blocks hover
  // (including hover caused by auto-scrolling) from stealing the highlight.
  const kbNavRef = useRef(false);

  const [scanFlash, setScanFlash] = useState(false);
  const [undoReason, setUndoReason] = useState<string>(UNDO_REASONS[0]);
  const [undoReasonNote, setUndoReasonNote] = useState<string>("");
  const [quickAddCustomerOpen, setQuickAddCustomerOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "" });
  const [quickAddLookup, setQuickAddLookup] = useState("");
  const triggerScanFlash = () => {
    setScanFlash(true);
    window.setTimeout(() => setScanFlash(false), 300);
  };
  const saveQuickCustomer = async () => {
    const name = newCustomer.name.trim();
    if (!name) return toast.error("Customer name required");
    try {
      const data = await insertOfflineAware("customers", {
        name,
        phone: newCustomer.phone.trim() || null,
        balance: 0,
      } as any);
      setTab({ customer_id: data.id, payment_method: "credit" });
      toast.success(
        data._offline_pending
          ? `Added ${data.name} offline — will sync automatically`
          : `Added ${data.name}`,
      );
    } catch (e: any) {
      return toast.error(e?.message ?? "Could not add customer");
    }
    setQuickAddCustomerOpen(false);
    setNewCustomer({ name: "", phone: "" });
    qc.invalidateQueries({ queryKey: ["customers"] });
    setTimeout(() => searchRef.current?.focus(), 0);
  };
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState<{ idx: number; field: "price" | "qty" | "disc" } | null>(
    null,
  );
  const [quickAdd, setQuickAdd] = useState<{
    open: boolean;
    barcode: string;
    name: string;
    unit: string;
    cost_price: string;
    sell_price: string;
    stock: string;
    category: string;
    supplier_id: string;
    sku: string;
    barcodes_text: string;
    low_stock_threshold: string;
    tax_rate: string;
    batch_no: string;
    expiry_date: string;
    rack_location: string;
    allow_negative_stock: boolean;
  }>({
    open: false,
    barcode: "",
    name: "",
    unit: "pcs",
    cost_price: "",
    sell_price: "",
    stock: "1",
    category: "",
    supplier_id: "",
    sku: "",
    barcodes_text: "",
    low_stock_threshold: "5",
    tax_rate: "0",
    batch_no: "",
    expiry_date: "",
    rack_location: "",
    allow_negative_stock: true,
  });

  const openQuickAdd = (term: string) => {
    const raw = term.trim();
    // Detect scanner-style codes vs a name typed by hand
    const looksLikeBarcode = /^[0-9A-Za-z\-]{4,}$/.test(raw) && /\d/.test(raw);
    setQuickAdd({
      open: true,
      barcode: looksLikeBarcode ? raw : "",
      name: looksLikeBarcode ? "" : raw,
      unit: "pcs",
      cost_price: "",
      sell_price: "",
      stock: "1",
      category: "",
      supplier_id: "",
      sku: "",
      barcodes_text: "",
      low_stock_threshold: "5",
      tax_rate: "0",
      batch_no: "",
      expiry_date: "",
      rack_location: "",
      allow_negative_stock: true,
    });
    setQuickAddLookup(raw);
  };

  const { data: quickAddMatches = [], isFetching: quickAddMatchesLoading } = useQuery({
    queryKey: ["pos-quickadd-search", quickAddLookup],
    enabled: quickAddLookup.trim().length >= 2,
    queryFn: () => searchProducts(quickAddLookup),
    staleTime: 10_000,
  });

  const selectQuickAddMatch = async (product: any) => {
    addProduct(product);
    toast.success(`Added ${product.name}`);
    setQuickAdd({
      open: false,
      barcode: "",
      name: "",
      unit: "pcs",
      cost_price: "",
      sell_price: "",
      stock: "1",
      category: "",
      supplier_id: "",
      sku: "",
      barcodes_text: "",
      low_stock_threshold: "5",
      tax_rate: "0",
      batch_no: "",
      expiry_date: "",
      rack_location: "",
      allow_negative_stock: true,
    });
    setQuickAddLookup("");
    setSearch("");
    setTimeout(() => searchRef.current?.focus(), 0);
  };

  const { data: quickAddSuppliers = [] } = useQuery({
    queryKey: ["suppliers", "quickadd"],
    queryFn: () =>
      offlineFirst<any[]>(
        async () => {
          const { data, error } = await supabase
            .from("suppliers")
            .select("id,name,phone,balance")
            .order("name");
          if (error) throw error;
          return data ?? [];
        },
        async () =>
          (await offlineDb().suppliers.toArray()).sort((a: any, b: any) =>
            String(a.name ?? "").localeCompare(String(b.name ?? "")),
          ),
        (rows) => cacheSuppliers(rows),
      ),
  });

  const { data: quickAddCategories = [] } = useQuery({
    queryKey: ["products", "categories"],
    queryFn: () =>
      offlineFirst<string[]>(
        async () => {
          const { data, error } = await supabase
            .from("products")
            .select("category")
            .not("category", "is", null)
            .limit(1000);
          if (error) throw error;
          const set = new Set<string>();
          (data ?? []).forEach((r: any) => {
            if (r.category) set.add(String(r.category));
          });
          return Array.from(set).sort();
        },
        async () => {
          const set = new Set<string>();
          (await offlineDb().products.toArray()).forEach((r: any) => {
            if (r.category) set.add(String(r.category));
          });
          return Array.from(set).sort();
        },
      ),
  });

  const saveQuickAdd = async () => {
    const name = quickAdd.name.trim();
    if (!name) return toast.error("Item name is required");
    const sell = Number(quickAdd.sell_price || 0);
    const cost = Number(quickAdd.cost_price || 0);
    const stock = Number(quickAdd.stock || 0);
    const bc = quickAdd.barcode.trim() || null;
    const category = quickAdd.category.trim() || null;
    const payload = {
      name,
      sku: quickAdd.sku?.trim() || null,
      barcode: bc,
      unit: quickAdd.unit || "pcs",
      category,
      cost_price: cost,
      sell_price: sell,
      stock,
      tax_rate: Number(quickAdd.tax_rate || 0),
      is_active: true,
      low_stock_threshold: Number(quickAdd.low_stock_threshold || 0),
      preferred_supplier_id: quickAdd.supplier_id || null,
      batch_no: quickAdd.batch_no.trim() || null,
      expiry_date: quickAdd.expiry_date || null,
      rack_location: quickAdd.rack_location.trim() || null,
      allow_negative_stock: quickAdd.allow_negative_stock,
    };
    let data: any;
    try {
      data = await insertProductOfflineAware(payload);
    } catch (e: any) {
      return toast.error(e?.message ?? "Could not add product");
    }
    toast.success(
      data?._offline_pending
        ? `Added "${name}" offline — will sync automatically`
        : `Added "${name}" to catalog`,
    );
    addProduct(data);
    setQuickAdd({
      open: false,
      barcode: "",
      name: "",
      unit: "pcs",
      cost_price: "",
      sell_price: "",
      stock: "1",
      category: "",
      supplier_id: "",
      sku: "",
      barcodes_text: "",
      low_stock_threshold: "5",
      tax_rate: "0",
      batch_no: "",
      expiry_date: "",
      rack_location: "",
      allow_negative_stock: true,
    });
    setSearch("");
    setTimeout(() => searchRef.current?.focus(), 0);
    qc.invalidateQueries({ queryKey: ["products"] });
    qc.invalidateQueries({ queryKey: ["product_barcodes"] });
    qc.invalidateQueries({ queryKey: ["products", "categories"] });
  };

  const searchRef = useRef<HTMLInputElement>(null);
  const paidRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { data: cashAccountOptions = [] } = useQuery({
    queryKey: POS_CASH_ACCOUNTS_QUERY_KEY,
    queryFn: fetchActiveCashAccounts,
  });

  const { data: products = [], isLoading: productsLoading } = useQuery({
    queryKey: ["products", "active"],
    queryFn: () =>
      offlineFirst(
        () =>
          fetchAll<any>((from: number, to: number) =>
            supabase
              .from("products")
              .select(PRODUCT_COLUMNS)
              .eq("is_active", true)
              .order("name")
              .range(from, to),
          ),
        async () =>
          (await offlineDb().products.toArray())
            .filter((p: any) => p.is_active !== false)
            .sort((a: any, b: any) => (a.name ?? "").localeCompare(b.name ?? "")),
        (rows) => cacheProducts(rows),
      ),
    staleTime: 5 * 60 * 1000,
  });

  const { data: remoteProducts = [], isFetching: remoteProductsLoading } = useQuery({
    queryKey: ["products", "pos-search", searchTerm],
    enabled: searchTerm.length > 0 && products.length === 0,
    queryFn: () => searchProducts(searchTerm),
    staleTime: 60 * 1000,
  });

  const searchableProducts = useMemo(
    () => (products.length > 0 ? products : remoteProducts),
    [products, remoteProducts],
  );

  const { data: extraBarcodes = [] } = useQuery({
    queryKey: ["product_barcodes"],
    queryFn: () =>
      offlineFirst(
        () =>
          fetchAll<any>((from: number, to: number) =>
            supabase.from("product_barcodes").select("id,product_id,barcode").range(from, to),
          ),
        () => offlineDb().product_barcodes.toArray(),
        (rows) => cacheProductBarcodes(rows),
      ),
  });

  // product_id -> array of all barcodes (primary + extras)
  const barcodesByProduct = useMemo(() => {
    const m: Record<string, string[]> = {};
    searchableProducts.forEach((p) => {
      const matched = Array.isArray(p._matched_barcodes) ? p._matched_barcodes.map(String) : [];
      m[p.id] = Array.from(new Set([...(p.barcode ? [String(p.barcode)] : []), ...matched]));
    });
    extraBarcodes.forEach((b: any) => {
      if (!m[b.product_id]) m[b.product_id] = [];
      if (!m[b.product_id].includes(b.barcode)) m[b.product_id].push(b.barcode);
    });
    return m;
  }, [searchableProducts, extraBarcodes]);

  const itemCodeLookupBarcodes = useMemo(() => {
    const set = new Set<string>();
    searchableProducts.forEach((p) => {
      if (p.barcode) set.add(String(p.barcode));
      (barcodesByProduct[p.id] ?? []).forEach((bc) => set.add(String(bc)));
    });
    return Array.from(set).slice(0, 1000);
  }, [searchableProducts, barcodesByProduct]);

  const { data: libraryItemCodes = {} } = useQuery({
    queryKey: ["global_products", "item-codes", itemCodeLookupBarcodes.join("|")],
    enabled: itemCodeLookupBarcodes.length > 0,
    queryFn: async () => {
      const map: Record<string, string> = {};
      try {
        for (let i = 0; i < itemCodeLookupBarcodes.length; i += 500) {
          const slice = itemCodeLookupBarcodes.slice(i, i + 500);
          const { data, error } = await supabase
            .from("global_products")
            .select("barcode,item_code")
            .in("barcode", slice)
            .not("item_code", "is", null);
          if (error) throw error;
          (data ?? []).forEach((row: any) => {
            const barcode = String(row.barcode ?? "").trim();
            const itemCode = cleanItemCode(row.item_code);
            if (barcode && itemCode && itemCode !== barcode) map[barcode] = itemCode;
          });
        }
      } catch {
        return {};
      }
      return map;
    },
    staleTime: 30 * 60 * 1000,
  });

  const itemCodeByBarcode = useMemo(() => {
    const m: Record<string, string> = { ...libraryItemCodes };
    searchableProducts.forEach((p) => {
      const sku = cleanItemCode(p.sku);
      if (!sku) return;
      if (p.barcode) m[String(p.barcode)] = sku;
      (barcodesByProduct[p.id] ?? []).forEach((bc) => {
        m[String(bc)] = sku;
      });
    });
    return m;
  }, [searchableProducts, barcodesByProduct, libraryItemCodes]);

  const itemCodeForProduct = (p: any) => {
    const sku = cleanItemCode(p?.sku);
    if (sku) return sku;
    const candidates = Array.from(
      new Set([p?.barcode, ...(barcodesByProduct[p?.id] ?? [])].filter(Boolean).map(String)),
    );
    for (const bc of candidates) {
      const itemCode = cleanItemCode(itemCodeByBarcode[bc]);
      if (itemCode && itemCode !== bc) return itemCode;
    }
    return "";
  };

  // Exact-barcode lookup for scan
  const productByBarcode = useMemo(() => {
    const m: Record<string, any> = {};
    searchableProducts.forEach((p) => {
      (barcodesByProduct[p.id] ?? []).forEach((bc) => {
        m[bc] = p;
      });
    });
    return m;
  }, [searchableProducts, barcodesByProduct]);

  // O(1) id -> product lookup so cart rows never linear-scan the catalogue.
  const productById = useMemo(() => {
    const m: Record<string, any> = {};
    searchableProducts.forEach((p) => {
      m[p.id] = p;
    });
    return m;
  }, [searchableProducts]);

  const { data: customers = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: () =>
      offlineFirst(
        async () => {
          const { data, error } = await supabase
            .from("customers")
            .select("id,name,balance,phone")
            .order("name");
          if (error) throw error;
          return data ?? [];
        },
        async () =>
          (await offlineDb().customers.toArray()).sort((a: any, b: any) =>
            (a.name ?? "").localeCompare(b.name ?? ""),
          ),
        (rows) => cacheCustomers(rows),
      ),
  });

  const { data: persons = [] } = useQuery({
    queryKey: ["expense_persons", "active"],
    queryFn: () =>
      offlineFirst<any[]>(async () => {
        const { data, error } = await supabase
          .from("expense_persons")
          .select("id,name,role,is_active")
          .eq("is_active", true)
          .order("name");
        if (error) throw error;
        const rows = data ?? [];
        await cacheExpensePersons(rows);
        return rows;
      }, readCachedExpensePersons),
  });

  const filtered = useMemo(() => {
    const q = search.trim().replace(/\s+/g, " ").toLowerCase();
    if (!q) return [];
    // Score each product so best matches float to the top.
    // 0 = exact sku/barcode, 1 = sku/barcode prefix, 2 = name prefix,
    // 3 = word-start in name, 4 = name substring, 5 = sku/barcode substring,
    // 6 = category match. Lower is better.
    const scored: { p: any; s: number }[] = [];
    for (const p of searchableProducts) {
      const name = (p.name ?? "").toLowerCase();
      const sku = (p.sku ?? "").toLowerCase();
      const cat = (p.category ?? "").toLowerCase();
      const bcs = (barcodesByProduct[p.id] ?? []).map((b) => b.toLowerCase());

      let s = -1;
      if (sku === q || bcs.includes(q)) s = 0;
      else if (sku.startsWith(q) || bcs.some((b) => b.startsWith(q))) s = 1;
      else if (name.startsWith(q)) s = 2;
      else if (name.includes(" " + q)) s = 3;
      else if (name.includes(q)) s = 4;
      else if (sku.includes(q) || bcs.some((b) => b.includes(q))) s = 5;
      else if (cat.includes(q)) s = 6;

      if (s >= 0) scored.push({ p, s });
    }
    scored.sort((a, b) => a.s - b.s || a.p.name.localeCompare(b.p.name));
    return scored.slice(0, 200).map((x) => x.p);
  }, [searchableProducts, search, barcodesByProduct]);

  // reset highlight whenever the filtered list changes
  useEffect(() => {
    setHighlight(0);
    kbNavRef.current = false;
  }, [search]);

  // Scroll highlighted search result into view (accounting for sticky header)
  useEffect(() => {
    if (!search.trim()) return;
    const el = searchRowRefs.current[highlight];
    if (!el) return;
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && scroller !== document.body) {
      const s = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(s.overflowY)) break;
      scroller = scroller.parentElement;
    }
    if (!scroller) {
      el.scrollIntoView({ block: "nearest" });
      return;
    }
    const thead = scroller.querySelector<HTMLElement>("thead");
    const headerH = thead?.offsetHeight ?? 0;
    const rowTop = el.offsetTop;
    const rowBottom = rowTop + el.offsetHeight;
    const viewTop = scroller.scrollTop + headerH;
    const viewBottom = scroller.scrollTop + scroller.clientHeight;
    if (rowTop < viewTop) {
      scroller.scrollTo({ top: rowTop - headerH, behavior: "smooth" });
    } else if (rowBottom > viewBottom) {
      scroller.scrollTo({ top: rowBottom - scroller.clientHeight, behavior: "smooth" });
    }
  }, [highlight, search]);

  // Keep cart cursor in range and scroll into view
  useEffect(() => {
    if (tab.items.length === 0) {
      setCartCursor(-1);
      return;
    }
    if (cartCursor >= tab.items.length) setCartCursor(tab.items.length - 1);
  }, [tab.items.length]);
  useEffect(() => {
    if (cartCursor < 0) return;
    const el = cartRowRefs.current[cartCursor];
    if (!el) return;
    // Find the scroll container (the overflow-auto ancestor)
    let scroller: HTMLElement | null = el.parentElement;
    while (scroller && scroller !== document.body) {
      const style = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(style.overflowY)) break;
      scroller = scroller.parentElement;
    }
    if (!scroller) {
      el.scrollIntoView({ block: "nearest" });
      return;
    }
    const thead = scroller.querySelector<HTMLElement>("thead");
    const headerH = thead?.offsetHeight ?? 0;
    const rowTop = el.offsetTop;
    const rowBottom = rowTop + el.offsetHeight;
    const viewTop = scroller.scrollTop + headerH;
    const viewBottom = scroller.scrollTop + scroller.clientHeight;
    if (rowTop < viewTop) {
      scroller.scrollTo({ top: rowTop - headerH, behavior: "smooth" });
    } else if (rowBottom > viewBottom) {
      scroller.scrollTo({ top: rowBottom - scroller.clientHeight, behavior: "smooth" });
    }
  }, [cartCursor]);

  const setTab = (patch: Partial<Tab>) =>
    setTabs((ts) => ts.map((t) => (t.id === active ? { ...t, ...patch } : t)));

  const addProduct = (p: any): number => {
    const items = [...tab.items];
    const exIdx = items.findIndex((i) => i.product_id === p.id);
    let idx: number;
    if (exIdx >= 0) {
      const nextCode = itemCodeForProduct(p);
      items[exIdx] = {
        ...items[exIdx],
        code: items[exIdx].code || nextCode,
        qty: Number(items[exIdx].qty) + 1,
      };
      idx = exIdx;
    } else {
      items.push({
        product_id: p.id,
        code: itemCodeForProduct(p),
        name: p.name,
        qty: 1,
        price: Number(p.sell_price),
        mrp: Number(p.sell_price),
        cost: Number(p.cost_price),
        disc_pct: 0,
        tax_pct: 0,
        disc: 0,
      });
      idx = items.length - 1;
    }
    setTab({ items });
    setCartCursor(idx);
    return idx;
  };

  const updateLine = (idx: number, patch: Partial<CartItem>) => {
    const items = tab.items.map((it, i) => {
      if (i !== idx) return it;
      const next = { ...it, ...patch };
      const gross = Number(next.qty) * Number(next.price);
      if ("disc" in patch) {
        // flat discount typed directly — derive %
        next.disc = +Math.max(0, Number(patch.disc || 0)).toFixed(2);
        next.disc_pct = gross > 0 ? +((next.disc / gross) * 100).toFixed(2) : 0;
      } else {
        next.disc = +Math.max(0, (gross * Number(next.disc_pct || 0)) / 100).toFixed(2);
      }
      return next;
    });
    setTab({ items });
  };

  const removeLine = (idx: number) => setTab({ items: tab.items.filter((_, i) => i !== idx) });

  const subtotal = tab.items.reduce(
    (s, i) => s + Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0),
    0,
  );
  const lineDiscountTotal = tab.items.reduce((s, i) => s + Number(i.disc || 0), 0);
  // per-line tax sum (overrides global tax)
  const tax = +tab.items
    .reduce((s, i) => {
      const net = Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0);
      return s + (net * Number(i.tax_pct || 0)) / 100;
    }, 0)
    .toFixed(2);
  const discount = Number(tab.discount || 0);
  const charge = Number(tab.charge || 0);
  const total = +(subtotal + tax - discount + charge).toFixed(2);
  const paymentRows =
    Array.isArray((tab as any).payments) && (tab as any).payments.length
      ? ((tab as any).payments as PaymentAllocation[])
      : [{ method: tab.payment_method || "cash", amount: Number(tab.paid || 0) }];
  const digitalCashBackSummary = deriveDigitalCashBackSummary(
    total,
    tab.digital_received_amount ?? tab.paid ?? 0,
  );
  const isDigitalCashBackMode = normalizePaymentMethodValue(tab.payment_method) === "digital_cash_back";
  const isDigitalMode = normalizePaymentMethodValue(tab.payment_method) === "digital";
  const normalizedPayments = normalizePaymentAllocations(paymentRows, tab.payment_method, tab.paid);
  const paidAmountForBalance = isDigitalCashBackMode
    ? total
    : sumPaymentAllocations(normalizedPayments);
  const paidNum = paidAmountForBalance;
  const change = Math.max(paidAmountForBalance - total, 0);
  const due = Math.max(total - paidAmountForBalance, 0);
  const digitalCashBackAmount = isDigitalCashBackMode ? digitalCashBackSummary.cashBackAmount : 0;

  const setPaymentRows = (rows: PaymentAllocation[]) => {
    const nextRows = rows.length ? rows : [{ method: tab.payment_method || "cash", amount: 0 }];
    setTab({
      payments: nextRows,
      payment_method: nextRows[0]?.method || tab.payment_method || "cash",
      paid: String(sumPaymentAllocations(nextRows)),
    });
  };

  const updatePaymentRow = (idx: number, patch: Partial<PaymentAllocation>) => {
    const nextRows = [...paymentRows];
    const current = nextRows[idx] ?? { method: tab.payment_method || "cash", amount: 0 };
    const resolvedPatch = { ...patch };
    if (isDigitalCashBackMode && idx === 0 && resolvedPatch.method) {
      resolvedPatch.method = "digital_cash_back";
    }
    nextRows[idx] = { ...current, ...resolvedPatch };
    setPaymentRows(nextRows);
  };

  const addPaymentRow = () => {
    const nextRows = [
      ...paymentRows,
      {
        method: paymentRows[paymentRows.length - 1]?.method || tab.payment_method || "cash",
        amount: 0,
      },
    ];
    setPaymentRows(nextRows);
  };

  const removePaymentRow = (idx: number) => {
    const nextRows = paymentRows.filter((_, i) => i !== idx);
    setPaymentRows(nextRows);
  };

  const setPrimaryPaymentMethod = (method: string) => {
    const nextMethod = normalizePaymentMethodValue(method);
    const rowMethod = nextMethod;

    // Reset mutually exclusive states
    const patch: Partial<Tab> = {
      payment_method: nextMethod,
    };

    if (nextMethod !== "credit") {
      patch.customer_id = null;
    }
    // Digital and Digital + CB are separate methods; both use digital_account_id
    // but only the cash-back flow uses digital_received_amount.
    if (nextMethod !== "digital_cash_back") {
      patch.digital_received_amount = "";
    }
    if (nextMethod !== "digital_cash_back" && nextMethod !== "digital") {
      patch.digital_account_id = null;
    }
    // expense_person_id is handled by the Staff button toggle, but we should clear it if switching to others
    if (nextMethod !== "staff") {
      patch.expense_person_id = null;
    }

    const nextRows = [{ method: rowMethod, amount: Number(tab.paid || 0) || 0 }];
    setTab({
      ...patch,
      payments: nextRows,
      paid: tab.paid,
    });
  };

  const accountNameById = (accountId: string | null) => {
    const account = ((cashAccountOptions ?? []) as any[]).find((a: any) => a.id === accountId);
    return account?.name ? String(account.name) : null;
  };

  /** Plain Digital: sale is fully received in a digital/online account.
   *  The tender row carries the account name so Cash Flow attributes the
   *  inflow to that exact account. Never touches the cash-back state. */
  const setDigitalAccount = (accountId: string | null) => {
    const name = accountNameById(accountId);
    const rowMethod = name ? normalizePaymentMethodValue(name) : "digital";
    setTab({
      payment_method: "digital",
      digital_account_id: accountId || null,
      digital_received_amount: "",
      customer_id: null,
      expense_person_id: null,
      payments: [{ method: rowMethod, amount: Number(tab.paid || 0) || 0 }],
    });
  };

  /** Digital + CB: the customer sends more than the bill and takes the
   *  difference back in cash. Keeps its own received/cash-back figures. */
  const setDigitalCashBackAccount = (accountId: string | null) => {
    setTab({
      payment_method: "digital_cash_back",
      digital_account_id: accountId || null,
      customer_id: null,
      expense_person_id: null,
      payments: [{ method: "digital_cash_back", amount: Number(tab.paid || 0) || 0 }],
    });
  };

  /** Amount typed inside the Digital popover — only updates the tender amount. */
  const setDigitalAmount = (value: string) => {
    const rowMethod =
      paymentRows[0]?.method && normalizePaymentMethodValue(tab.payment_method) === "digital"
        ? paymentRows[0].method
        : normalizePaymentMethodValue(accountNameById(tab.digital_account_id ?? null) ?? "digital");
    setTab({
      paid: value,
      payment_method: "digital",
      payments: [{ method: rowMethod, amount: Number(value || 0) || 0 }],
    });
  };

  // Keep cart discount in sync when percentage is typed
  const applyDiscountPct = (pct: string) => {
    const n = Number(pct);
    if (!isFinite(n) || pct === "") {
      setTab({ discount_pct: pct });
      return;
    }
    const newDisc = +Math.max(0, (subtotal * n) / 100).toFixed(2);
    setTab({ discount_pct: pct, discount: newDisc });
  };

  // Extra charge (delivery / service etc.) — % of subtotal or flat amount
  const applyChargePct = (pct: string) => {
    const n = Number(pct);
    if (!isFinite(n) || pct === "") {
      setTab({ charge_pct: pct });
      return;
    }
    const newCharge = +Math.max(0, (subtotal * n) / 100).toFixed(2);
    setTab({ charge_pct: pct, charge: newCharge });
  };

  const addTab = () => {
    const t = newTab(tabs.length + 1);
    setTabs((ts) => [...ts, t]);
    setActive(t.id);
  };
  const closeTab = (id: string) => {
    setTabs((ts) => {
      const next = ts.filter((t) => t.id !== id);
      const fallback = next.length ? next : [newTab(1)];
      if (id === active) setActive(fallback[0].id);
      return fallback;
    });
  };

  // ---- Held bills ----
  const holdBillsEnabled = !!(settings as any)?.ops_hold_bills_enabled;
  const { data: heldBills = [], refetch: refetchHeld } = useQuery({
    queryKey: ["held_bills", "pos"],
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

  const restorePayloadIntoNewTab = (payload: any, labelPrefix = "↺") => {
    if (!payload || !Array.isArray(payload.items)) return;
    const parsedPayments =
      Array.isArray(payload.payments) && payload.payments.length
        ? payload.payments.map((entry: any) => ({
            method: entry.method ?? "cash",
            amount: Number(entry.amount ?? 0),
          }))
        : parsePaymentMethod(payload.payment_method, Number(payload.paid ?? 0));
    const restoredItems: CartItem[] = payload.items.map((i: any) => {
      const qty = Number(i.qty ?? 1);
      const price = Number(i.price ?? 0);
      return {
        product_id: i.product_id ?? null,
        code: i.code ?? "",
        name: String(i.name ?? "Item"),
        qty,
        price,
        mrp: Number(i.mrp ?? price),
        cost: Number(i.cost ?? 0),
        disc_pct: Number(i.disc_pct ?? 0),
        tax_pct: Number(i.tax_pct ?? 0),
        disc: Number(i.disc ?? 0),
      };
    });
    const isEdit = !!payload.editing_sale_id;
    const restored: Tab = {
      id: crypto.randomUUID(),
      name: isEdit
        ? `✎ Edit ${payload.editing_invoice_no ?? payload.label ?? "Invoice"}`
        : `${labelPrefix} ${payload.label ?? "Bill"}`,
      items: restoredItems,
      customer_id: payload.customer_id ?? null,
      expense_person_id: payload.expense_person_id ?? null,
      payment_method: parsedPayments[0]?.method ?? "cash",
      payments: parsedPayments,
      discount: Number(payload.discount ?? 0),
      discount_pct: "",
      charge: Number(payload.charge ?? 0),
      charge_pct: "",
      paid: String(payload.paid ?? ""),
      note: payload.note ?? "",
      restored: !isEdit,
      editing_sale_id: payload.editing_sale_id ?? null,
      editing_invoice_no: payload.editing_invoice_no ?? null,
    };
    setTabs((ts) => [...ts, restored]);
    setActive(restored.id);
  };

  const loadInvoiceForEdit = (sale: any) => {
    if (!sale) return;
    const parsedPayments = parsePaymentMethod(sale.payment_method, Number(sale.paid ?? 0));
    const items: CartItem[] = (sale.sale_items ?? []).map((it: any) => {
      const qty = Number(it.qty ?? 1);
      const price = Number(it.price ?? 0);
      return {
        product_id: it.product_id ?? null,
        code: "",
        name: String(it.name ?? "Item"),
        qty,
        price,
        mrp: price,
        cost: Number(it.cost ?? 0),
        disc_pct: 0,
        tax_pct: 0,
        disc: Math.max(qty * price - Number(it.line_total ?? qty * price), 0),
      };
    });
    const editTab: Tab = {
      id: crypto.randomUUID(),
      name: `✎ Edit ${sale.invoice_no}`,
      items,
      customer_id: sale.customer_id ?? null,
      expense_person_id: sale.expense_person_id ?? null,
      payment_method: parsedPayments[0]?.method ?? "cash",
      payments: parsedPayments,
      discount: Number(sale.discount ?? 0),
      discount_pct: "",
      charge: 0,
      charge_pct: "",
      paid: String(sale.paid ?? ""),
      note: sale.note ?? "",
      editing_sale_id: sale.id,
      editing_invoice_no: sale.invoice_no,
    };
    setTabs((ts) => [...ts, editTab]);
    setActive(editTab.id);
    toast.success(`Editing invoice ${sale.invoice_no}`);
  };

  const openRestoredTab = (payload: any, fallbackInvoiceNo: string) => {
    const parsedPayments = parsePaymentMethod(payload?.payment_method, Number(payload?.paid ?? 0));
    const items: any[] = Array.isArray(payload?.items) ? payload.items : [];
    const restoredItems: CartItem[] = items.map((i: any) => {
      const qty = Number(i.qty ?? 0);
      const price = Number(i.price ?? 0);
      return {
        product_id: i.product_id ?? null,
        code: "",
        name: String(i.name ?? "Item"),
        qty,
        price,
        mrp: price,
        cost: Number(i.cost ?? 0),
        disc_pct: 0,
        tax_pct: 0,
        disc: 0,
      };
    });
    const restored: Tab = {
      id: crypto.randomUUID(),
      name: `↩ ${payload?.invoice_no ?? fallbackInvoiceNo}`,
      items: restoredItems,
      customer_id: payload?.customer_id ?? null,
      expense_person_id: payload?.expense_person_id ?? null,
      payment_method: parsedPayments[0]?.method ?? "cash",
      discount: Number(payload?.discount ?? 0),
      discount_pct: "",
      charge: 0,
      charge_pct: "",
      paid: String(payload?.paid ?? ""),
      payments: parsedPayments,
      note: payload?.note ?? "",
      restored: true,
    };
    setTabs((ts) => [...ts, restored]);
    setActive(restored.id);
  };

  const resumeHeld = async (id: string) => {
    let payload: any = null;
    if (isOfflineNow()) {
      const local = await offlineDb().held_bills.get(id);
      if (!local) return toast.error("Held bill not available offline");
      payload = local.payload;
      await offlineDb().held_bills.put({ ...local, status: "resumed" });
      await enqueueWrite({ op: "rpc", table: "resume_bill", payload: { _id: id } });
    } else {
      const { data, error } = await supabase.rpc("resume_bill", { _id: id });
      if (error) return toast.error(error.message);
      payload = data;
    }
    restorePayloadIntoNewTab(payload as any, "↺");
    setHeldOpen(false);
    refetchHeld();
    toast.success("Bill resumed");
  };

  const discardHeld = async (id: string) => {
    if (!confirm("Discard this held bill?")) return;
    if (isOfflineNow()) {
      await offlineDb().held_bills.delete(id);
      await enqueueWrite({
        op: "rpc",
        table: "discard_held_bill",
        payload: { _id: id, _reason: null },
      });
    } else {
      const { error } = await (supabase.rpc as any)("discard_held_bill", {
        _id: id,
        _reason: null,
      });
      if (error) return toast.error(error.message);
    }
    refetchHeld();
    toast.success("Discarded");
  };

  const holdCurrent = async () => {
    if (!tab.items.length) return toast.error("Cart is empty");
    if (!holdBillsEnabled) return toast.error("Hold bills is disabled in Settings");
    setHolding(true);
    try {
      const payload = {
        items: tab.items,
        customer_id: tab.customer_id,
        expense_person_id: tab.expense_person_id,
        payment_method: tab.payment_method,
        payments: tab.payments,
        discount: Number(tab.discount || 0),
        charge: Number(tab.charge || 0),
        paid: tab.paid,
        note: tab.note,
        label: tab.name,
        editing_sale_id: tab.editing_sale_id ?? null,
        editing_invoice_no: tab.editing_invoice_no ?? null,
      };
      const label = tab.editing_sale_id ? `✎ Edit ${tab.editing_invoice_no ?? tab.name}` : tab.name;
      const args = {
        _customer: tab.customer_id as any,
        _item_count: tab.items.length,
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
          item_count: tab.items.length,
          customer_id: tab.customer_id,
          payload,
          status: "held",
          created_at: new Date().toISOString(),
          _offline_pending: true,
        });
        await enqueueWrite({ op: "rpc", table: "hold_bill", payload: args });
        toast.success("Bill held offline");
      } else {
        const { error } = await supabase.rpc("hold_bill", args);
        if (error) throw error;
        toast.success("Bill held");
      }
      closeTab(active);
      refetchHeld();
    } catch (err: any) {
      toast.error(err.message ?? "Could not hold bill");
    } finally {
      setHolding(false);
    }
  };

  // Pick up a resumed payload handed off from Operations page
  useEffect(() => {
    try {
      const raw = localStorage.getItem("pos:resume_payload");
      if (!raw) return;
      localStorage.removeItem("pos:resume_payload");
      restorePayloadIntoNewTab(JSON.parse(raw), "↺");
      toast.success("Bill resumed");
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSale = async () => {
    if (saleLockRef.current) return; // already submitting — ignore repeat Enter/click
    saleLockRef.current = true;
    setSubmitting(true);
    try {
      await handleSaleInner();
    } finally {
      saleLockRef.current = false;
      setSubmitting(false);
    }
  };

  const handleSaleInner = async () => {
    if (!tab.items.length) return toast.error("Cart is empty");
    if (isDigitalCashBackMode) {
      if (!tab.digital_received_amount || Number(tab.digital_received_amount) <= 0) {
        return toast.error("Enter the amount received in the digital account");
      }
      if (!digitalCashBackSummary.isValid) {
        return toast.error("Digital amount received cannot be less than the sale total");
      }
      if (!tab.digital_account_id) {
        return toast.error("Select a digital account to receive the payment");
      }
    }
    if (isDigitalMode) {
      const hasAccounts = ((cashAccountOptions ?? []) as any[]).some((a: any) => a.type !== "cash");
      if (hasAccounts && !tab.digital_account_id) {
        return toast.error("Select the digital account that received the payment");
      }
      if (Number(tab.paid || 0) <= 0) {
        return toast.error("Enter the digital amount received");
      }
    }
    const isCredit = !isDigitalCashBackMode && due > 0;
    if (isCredit && !tab.customer_id && !tab.expense_person_id)
      return toast.error("Select a customer or a staff/owner for credit sale");
    // Negative-stock guard: block sale if any line would push a non-negative-allowed product below zero.
    // Skip guard when editing an existing invoice — the edit_sale RPC restores original stock before re-decrementing.
    if (tab.editing_sale_id) {
      await doSale();
      return;
    }
    try {
      const ids = Array.from(new Set(tab.items.map((i) => i.product_id).filter(Boolean)));
      if (ids.length) {
        const { data: stockRows } = await supabase
          .from("products")
          .select("id,name,stock,allow_negative_stock" as any)
          .in("id", ids as string[]);
        const byId = new Map((stockRows ?? []).map((r: any) => [r.id, r]));
        const totals = new Map<string, number>();
        for (const it of tab.items) {
          if (!it.product_id) continue;
          totals.set(it.product_id, (totals.get(it.product_id) ?? 0) + Number(it.qty || 0));
        }
        for (const [pid, qty] of totals) {
          const row: any = byId.get(pid);
          if (!row) continue;
          if (row.allow_negative_stock) continue;
          if (Number(row.stock ?? 0) < qty) {
            return toast.error(
              `Insufficient stock for ${row.name} (have ${row.stock}, need ${qty}). Enable "Allow negative stock" on the product to override.`,
            );
          }
        }
      }
    } catch {
      /* if the check itself fails, fall through to sale so we don't block cashiers when offline */
    }
    await doSale();
  };

  const doSale = async () => {
    setSubmitting(true);
    try {
      const paymentAllocations = normalizePaymentAllocations(
        paymentRows,
        tab.payment_method,
        tab.paid,
      );
      const tenderedAmount = +Math.min(
        isDigitalCashBackMode ? total : sumPaymentAllocations(paymentAllocations),
        total,
      ).toFixed(2);
      const paymentMethodLabel = serializePaymentMethod(
        paymentAllocations,
        tab.payment_method || "cash",
        tenderedAmount,
      );
      const items = tab.items.map((i) => ({
        product_id: i.product_id,
        name: i.name,
        qty: i.qty,
        price: i.price,
        cost: i.cost,
      }));

      // ---- Edit existing invoice path ----
      if (tab.editing_sale_id) {
        if (isOfflineNow()) {
          try {
            const saleId = tab.editing_sale_id;
            const nowIso = new Date().toISOString();
            const subtotalEdited = +tab.items
              .reduce((s, i) => s + Number(i.qty) * Number(i.price), 0)
              .toFixed(2);
            const discountEdited = +(lineDiscountTotal + discount - charge).toFixed(2);
            const taxEdited = +Number(tax || 0).toFixed(2);
            const totalEdited = +(subtotalEdited - discountEdited + taxEdited).toFixed(2);
            const paidEdited = +Math.min(paidNum, totalEdited).toFixed(2);

            const existingQueuedCreate = await offlineDb()
              ._queue.where("client_uuid")
              .equals(saleId)
              .first();

            await offlineDb().transaction(
              "rw",
              offlineDb().sales,
              offlineDb().sale_items,
              offlineDb().products,
              async () => {
                const prev = await offlineDb().sales.get(saleId);
                if (!prev) throw new Error("Invoice not available offline");
                const oldItems = await offlineDb()
                  .sale_items.where("sale_id")
                  .equals(saleId)
                  .toArray();

                const oldQtyByProduct = new Map<string, number>();
                const newQtyByProduct = new Map<string, number>();
                for (const it of oldItems) {
                  if (!it.product_id) continue;
                  oldQtyByProduct.set(
                    it.product_id,
                    (oldQtyByProduct.get(it.product_id) ?? 0) + Number(it.qty || 0),
                  );
                }
                for (const it of items) {
                  if (!it.product_id) continue;
                  newQtyByProduct.set(
                    it.product_id,
                    (newQtyByProduct.get(it.product_id) ?? 0) + Number(it.qty || 0),
                  );
                }

                const productIds = new Set<string>([
                  ...oldQtyByProduct.keys(),
                  ...newQtyByProduct.keys(),
                ]);
                for (const pid of productIds) {
                  const p = await offlineDb().products.get(pid);
                  if (!p) continue;
                  const baseStock =
                    typeof p.stock === "number"
                      ? Number(p.stock)
                      : typeof p.stock_qty === "number"
                        ? Number(p.stock_qty)
                        : null;
                  if (baseStock == null) continue;
                  const oldQty = oldQtyByProduct.get(pid) ?? 0;
                  const newQty = newQtyByProduct.get(pid) ?? 0;
                  const nextStock = +(baseStock + oldQty - newQty).toFixed(3);
                  await offlineDb().products.put({
                    ...p,
                    stock: nextStock,
                    ...(typeof p.stock_qty === "number" ? { stock_qty: nextStock } : {}),
                    _sync: "pending",
                    _v: (Number(p._v ?? 0) || 0) + 1,
                    updated_at: nowIso,
                  });
                }

                await offlineDb().sale_items.where("sale_id").equals(saleId).delete();
                const nextItems = items.map((i, idx) => ({
                  id: `${saleId}:${idx}`,
                  sale_id: saleId,
                  tenant_id: prev.tenant_id ?? null,
                  product_id: i.product_id,
                  name: i.name,
                  qty: i.qty,
                  price: i.price,
                  cost: i.cost,
                  _sync: "pending",
                  _v: 1,
                  _deleted: 0,
                }));
                await offlineDb().sale_items.bulkPut(nextItems);

                await offlineDb().sales.put({
                  ...prev,
                  customer_id: tab.customer_id,
                  expense_person_id: tab.expense_person_id,
                  payment_method: paymentMethodLabel,
                  subtotal: subtotalEdited,
                  discount: discountEdited,
                  tax: taxEdited,
                  total: totalEdited,
                  paid: paidEdited,
                  status: paidEdited >= totalEdited ? "completed" : "credit",
                  note: tab.note,
                  updated_at: nowIso,
                  _sync: "pending",
                  _offline_pending: true,
                  _v: (Number(prev._v ?? 0) || 0) + 1,
                  sale_items: nextItems,
                });
              },
            );

            if (existingQueuedCreate?.table === "complete_sale") {
              const queuedPayload = (existingQueuedCreate as any).payload?.payload ?? {};
              await offlineDb()._queue.update(existingQueuedCreate.id!, {
                payload: {
                  payload: {
                    ...queuedPayload,
                    customer_id: tab.customer_id,
                    expense_person_id: tab.expense_person_id,
                    payment_method: paymentMethodLabel,
                    tax: taxEdited,
                    discount: discountEdited,
                    paid: paidEdited,
                    note: tab.note,
                    items,
                  },
                },
                status: "pending",
                next_attempt_at: null,
              });
            } else {
              await enqueueWrite({
                op: "rpc",
                table: "edit_sale",
                client_uuid: `edit-${saleId}-${Date.now()}`,
                payload: {
                  _sale_id: saleId,
                  _items: items as any,
                  _paid: paidEdited,
                  _discount: discountEdited,
                  _tax: taxEdited,
                },
              });
            }

            toast.success(
              `Invoice ${tab.editing_invoice_no ?? ""} updated offline — will sync automatically`,
            );
            closeTab(active);
            qc.invalidateQueries({ queryKey: ["products"] });
            qc.invalidateQueries({ queryKey: ["sales"] });
            qc.invalidateQueries({ queryKey: ["customers"] });
            qc.invalidateQueries({ queryKey: ["expenses"] });
            qc.invalidateQueries({ queryKey: ["expense_persons"] });
            refetchHeld?.();
          } catch (e: any) {
            toast.error(e?.message ?? "Could not update invoice offline");
          }
          return;
        }

        const { error } = await supabase.rpc("edit_sale", {
          _sale_id: tab.editing_sale_id,
          _items: items as any,
          // Header figures the cashier just corrected (paid amount, discount, tax).
          _paid: +Math.min(paidNum, total).toFixed(2),
          _discount: +(lineDiscountTotal + discount - charge).toFixed(2),
          _tax: +Number(tax || 0).toFixed(2),
        } as any);
        if (error) throw error;
        // Also update lightweight header fields (customer / payment / note)
        // that the RPC does not touch, so the cashier's edits stick.
        try {
          await supabase
            .from("sales")
            .update({
              customer_id: tab.customer_id,
              payment_method: paymentMethodLabel,
              note: tab.note,
            })
            .eq("id", tab.editing_sale_id);
        } catch {
          /* non-fatal */
        }
        toast.success(`Invoice ${tab.editing_invoice_no ?? ""} updated`);
        closeTab(active);
        qc.invalidateQueries({ queryKey: ["products"] });
        qc.invalidateQueries({ queryKey: ["sales"] });
        qc.invalidateQueries({ queryKey: ["customers"] });
        qc.invalidateQueries({ queryKey: ["expenses"] });
        qc.invalidateQueries({ queryKey: ["expense_persons"] });
        refetchHeld?.();
        return;
      }

      const payload = {
        customer_id: tab.customer_id,
        expense_person_id: tab.expense_person_id,
        payment_method: paymentMethodLabel,
        tax,
        digital_cash_back_mode: isDigitalCashBackMode,
        digital_received_amount: isDigitalCashBackMode
          ? Number(tab.digital_received_amount || 0)
          : null,
        digital_account_id: isDigitalCashBackMode ? tab.digital_account_id : null,
        cash_back_amount: isDigitalCashBackMode ? digitalCashBackAmount : 0,
        // Combine per-line discounts with cart-level discount so they reach the ledger.
        // Extra charge is applied as a negative discount so the server total matches.
        discount: +(lineDiscountTotal + discount - charge).toFixed(2),
        // Change (extra tendered cash) is never recorded — only the bill amount is.
        paid: tenderedAmount,
        note: tab.note,
        items: tab.items.map((i) => ({
          product_id: i.product_id,
          name: i.name,
          qty: i.qty,
          price: i.price,
          cost: i.cost,
        })),
      };

      // Audit-only breakdown: stored on the local record when offline, never
      // sent to the server (the RPC derives its own totals from `payload`).
      const taxBuckets = new Map<number, number>();
      for (const i of tab.items) {
        const rate = Number(i.tax_pct || 0);
        if (!rate) continue;
        const base = Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0);
        taxBuckets.set(rate, +((taxBuckets.get(rate) ?? 0) + (base * rate) / 100).toFixed(2));
      }
      const { sale, offline } = await completeSaleOfflineAware(payload as any, {
        charge,
        line_discount_total: lineDiscountTotal,
        bill_discount: discount,
        tax_breakdown: Array.from(taxBuckets, ([rate, amount]) => ({ rate, amount })),
        payments: paymentAllocations.map((entry) => ({
          method: entry.method,
          amount: +Number(entry.amount ?? 0).toFixed(2),
        })),
        tendered: tenderedAmount,
        change_due: change,
      });

      // Override server sale_items with the cashier's edited prices so the
      // printed receipt reflects any rate changes made in the cart.
      const localItems = tab.items.map((i, idx) => ({
        id: `local-${idx}`,
        name: i.name,
        qty: i.qty,
        price: i.price,
        line_total: Math.max(Number(i.qty) * Number(i.price) - Number(i.disc || 0), 0),
      }));
      // Receipt shows the real tendered amount + change; the ledger keeps only the bill amount.
      const patchedSale = sale
        ? {
            ...sale,
            sale_items: localItems,
            discount: +(lineDiscountTotal + discount).toFixed(2),
            charge: +charge.toFixed(2),
            paid: +tenderedAmount.toFixed(2),
            change_due: +change.toFixed(2),
          }
        : sale;
      setLastInvoice(patchedSale);
      if (patchedSale?.id) {
        setUndoCandidate({
          sale_id: patchedSale.id,
          invoice_no: patchedSale.invoice_no,
          total: Number(patchedSale.total ?? 0),
          item_count: localItems.length,
          created_at: patchedSale.created_at,
        });
      }

      toast.success(
        offline
          ? `Sale ${patchedSale?.invoice_no} saved offline — will sync when online`
          : `Sale ${patchedSale?.invoice_no} saved`,
        {
          action: { label: "Print", onClick: () => printInvoiceDirect(patchedSale, settings) },
          duration: 5000,
        },
      );
      closeTab(active);
      // restored badge is cleared implicitly since tab is closed
      void 0;
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
      qc.invalidateQueries({ queryKey: ["expense_persons"] });

      // Post-sale print behaviour, configurable in Settings.
      const printPromptEnabled = (settings as any)?.pos_print_prompt_enabled === true;
      const printDefault = "no";
      if (printPromptEnabled) {
        setPrintAsk(patchedSale);
      } else if (patchedSale) {
        // If prompt is disabled, follow the explicit default.
        // Since we now hardcode default to "no", it only prints if explicitly enabled.
        // But for clarity, we keep the logic structure.
        setTimeout(() => searchRef.current?.focus(), 50);
      } else {
        setTimeout(() => searchRef.current?.focus(), 50);
      }
    } catch (err: any) {
      toast.error(err.message ?? "Failed to complete sale");
    } finally {
      setSubmitting(false);
    }
  };

  // Live "elapsed since last sale" ticker so the undo dialog counts down.
  useEffect(() => {
    if (!undoCandidate) return;
    const id = window.setInterval(() => setUndoTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [undoCandidate]);

  const undoAgeSeconds = undoCandidate
    ? Math.max(0, Math.floor((Date.now() - new Date(undoCandidate.created_at).getTime()) / 1000))
    : 0;
  const undoExpired = undoCandidate ? undoAgeSeconds > undoWindowMin * 60 : true;
  // Reference undoTick so the expiry recomputes each second.
  void undoTick;

  const attemptUndo = () => {
    if (!undoCandidate) {
      toast.error("No recent sale to undo");
      return;
    }
    if (undoExpired) {
      toast.error(`Undo window (${undoWindowMin} min) has expired`);
      setUndoCandidate(null);
      return;
    }
    setUndoOpen(true);
  };

  const confirmUndo = async () => {
    if (!undoCandidate) return;
    setUndoing(true);
    try {
      let payload: any;
      if (isOfflineNow()) {
        const nowIso = new Date().toISOString();
        const sale = await offlineDb().sales.get(undoCandidate.sale_id);
        if (!sale) throw new Error("Sale not available offline");
        const saleItems = await offlineDb()
          .sale_items.where("sale_id")
          .equals(undoCandidate.sale_id)
          .toArray();

        await offlineDb().transaction(
          "rw",
          offlineDb().sales,
          offlineDb().sale_items,
          offlineDb().products,
          async () => {
            for (const it of saleItems) {
              if (!it.product_id) continue;
              const p = await offlineDb().products.get(it.product_id);
              if (!p) continue;
              const baseStock =
                typeof p.stock === "number"
                  ? Number(p.stock)
                  : typeof p.stock_qty === "number"
                    ? Number(p.stock_qty)
                    : null;
              if (baseStock == null) continue;
              const nextStock = +(baseStock + Number(it.qty || 0)).toFixed(3);
              await offlineDb().products.put({
                ...p,
                stock: nextStock,
                ...(typeof p.stock_qty === "number" ? { stock_qty: nextStock } : {}),
                _sync: "pending",
                _v: (Number(p._v ?? 0) || 0) + 1,
                updated_at: nowIso,
              });
            }
            await offlineDb().sale_items.where("sale_id").equals(undoCandidate.sale_id).delete();
            await offlineDb().sales.delete(undoCandidate.sale_id);
          },
        );

        // If this sale was never synced, remove its queued create/edit actions.
        const queueRows = await offlineDb()._queue.toArray();
        const createRow = queueRows.find(
          (r: any) => r.client_uuid === undoCandidate.sale_id && r.table === "complete_sale",
        );
        const relatedEditRows = queueRows.filter(
          (r: any) => r.table === "edit_sale" && r.payload?._sale_id === undoCandidate.sale_id,
        );
        if (createRow?.id != null) await offlineDb()._queue.delete(createRow.id);
        for (const row of relatedEditRows) {
          if (row.id != null) await offlineDb()._queue.delete(row.id);
        }

        // If the sale exists in cloud, queue server-side undo too.
        if (!createRow) {
          await enqueueWrite({
            op: "rpc",
            table: "undo_last_sale",
            client_uuid: `undo-${undoCandidate.sale_id}-${Date.now()}`,
            payload: { _sale_id: undoCandidate.sale_id },
          });
        }

        payload = {
          invoice_no: sale.invoice_no,
          customer_id: sale.customer_id,
          expense_person_id: sale.expense_person_id,
          payment_method: sale.payment_method,
          discount: sale.discount,
          paid: sale.paid,
          note: sale.note,
          items: saleItems.map((i: any) => ({
            product_id: i.product_id ?? null,
            name: i.name,
            qty: Number(i.qty ?? 0),
            price: Number(i.price ?? 0),
            cost: Number(i.cost ?? 0),
          })),
        };
      } else {
        const { data, error } = await (supabase.rpc as any)("undo_last_sale", {
          _sale_id: undoCandidate.sale_id,
        });
        if (error) throw error;
        payload = data ?? {};
      }

      openRestoredTab(payload, undoCandidate.invoice_no);

      // Log undo reason to audit_logs (best-effort; ignore error)
      const reasonText = undoReason === "Other" ? undoReasonNote.trim() || "Other" : undoReason;
      try {
        if (!isOfflineNow()) {
          await supabase.from("audit_logs").insert({
            action: "undo_last_sale.reason",
            entity: "sales",
            entity_id: undoCandidate.sale_id,
            details: {
              invoice_no: payload.invoice_no ?? undoCandidate.invoice_no,
              reason: reasonText,
            },
          } as any);
        }
      } catch {
        /* noop */
      }

      toast.success(
        `✓ Sale ${payload.invoice_no ?? undoCandidate.invoice_no} restored successfully`,
      );
      setUndoCandidate(null);
      setUndoOpen(false);
      setUndoReason(UNDO_REASONS[0]);
      setUndoReasonNote("");
      qc.invalidateQueries({ queryKey: ["products"] });
      qc.invalidateQueries({ queryKey: ["sales"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to undo sale");
    } finally {
      setUndoing(false);
    }
  };

  // Radix Dialog/Select sometimes leaves `pointer-events: none` on <body> after
  // closing quickly, freezing the entire page to mouse input. Clear it whenever
  // no overlay is actually open.
  useEffect(() => {
    const clearStuck = () => {
      const hasOverlay = document.querySelector(
        '[role="dialog"][data-state="open"], [role="listbox"][data-state="open"], [data-radix-popper-content-wrapper]',
      );
      if (!hasOverlay && document.body.style.pointerEvents === "none") {
        document.body.style.pointerEvents = "";
      }
    };
    const id = window.setInterval(clearStuck, 300);
    return () => window.clearInterval(id);
  }, []);

  // F2 add tab, F4 complete, and keep scanner/manual typing routed to search by default.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inDialog = !!target?.closest('[role="dialog"]');
      const selectOpen = !!document.querySelector('[role="listbox"]');
      const isSearchInput = target === searchRef.current;
      const isEditableTarget =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        !!target?.isContentEditable;

      if (e.key === "F2") {
        e.preventDefault();
        e.stopPropagation();
        addTab();
        setSearch("");
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (e.key === "F3") {
        e.preventDefault();
        e.stopPropagation();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (e.key === "F4" && !inDialog) {
        e.preventDefault();
        handleSale();
        return;
      }

      // Ctrl+Z or F10 → undo last sale by current cashier (if still within window).
      const isUndoShortcut =
        e.key === "F10" ||
        ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "z" || e.key === "Z"));
      if (isUndoShortcut && !inDialog) {
        e.preventDefault();
        e.stopPropagation();
        attemptUndo();
        return;
      }

      if (
        inDialog ||
        selectOpen ||
        editing ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        isSearchInput ||
        isEditableTarget
      )
        return;

      if (e.key.length === 1) {
        e.preventDefault();
        searchRef.current?.focus();
        setSearch((s) => `${s}${e.key}`);
        return;
      }

      if (e.key === "Backspace" && search) {
        e.preventDefault();
        searchRef.current?.focus();
        setSearch((s) => s.slice(0, -1));
        return;
      }

      if (e.key === "Escape" && search) {
        e.preventDefault();
        setSearch("");
        searchRef.current?.focus();
        return;
      }

      if (e.key === "Enter" && search.trim()) {
        e.preventDefault();
        const raw = search.trim();
        const exact = productByBarcode[raw];
        if (exact) {
          addProduct(exact);
          setSearch("");
          triggerScanFlash();
          searchRef.current?.focus();
          return;
        }
        if (filtered.length >= 1) {
          const pick = filtered[Math.min(highlight, filtered.length - 1)] ?? filtered[0];
          addProduct(pick);
          setSearch("");
          searchRef.current?.focus();
          return;
        }
        openQuickAdd(raw);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div className="min-h-full md:h-full flex flex-col md:overflow-hidden">
      <ShiftBanner />
      {/* Top strip — open bills + clock + reprint (jahaan se sidebar khulti hai us patti ke saath) */}
      <div className="flex items-center gap-2 px-2 py-1 border-b bg-card/60 no-print shrink-0">
        <ScrollArea className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.id}
                onClick={() => setActive(t.id)}
                className={`group flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs whitespace-nowrap ${
                  t.id === active
                    ? "bg-background border-primary/40"
                    : "bg-muted/40 text-muted-foreground hover:bg-muted"
                }`}
              >
                <ShoppingCart className="h-3 w-3" />
                <span>{t.name}</span>
                {t.items.length > 0 && (
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {t.items.length}
                  </Badge>
                )}
                <span
                  role="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeTab(t.id);
                  }}
                  className="ml-0.5 rounded p-0.5 opacity-60 hover:opacity-100 hover:bg-destructive/20"
                >
                  <X className="h-3 w-3" />
                </span>
              </button>
            ))}
            <Button size="sm" variant="ghost" onClick={addTab} className="h-7 px-2 text-xs">
              <Plus className="h-3.5 w-3.5 mr-0.5" /> New (F2)
            </Button>
          </div>
        </ScrollArea>
        <div className="hidden sm:flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 text-[11px] font-mono tabular-nums shrink-0">
          <Clock className="h-3 w-3 text-muted-foreground" />
          <span>{now.toLocaleTimeString()}</span>
        </div>
        {holdBillsEnabled && (
          <>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={holdCurrent}
              disabled={holding || !tab.items.length}
              title="Hold current bill (park cart)"
            >
              <PauseCircle className="h-3.5 w-3.5 mr-1" /> Hold
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs shrink-0"
              onClick={() => setHeldOpen(true)}
              title="Resume a held bill"
            >
              <Play className="h-3.5 w-3.5 mr-1" /> Held
              {heldBills.length > 0 && (
                <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                  {heldBills.length}
                </Badge>
              )}
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs shrink-0"
          onClick={() => setReprintOpen(true)}
        >
          <History className="h-3.5 w-3.5 mr-1" /> Reprint
        </Button>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* LEFT: items area (maximised) */}
        <main className="relative flex-1 flex flex-col min-h-[55vh] md:min-h-0 bg-background overflow-hidden">
          <div className="relative flex items-center gap-3 px-4 py-3 border-b bg-card no-print">
            {/* Search / scan */}
            <div className="relative flex-1 min-w-0 max-w-[560px]">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <Input
                ref={searchRef}
                autoFocus
                placeholder="🔍  Scan barcode or search product…  (F3)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    setSearch("");
                    setCartCursor(-1);
                    return;
                  }
                  const raw = search.trim();
                  // When search has text, arrows navigate the search results popup
                  if (raw && e.key === "ArrowDown" && filtered.length) {
                    e.preventDefault();
                    kbNavRef.current = true;
                    setHighlight((h) => Math.min(h + 1, filtered.length - 1));
                    return;
                  }
                  if (raw && e.key === "ArrowUp" && filtered.length) {
                    e.preventDefault();
                    kbNavRef.current = true;
                    setHighlight((h) => Math.max(h - 1, 0));
                    return;
                  }

                  // When search is empty, arrows move the cart line cursor (clamped, no wrap)
                  if (!raw && (e.key === "ArrowDown" || e.key === "ArrowUp") && tab.items.length) {
                    e.preventDefault();
                    setCartCursor((c) => {
                      const n = tab.items.length;
                      if (e.key === "ArrowDown") {
                        if (c < 0) return 0;
                        return Math.min(n - 1, c + 1);
                      }
                      // ArrowUp
                      if (c < 0) return n - 1;
                      return Math.max(0, c - 1);
                    });
                    return;
                  }
                  if (!raw && e.key === "Home" && tab.items.length) {
                    e.preventDefault();
                    setCartCursor(0);
                    return;
                  }
                  if (!raw && e.key === "End" && tab.items.length) {
                    e.preventDefault();
                    setCartCursor(tab.items.length - 1);
                    return;
                  }
                  if (
                    !raw &&
                    (e.key === "Delete" || (e.key === "Backspace" && cartCursor >= 0)) &&
                    cartCursor >= 0 &&
                    cartCursor < tab.items.length
                  ) {
                    e.preventDefault();
                    const idx = cartCursor;
                    removeLine(idx);
                    setCartCursor((c) => Math.min(c, tab.items.length - 2));
                    return;
                  }
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  if (!raw) {
                    // Enter on a highlighted cart row → edit qty
                    if (cartCursor >= 0 && cartCursor < tab.items.length) {
                      const idx = cartCursor;
                      setTimeout(() => setEditing({ idx, field: "qty" }), 0);
                      return;
                    }
                    // Empty search + items in cart → jump to Paid field (Enter there completes sale)
                    if (tab.items.length > 0) {
                      setTimeout(() => {
                        paidRef.current?.focus();
                        paidRef.current?.select();
                      }, 0);
                    }
                    return;
                  }
                  const exact = productByBarcode[raw];
                  if (exact) {
                    addProduct(exact);
                    setSearch("");
                    triggerScanFlash();
                    return;
                  }
                  if (filtered.length >= 1) {
                    const pick = filtered[Math.min(highlight, filtered.length - 1)] ?? filtered[0];
                    addProduct(pick);
                    setSearch("");
                    return;
                  }
                  openQuickAdd(raw);
                }}
                className={`pl-12 h-14 text-base rounded-xl border-2 shadow-sm transition-all duration-300 ${
                  scanFlash
                    ? "border-success ring-4 ring-success/30 bg-success/5"
                    : "focus:border-primary"
                }`}
              />
            </div>
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <ShoppingCart className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm font-semibold truncate">{tab.name}</span>
              <Badge variant="secondary" className="h-5 px-1.5 text-[11px] shrink-0">
                {tab.items.length} item{tab.items.length === 1 ? "" : "s"}
              </Badge>
              {tab.editing_sale_id && (
                <Badge className="bg-primary/15 text-primary border border-primary/30 text-[11px] shrink-0 rounded-full">
                  <Pencil className="h-3 w-3 mr-1" /> EDITING {tab.editing_invoice_no ?? ""}
                </Badge>
              )}
              {tab.restored && !tab.editing_sale_id && (
                <Badge className="bg-warning text-warning-foreground text-[11px] shrink-0 rounded-full">
                  ↩ RESTORED SALE
                </Badge>
              )}
              {tab.expense_person_id && (
                <Badge
                  variant="outline"
                  className="border-warning text-warning text-[11px] shrink-0"
                >
                  Staff purchase
                </Badge>
              )}
            </div>
            <Button
              size="sm"
              variant={showCost ? "secondary" : "ghost"}
              className="h-9 text-xs shrink-0"
              onClick={() => setShowCost((v) => !v)}
            >
              {showCost ? (
                <EyeOff className="h-3.5 w-3.5 mr-1" />
              ) : (
                <Eye className="h-3.5 w-3.5 mr-1" />
              )}
              {showCost ? "Hide" : "Show"} P.Rate
            </Button>
          </div>

          {/* Item-wise detailed table — FAST SALES style spreadsheet */}
          <div className="flex-1 min-h-0 overflow-auto bg-white dark:bg-background">
            <table className="w-full text-sm border-collapse [&_td]:border [&_th]:border [&_td]:border-border [&_th]:border-border">
              <thead className="sticky top-0 z-10 bg-primary text-primary-foreground text-[11px] uppercase tracking-wide">
                <tr>
                  <th className="px-2 py-2 text-left w-16">Item No</th>
                  <th className="px-2 py-2 text-left">Item Name</th>
                  <th className="px-2 py-2 text-right w-20">Stock</th>
                  {showCost && (
                    <th
                      className="px-2 py-2 text-right w-24 no-print"
                      title="Purchase rate (internal)"
                    >
                      P.Rate
                    </th>
                  )}
                  <th className="px-2 py-2 text-right w-32">Unit Rate</th>
                  <th className="px-2 py-2 text-right w-28">QTY</th>
                  <th className="px-2 py-2 text-right w-32">Discount</th>
                  <th className="px-2 py-2 text-right w-36">Amount</th>
                  <th className="px-2 py-2 w-8 no-print"></th>
                </tr>
              </thead>
              <tbody>
                {tab.items.length === 0 && !search.trim() && (
                  <tr>
                    <td colSpan={showCost ? 9 : 8} className="border-0 py-14">
                      <div className="mx-auto max-w-md flex flex-col items-center gap-4 text-center animate-in fade-in duration-300">
                        <div className="h-20 w-20 rounded-2xl bg-primary/10 flex items-center justify-center text-4xl">
                          📦
                        </div>
                        <div>
                          <div className="text-lg font-semibold">Ready to start</div>
                          <div className="text-sm text-muted-foreground mt-1">
                            Scan a barcode or search a product to add to this bill.
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-2">
                          <Kbd label="F2" hint="New bill" />
                          <Kbd label="F3" hint="Search" />
                          <Kbd label="F4" hint="Complete sale" />
                          <Kbd label="F10" hint="Undo last sale" />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {tab.items.map((it, idx) => {
                  const gross = Number(it.qty) * Number(it.price);
                  const lineDisc = Number(it.disc || 0);
                  const net = Math.max(gross - lineDisc, 0);
                  const amount = net;
                  const zebra =
                    idx % 2 === 0
                      ? "bg-amber-50/60 dark:bg-muted/20"
                      : "bg-white dark:bg-background";
                  const p = it.product_id ? (productById[it.product_id] ?? null) : null;
                  const bcs = p ? (barcodesByProduct[p.id] ?? []) : [];
                  const displayCode = it.code || (p ? itemCodeForProduct(p) : "");
                  const subline = p
                    ? [bcs[0] ? `BC ${bcs[0]}` : null, p.category || null]
                        .filter(Boolean)
                        .join(" · ")
                    : "";
                  const stockNum = p ? Number(p.stock ?? 0) : null;
                  const isCursor = idx === cartCursor;
                  return (
                    <tr
                      key={idx}
                      ref={(el) => {
                        cartRowRefs.current[idx] = el;
                      }}
                      onClick={() => setCartCursor(idx)}
                      className={`${zebra} hover:bg-amber-100/60 dark:hover:bg-muted/40 ${isCursor ? "ring-2 ring-inset ring-primary bg-primary/5" : ""}`}
                    >
                      <td className="px-2 py-1 font-mono text-xs">{displayCode || "—"}</td>
                      <td className="px-2 py-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="font-medium text-sm truncate min-w-0 flex-1">
                            {it.name}
                          </div>
                        </div>
                        {subline && (
                          <div className="text-[11px] text-muted-foreground truncate">
                            {subline}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">
                        {stockNum !== null ? (
                          <span
                            className={`text-sm font-semibold ${stockNum > 0 ? "text-foreground" : "text-destructive"}`}
                          >
                            {fmtQty(stockNum)}
                            {p?.unit ? (
                              <span className="text-[10px] text-muted-foreground ml-0.5">
                                {p.unit}
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {showCost && (
                        <td className="px-2 py-1 text-right font-mono text-muted-foreground no-print">
                          {fmtMoney(it.cost, sym)}
                        </td>
                      )}
                      <td className="p-0">
                        <EditableNumCell
                          active={editing?.idx === idx && editing.field === "price"}
                          value={it.price}
                          step="0.01"
                          display={fmtMoney(it.price, sym)}
                          onActivate={() => setEditing({ idx, field: "price" })}
                          onCommit={(v) => {
                            updateLine(idx, { price: v });
                            setEditing(null);
                            searchRef.current?.focus();
                          }}
                          onCancel={() => {
                            setEditing(null);
                            searchRef.current?.focus();
                          }}
                        />
                      </td>
                      <td className="p-0">
                        <EditableNumCell
                          active={editing?.idx === idx && editing.field === "qty"}
                          value={it.qty}
                          step="0.001"
                          display={fmtQty(it.qty)}
                          onActivate={() => setEditing({ idx, field: "qty" })}
                          onCommit={(v) => {
                            updateLine(idx, { qty: v });
                            setEditing(null);
                            setCartCursor(-1);
                            setTimeout(() => searchRef.current?.focus(), 0);
                          }}
                          onCancel={() => {
                            setEditing(null);
                            setCartCursor(-1);
                            setTimeout(() => searchRef.current?.focus(), 0);
                          }}
                        />
                      </td>
                      <td className="p-0">
                        <EditableNumCell
                          active={editing?.idx === idx && editing.field === "disc"}
                          value={it.disc}
                          step="0.01"
                          min={0}
                          display={fmtMoney(it.disc, sym)}
                          onActivate={() => setEditing({ idx, field: "disc" })}
                          onCommit={(v) => {
                            updateLine(idx, { disc: Math.max(0, v) });
                            setEditing(null);
                            searchRef.current?.focus();
                          }}
                          onCancel={() => {
                            setEditing(null);
                            searchRef.current?.focus();
                          }}
                        />
                      </td>
                      <td className="px-2 py-1 text-right font-semibold tabular-nums">
                        {fmtMoney(amount, sym)}
                      </td>
                      <td className="px-1 py-1 text-center no-print border-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => removeLine(idx)}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Floating search results — popup under the search header, fit to header */}
          {search.trim() && (
            <div className="absolute left-4 right-4 top-[64px] z-40 rounded-xl border border-primary/30 bg-card shadow-2xl overflow-hidden">
              <div className="max-h-[60vh] overflow-auto">
                {filtered.length > 0 ? (
                  <table className="w-full text-sm border-collapse">
                    <thead className="sticky top-0 z-10 bg-primary text-primary-foreground text-[11px] uppercase tracking-wide">
                      <tr>
                        <th className="px-2 py-2 text-left w-24">Code</th>
                        <th className="px-2 py-2 text-left">Item Name</th>
                        <th className="px-2 py-2 text-right w-20">Stock</th>
                        {showCost && <th className="px-2 py-2 text-right w-24">P.Rate</th>}
                        <th className="px-2 py-2 text-right w-28">Rate</th>
                        <th className="px-2 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((p, i) => {
                        const rate = Number(p.sell_price ?? 0);
                        const pRate = Number(p.cost_price ?? 0);
                        const code = itemCodeForProduct(p) || "—";
                        const bcs = barcodesByProduct[p.id] ?? [];
                        const subline = [bcs[0] ? `BC ${bcs[0]}` : null, p.category || null]
                          .filter(Boolean)
                          .join(" · ");
                        const stockNum = Number(p.stock ?? 0);
                        const isHi = i === highlight;
                        return (
                          <tr
                            key={`search-${p.id}`}
                            ref={(el) => {
                              searchRowRefs.current[i] = el;
                            }}
                            onMouseMove={() => {
                              kbNavRef.current = false;
                              setHighlight(i);
                            }}
                            onClick={() => {
                              addProduct(p);
                              setSearch("");
                            }}
                            className={`cursor-pointer border-b border-border ${isHi ? "bg-primary/15" : "bg-sky-50/60 dark:bg-sky-950/20 hover:bg-primary/10"}`}
                          >
                            <td className="px-2 py-1.5 font-mono text-xs">{code}</td>
                            <td className="px-2 py-1.5">
                              <div className="font-medium text-sm truncate">{p.name}</div>
                              {subline && (
                                <div className="text-[11px] text-muted-foreground truncate">
                                  {subline}
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right tabular-nums">
                              <span
                                className={`text-sm font-semibold ${stockNum > 0 ? "text-foreground" : "text-destructive"}`}
                              >
                                {fmtQty(stockNum)}
                                {p.unit ? (
                                  <span className="text-[10px] text-muted-foreground ml-0.5">
                                    {p.unit}
                                  </span>
                                ) : null}
                              </span>
                            </td>
                            {showCost && (
                              <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                                {fmtMoney(pRate, sym)}
                              </td>
                            )}
                            <td className="px-2 py-1.5 text-right tabular-nums text-sm font-semibold">
                              {fmtMoney(rate, sym)}
                            </td>
                            <td className="px-1 py-1 text-center">
                              <Plus className="h-3.5 w-3.5 mx-auto text-primary" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="text-center py-6">
                    {productsLoading || remoteProductsLoading ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground text-sm">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading products…
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">No match for "{search}".</span>
                        <Button size="sm" onClick={() => openQuickAdd(search)}>
                          <Plus className="h-4 w-4 mr-1" /> Add
                        </Button>
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT: side panel — open bills, party, payment, totals */}
        <aside className="w-full md:w-[320px] lg:w-[360px] xl:w-[380px] shrink-0 border-t md:border-t-0 md:border-l bg-card flex flex-col min-h-0 max-h-[70vh] md:max-h-[calc(100vh-8.5rem)] overflow-hidden no-print">
          {/* Party + payment */}
          <div className="p-2.5 border-b space-y-2 shrink-0">
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Customer
                </Label>
                {tab.customer_id && (
                  <Link
                    to="/customers/$id"
                    params={{ id: tab.customer_id }}
                    className="text-xs text-primary hover:underline"
                  >
                    View ledger →
                  </Link>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1">
                <Select
                  value={tab.customer_id ?? "walkin"}
                  onValueChange={(v) => {
                    const isWalkin = v === "walkin";
                    setTab({
                      customer_id: isWalkin ? null : v,
                      payment_method: isWalkin ? "cash" : "credit",
                      expense_person_id: null,
                    });
                    setTimeout(() => searchRef.current?.focus(), 0);
                  }}
                >
                  <SelectTrigger className="h-9 flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="walkin">Walk-in customer</SelectItem>
                    {customers.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} {Number(c.balance) > 0 ? `· owes ${fmtMoney(c.balance, sym)}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 w-9 shrink-0"
                  title="Quick add customer"
                  onClick={() => setQuickAddCustomerOpen(true)}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              {(() => {
                const c = tab.customer_id
                  ? customers.find((x: any) => x.id === tab.customer_id)
                  : null;
                const bal = c ? Number(c.balance ?? 0) : 0;
                if (!c) return null;
                return (
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {tab.payment_method === "credit" && (
                      <Badge className="bg-warning text-warning-foreground text-[10px] rounded-full px-2">
                        CREDIT
                      </Badge>
                    )}
                    {bal > 0 && (
                      <Badge variant="outline" className="border-warning text-warning text-[11px]">
                        Previous balance: {fmtMoney(bal, sym)}
                      </Badge>
                    )}
                  </div>
                );
              })()}
            </div>

            {(showStaff || tab.expense_person_id) && (
              <div>
                <Label className="text-xs text-muted-foreground">Staff / Owner purchase</Label>
                <Select
                  value={tab.expense_person_id ?? "none"}
                  onValueChange={(v) => {
                    const isStaff = v !== "none";
                    setTab({
                      expense_person_id: isStaff ? v : null,
                      customer_id: null,
                      payment_method: isStaff ? "staff" : "cash",
                    });
                    if (!isStaff) setShowStaff(false);
                    setTimeout(() => searchRef.current?.focus(), 0);
                  }}
                >
                  <SelectTrigger
                    className={`h-9 mt-1 ${tab.expense_person_id ? "border-warning ring-1 ring-warning/40" : ""}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">— Not staff purchase —</SelectItem>
                    {persons.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} {p.role ? `· ${p.role}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Payment
                </Label>
                <Button
                  type="button"
                  size="sm"
                  variant={tab.expense_person_id ? "secondary" : "ghost"}
                  className="h-6 text-[11px] px-2"
                  title="Charge this bill to a staff/owner expense ledger"
                  onClick={() => {
                    if (tab.expense_person_id) {
                      setTab({ expense_person_id: null, payment_method: "cash" });
                    } else {
                      setTab({ expense_person_id: null }); // trigger dropdown show
                      setShowStaff(true);
                    }
                    setTimeout(() => searchRef.current?.focus(), 0);
                  }}
                >
                  <UserCog className="h-3.5 w-3.5 mr-1" /> Staff
                </Button>
              </div>
              <PaymentMethodGrid
                value={tab.payment_method}
                onChange={(v) => {
                  setPrimaryPaymentMethod(v);
                  setTimeout(() => searchRef.current?.focus(), 0);
                }}
                sym={sym}
                total={total}
                due={due}
                digitalAccountId={tab.digital_account_id ?? null}
                digitalAmount={tab.paid ?? ""}
                onSelectDigitalAccount={setDigitalAccount}
                onDigitalAmountChange={setDigitalAmount}
                cashBackReceived={tab.digital_received_amount ?? ""}
                cashBackAmount={digitalCashBackAmount}
                onSelectCashBackAccount={setDigitalCashBackAccount}
                onCashBackReceivedChange={(v) => setTab({ digital_received_amount: v })}
              />
              <div className="mt-2 flex items-center justify-between">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Tender
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[11px]"
                  onClick={addPaymentRow}
                >
                  <Plus className="h-3.5 w-3.5 mr-1" /> Split
                </Button>
              </div>
              <div className="mt-1 space-y-1.5">
                {paymentRows.map((payment, idx) => (
                  <div key={`${payment.method}-${idx}`} className="flex items-center gap-1.5">
                    <PaymentMethodSelect
                      value={payment.method}
                      onChange={(v) => {
                        const normalized = normalizePaymentMethodValue(v);
                        if (isDigitalCashBackMode && idx === 0) {
                          updatePaymentRow(idx, { method: "digital_cash_back" });
                          return;
                        }
                        updatePaymentRow(idx, { method: normalized });
                      }}
                      className="h-8 flex-1"
                    />
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={payment.amount}
                      onChange={(e) =>
                        updatePaymentRow(idx, { amount: Number(e.target.value || 0) })
                      }
                      className="h-8 w-24 text-right text-sm"
                    />
                    {paymentRows.length > 1 && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removePaymentRow(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Totals + discount + paid + note */}
          <div className="flex-1 min-h-0 overflow-auto p-2 space-y-1 bg-muted/10 flex flex-col">
            <Row
              label="Items"
              value={`${tab.items.length} item${tab.items.length === 1 ? "" : "s"}`}
              muted
            />
            <Row label="Subtotal" value={fmtMoney(subtotal, sym)} muted />
            {lineDiscountTotal > 0 && (
              <Row label="Line discounts" value={`- ${fmtMoney(lineDiscountTotal, sym)}`} muted />
            )}

            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">Discount</span>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={tab.discount_pct}
                    onChange={(e) => applyDiscountPct(e.target.value)}
                    placeholder="0"
                    className="h-8 w-14 text-right text-sm pr-5"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  value={tab.discount}
                  onChange={(e) => setTab({ discount: Number(e.target.value), discount_pct: "" })}
                  className="h-8 w-24 text-right text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-between text-sm gap-2">
              <span className="text-muted-foreground">Charges</span>
              <div className="flex items-center gap-1.5">
                <div className="relative">
                  <Input
                    type="number"
                    step="0.01"
                    value={tab.charge_pct}
                    onChange={(e) => applyChargePct(e.target.value)}
                    placeholder="0"
                    className="h-8 w-14 text-right text-sm pr-5"
                  />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                    %
                  </span>
                </div>
                <Input
                  type="number"
                  step="0.01"
                  value={tab.charge}
                  onChange={(e) => setTab({ charge: Number(e.target.value), charge_pct: "" })}
                  className="h-8 w-24 text-right text-sm"
                />
              </div>
            </div>

            <div className="rounded-lg bg-primary/5 border border-primary/20 px-3 py-1 mt-0.5 flex items-baseline justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
                Grand Total
              </span>
              <span className="text-xl font-bold text-primary tabular-nums leading-tight">
                {fmtMoney(total, sym)}
              </span>
            </div>

            <div>
              <Label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Paid
              </Label>
              <div className="flex items-center gap-2 mt-0.5">
                <Input
                  ref={paidRef}
                  type="number"
                  step="0.01"
                  value={tab.paid}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    const nextRows = [...paymentRows];
                    if (nextRows[0]) {
                      nextRows[0] = { ...nextRows[0], amount: Number(nextValue || 0) };
                    }
                    setTab({
                      paid: nextValue,
                      payments: nextRows,
                      payment_method: nextRows[0]?.method || tab.payment_method || "cash",
                    });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (submitting) return;
                      handleSale();
                    }
                  }}
                  placeholder={total.toFixed(2)}
                  className="h-9 flex-1 text-sm font-semibold tabular-nums"
                />
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setTab({ paid: total.toFixed(2) });
                    setTimeout(() => searchRef.current?.focus(), 0);
                  }}
                  className="text-xs text-primary hover:underline shrink-0 font-medium"
                >
                  Exact
                </button>
              </div>
              <div className="mt-1">
                {due > 0 ? (
                  <div className="rounded bg-destructive/10 border border-destructive/20 px-2 py-1 text-xs text-destructive font-semibold">
                    Due: {fmtMoney(due, sym)}
                  </div>
                ) : (
                  <div className="rounded bg-success/10 border border-success/20 px-2 py-1 text-sm text-success font-bold tabular-nums">
                    Change: {fmtMoney(change, sym)}
                  </div>
                )}
              </div>
            </div>

            <Input
              value={tab.note}
              onChange={(e) => setTab({ note: e.target.value })}
              placeholder="Note / House #, street…"
              className="h-7 text-xs"
            />

            {tab.items.length > 0 &&
              (() => {
                const cartCost = tab.items.reduce((s, i) => s + Number(i.qty) * Number(i.cost), 0);
                const cartProfit = subtotal - discount - cartCost;
                const net = subtotal - discount;
                const pct = net > 0 ? (cartProfit / net) * 100 : 0;
                return (
                  <div className="rounded-md border border-dashed bg-background/60 px-2 py-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setShowProfit((v) => !v)}
                      className="flex items-center justify-between w-full text-muted-foreground hover:text-foreground"
                    >
                      <span>{showProfit ? "Hide" : "Show"} profit</span>
                      {showProfit ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                    </button>
                    {showProfit && (
                      <div className="flex items-center justify-between pt-1 mt-1 border-t">
                        <span className="text-muted-foreground">
                          Cost <span className="font-mono">{fmtMoney(cartCost, sym)}</span>
                        </span>
                        <span
                          className={`font-semibold ${cartProfit >= 0 ? "text-success" : "text-destructive"}`}
                        >
                          {fmtMoney(cartProfit, sym)} ({pct.toFixed(1)}%)
                        </span>
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>

          {/* Footer — Complete sale */}
          <div className="p-2 border-t bg-card shrink-0">
            <Button
              className="w-full h-11 text-base font-bold rounded-xl shadow-md hover:shadow-lg transition-shadow"
              onClick={handleSale}
              disabled={submitting}
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tab.editing_sale_id ? `Save changes · F4` : `Complete Sale · F4`}
            </Button>
          </div>
        </aside>
      </div>

      {/* Keyboard shortcut bar */}
      <div className="hidden md:flex items-center justify-center gap-4 border-t bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground no-print shrink-0">
        <ShortcutHint k="F2" label="New" />
        <ShortcutHint k="F3" label="Search" />
        <ShortcutHint k="F4" label="Complete sale" />
        <ShortcutHint k="F10" label="Undo last" />
        <ShortcutHint k="Esc" label="Clear" />
      </div>

      {/* Reprint browser */}
      <ReprintDialog
        open={reprintOpen}
        onOpenChange={setReprintOpen}
        settings={settings}
        sym={sym}
        reprintAuditEnabled={!!(settings as any)?.ops_reprint_audit_enabled}
        onEdit={(s: any) => loadInvoiceForEdit(s)}
      />

      {/* Held bills tray */}
      <Dialog open={heldOpen} onOpenChange={setHeldOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Held bills</DialogTitle>
          </DialogHeader>
          <div className="rounded-md border max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Label</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-left px-3 py-2">Held at</th>
                  <th className="text-right px-3 py-2">Items</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {heldBills.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-6 text-muted-foreground">
                      No held bills
                    </td>
                  </tr>
                )}
                {heldBills.map((b: any) => (
                  <tr key={b.id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5">
                        {b.payload?.editing_sale_id ? (
                          <span
                            className="inline-flex items-center gap-1 text-primary"
                            title="Paused edit — resume to continue editing invoice"
                          >
                            <Clock className="h-3.5 w-3.5" />
                            <Pencil className="h-3 w-3" />
                          </span>
                        ) : null}
                        <span>{b.label || "Untitled"}</span>
                        {b.payload?.editing_sale_id && (
                          <Badge
                            variant="outline"
                            className="text-[10px] h-4 px-1 border-primary/40 text-primary"
                          >
                            Editing {b.payload?.editing_invoice_no ?? ""}
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">{b.customers?.name ?? "Walk-in"}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">
                      {fmtDate(b.created_at)}
                    </td>
                    <td className="px-3 py-1.5 text-right">{b.item_count}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {fmtMoney(b.total, sym)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <Button size="sm" variant="ghost" onClick={() => resumeHeld(b.id)}>
                        <Play className="h-3.5 w-3.5 mr-1" /> Resume
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => discardHeld(b.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </DialogContent>
      </Dialog>

      {/* Single invoice viewer (used by both reprint and the post-sale toast action) */}
      <InvoiceDialog
        invoice={reprintView}
        settings={settings}
        onClose={() => setReprintView(null)}
      />

      {/* Post-sale print prompt — Enter triggers the default action (Settings > POS). */}
      <PrintPromptDialog
        sale={printAsk}
        defaultAction={((settings as any)?.pos_print_prompt_default ?? "no") as "yes" | "no"}
        onYes={() => {
          const s = printAsk;
          setPrintAsk(null);
          if (s) {
            printInvoiceDirect(s, settings);
          }
          setTimeout(() => searchRef.current?.focus(), 50);
        }}
        onNo={() => {
          setPrintAsk(null);
          setTimeout(() => searchRef.current?.focus(), 50);
        }}
      />

      {/* Quick-add product dialog — for scanned/typed items not yet in catalog */}
      <Dialog
        open={quickAdd.open}
        onOpenChange={(v) => {
          setQuickAdd((q) => ({ ...q, open: v }));
          if (!v) {
            // Cancel / close: clear the unmatched search term so the cashier
            // can scan the next item — cart items are preserved.
            setSearch("");
            setTimeout(() => searchRef.current?.focus(), 0);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add new item to catalog</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Search existing item</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Barcode, item code or name"
                  value={quickAddLookup}
                  onChange={(e) => setQuickAddLookup(e.target.value)}
                />
              </div>
              {quickAddLookup.trim().length >= 2 && (
                <div className="mt-2 max-h-48 overflow-auto rounded-md border bg-muted/20 p-2 space-y-2">
                  {quickAddMatchesLoading && (
                    <div className="text-xs text-muted-foreground">Searching…</div>
                  )}
                  {!quickAddMatchesLoading && quickAddMatches.length === 0 && (
                    <div className="text-xs text-muted-foreground">No existing item found</div>
                  )}
                  {(quickAddMatches ?? []).map((product: any) => (
                    <button
                      key={product.id}
                      type="button"
                      className="flex w-full items-start justify-between rounded-md border border-border bg-background px-3 py-2 text-left shadow-sm transition hover:border-primary hover:bg-accent/70"
                      onClick={() => selectQuickAddMatch(product)}
                    >
                      <div>
                        <div className="font-medium">{product.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {product.sku ?? "—"} · {product.barcode ?? "—"}
                        </div>
                      </div>
                      <div className="ml-3 shrink-0 text-right">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Stock
                        </div>
                        <div className="font-semibold">{fmtQty(product.stock ?? 0)}</div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <Label>Item name</Label>
              <Input
                autoFocus
                value={quickAdd.name}
                onChange={(e) => setQuickAdd((q) => ({ ...q, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveQuickAdd();
                  }
                }}
              />
            </div>
            <div className="col-span-2">
              <Label>Supplier</Label>
              <select
                value={quickAdd.supplier_id || ""}
                onChange={(e) => setQuickAdd((q) => ({ ...q, supplier_id: e.target.value }))}
                className="flex h-9 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option value="">— None —</option>
                {quickAddSuppliers.map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label>SKU</Label>
              <Input
                value={quickAdd.sku}
                onChange={(e) => setQuickAdd((q) => ({ ...q, sku: e.target.value }))}
              />
            </div>
            <div>
              <Label>Primary barcode</Label>
              <Input
                value={quickAdd.barcode}
                onChange={(e) => setQuickAdd((q) => ({ ...q, barcode: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <Label>Additional barcodes (one per line)</Label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={quickAdd.barcodes_text}
                onChange={(e) => setQuickAdd((q) => ({ ...q, barcodes_text: e.target.value }))}
                placeholder={"8964000000001\n8964000000002"}
              />
            </div>
            <div>
              <Label>Category</Label>
              <Input
                list="quickadd-category-list"
                placeholder="e.g. Grocery, Drinks"
                value={quickAdd.category}
                onChange={(e) => setQuickAdd((q) => ({ ...q, category: e.target.value }))}
              />
              <datalist id="quickadd-category-list">
                {quickAddCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <Label>Unit</Label>
              <Input
                value={quickAdd.unit}
                onChange={(e) => setQuickAdd((q) => ({ ...q, unit: e.target.value }))}
              />
            </div>
            <div>
              <Label>Purchase rate</Label>
              <Input
                type="number"
                step="0.01"
                value={quickAdd.cost_price}
                onChange={(e) => setQuickAdd((q) => ({ ...q, cost_price: e.target.value }))}
              />
            </div>
            <div>
              <Label>Sell price</Label>
              <Input
                type="number"
                step="0.01"
                value={quickAdd.sell_price}
                onChange={(e) => setQuickAdd((q) => ({ ...q, sell_price: e.target.value }))}
              />
            </div>
            <div>
              <Label>Stock</Label>
              <Input
                type="number"
                step="0.001"
                value={quickAdd.stock}
                onChange={(e) => setQuickAdd((q) => ({ ...q, stock: e.target.value }))}
              />
            </div>
            <div>
              <Label>Low-stock alert at</Label>
              <Input
                type="number"
                step="0.001"
                value={quickAdd.low_stock_threshold}
                onChange={(e) =>
                  setQuickAdd((q) => ({ ...q, low_stock_threshold: e.target.value }))
                }
              />
            </div>
            <div>
              <Label>Tax %</Label>
              <Input
                type="number"
                step="0.01"
                value={quickAdd.tax_rate}
                onChange={(e) => setQuickAdd((q) => ({ ...q, tax_rate: e.target.value }))}
              />
            </div>
            <div>
              <Label>Batch #</Label>
              <Input
                value={quickAdd.batch_no}
                onChange={(e) => setQuickAdd((q) => ({ ...q, batch_no: e.target.value }))}
                placeholder="e.g. B-2026-01"
              />
            </div>
            <div>
              <Label>Expiry date</Label>
              <Input
                type="date"
                value={quickAdd.expiry_date}
                onChange={(e) => setQuickAdd((q) => ({ ...q, expiry_date: e.target.value }))}
              />
            </div>
            <div className="col-span-2">
              <Label>Rack / Shelf location</Label>
              <Input
                value={quickAdd.rack_location}
                onChange={(e) => setQuickAdd((q) => ({ ...q, rack_location: e.target.value }))}
                placeholder="e.g. A-3, Shelf 2"
              />
            </div>
            <div className="col-span-2 flex items-start gap-2 rounded-md border p-3 bg-muted/30">
              <input
                id="quickadd-allow-neg-stock"
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={quickAdd.allow_negative_stock}
                onChange={(e) =>
                  setQuickAdd((q) => ({ ...q, allow_negative_stock: e.target.checked }))
                }
              />
              <label htmlFor="quickadd-allow-neg-stock" className="text-sm cursor-pointer">
                <div className="font-medium">Allow negative stock</div>
                <div className="text-xs text-muted-foreground">
                  If checked, POS can continue selling this item after stock reaches zero.
                </div>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setQuickAdd((q) => ({ ...q, open: false }));
                setQuickAddLookup("");
                setSearch("");
                setTimeout(() => searchRef.current?.focus(), 0);
              }}
            >
              Cancel
            </Button>
            <Button onClick={saveQuickAdd}>Save & add to bill</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Undo last sale confirmation */}
      <Dialog open={undoOpen} onOpenChange={(o) => !undoing && setUndoOpen(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Undo last sale?</DialogTitle>
          </DialogHeader>
          {undoCandidate && (
            <div className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                This will reverse the sale, restore stock and any customer balance, and put the
                items back in a new bill for editing.
              </p>
              <div className="rounded-md border bg-muted/40 p-3 space-y-1.5">
                <Row label="Invoice" value={undoCandidate.invoice_no} />
                <Row label="Total" value={fmtMoney(undoCandidate.total, sym)} />
                <Row label="Items" value={String(undoCandidate.item_count)} />
                <Row
                  label="Elapsed"
                  value={`${Math.floor(undoAgeSeconds / 60)}m ${undoAgeSeconds % 60}s of ${undoWindowMin}m window`}
                  muted
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Reason (optional)</Label>
                <Select value={undoReason} onValueChange={setUndoReason}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {UNDO_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {undoReason === "Other" && (
                  <Textarea
                    rows={2}
                    value={undoReasonNote}
                    onChange={(e) => setUndoReasonNote(e.target.value)}
                    placeholder="Describe reason…"
                  />
                )}
              </div>
              {undoExpired && (
                <p className="text-destructive text-xs">
                  Undo window has expired. Please create a Sale Return instead.
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setUndoOpen(false)} disabled={undoing}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmUndo}
              disabled={undoing || undoExpired || !undoCandidate}
            >
              {undoing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Undo sale
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-add customer */}
      <Dialog open={quickAddCustomerOpen} onOpenChange={setQuickAddCustomerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add customer</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name</Label>
              <Input
                autoFocus
                value={newCustomer.name}
                onChange={(e) => setNewCustomer((c) => ({ ...c, name: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    saveQuickCustomer();
                  }
                }}
              />
            </div>
            <div>
              <Label>Phone (optional)</Label>
              <Input
                value={newCustomer.phone}
                onChange={(e) => setNewCustomer((c) => ({ ...c, phone: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setQuickAddCustomerOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveQuickCustomer}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PaymentMethodGrid({
  value,
  onChange,
  sym,
  total,
  due,
  digitalAccountId,
  digitalAmount,
  onSelectDigitalAccount,
  onDigitalAmountChange,
  cashBackReceived,
  cashBackAmount,
  onSelectCashBackAccount,
  onCashBackReceivedChange,
}: {
  value: string;
  onChange: (v: string) => void;
  sym: string;
  total: number;
  due: number;
  digitalAccountId: string | null;
  digitalAmount: string;
  onSelectDigitalAccount: (accountId: string | null) => void;
  onDigitalAmountChange: (value: string) => void;
  cashBackReceived: string;
  cashBackAmount: number;
  onSelectCashBackAccount: (accountId: string | null) => void;
  onCashBackReceivedChange: (value: string) => void;
}) {
  const accQ = useQuery({
    queryKey: POS_CASH_ACCOUNTS_QUERY_KEY,
    queryFn: fetchActiveCashAccounts,
  });
  const accounts = accQ.data ?? [];

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  // Only accounts created in Cash Flow are offered here, including card/bank/mobile wallets.
  // Filter out "Card" if it's a duplicate of the standalone Card button.
  const online = accounts
    .filter((a: any) => a.type !== "cash" && slug(a.name) !== "card")
    .map((a: any) => ({ v: a.name, label: a.name, id: a.id }));

  const normalizedValue = normalizePaymentMethodValue(value);
  const isOnline = online.some((o) => normalizePaymentMethodValue(o.v) === normalizedValue) || normalizedValue === "bank";
  const activeOnline = online.find((o) => normalizePaymentMethodValue(o.v) === normalizedValue) ??
    (normalizedValue === "bank" ? { v: "bank", label: "Bank", id: "bank" } : undefined);

  const isDigital = normalizedValue === "digital";
  const isCashBack = normalizedValue === "digital_cash_back";
  const [digitalOpen, setDigitalOpen] = useState(false);
  const [cbOpen, setCbOpen] = useState(false);

  const btn = (active: boolean) =>
    `h-9 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
      active
        ? "bg-primary text-primary-foreground shadow-sm ring-2 ring-primary/30"
        : "bg-muted/50 text-foreground hover:bg-muted border border-transparent"
    }`;

  return (
    <div className="grid grid-cols-3 gap-1.5 mt-1.5">
      <button type="button" onClick={() => onChange("cash")} className={btn(value === "cash")}>
        Cash
      </button>
      <button type="button" onClick={() => onChange("card")} className={btn(value === "card")}>
        Card
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`${btn(isOnline)} flex items-center justify-center gap-1 px-1`}
          >
            <span className="truncate">{activeOnline?.label ?? "Bank"}</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuItem onSelect={() => onChange("bank")}>
            <span className={normalizedValue === "bank" ? "font-semibold" : ""}>Bank</span>
          </DropdownMenuItem>
          {online.length === 0 ? (
            <div className="px-2 py-3 text-xs text-muted-foreground">
              No accounts yet. Create a bank account in Cash Flow — it will appear here automatically.
            </div>
          ) : (
            online.map((o) => (
              <DropdownMenuItem
                key={o.v}
                onSelect={() => onChange(o.v)}
              >
                <span className={normalizePaymentMethodValue(value) === normalizePaymentMethodValue(o.v) ? "font-semibold" : ""}>{o.label}</span>
              </DropdownMenuItem>
            ))
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Digital — compact popover, never expands the panel vertically */}
      <Popover
        open={digitalOpen}
        onOpenChange={(open) => {
          setDigitalOpen(open);
          if (open && !isDigital) {
            onSelectDigitalAccount(digitalAccountId ?? online[0]?.id ?? null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`${btn(isDigital)} flex items-center justify-center gap-1 px-1`}
            title="Digital / online payment"
          >
            <span className="truncate">Digital</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-semibold">Digital payment</span>
            <span>Total {fmtMoney(total, sym)}</span>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Digital account</Label>
            <Select
              value={digitalAccountId ?? ""}
              onValueChange={(v) => onSelectDigitalAccount(v || null)}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {online.length ? (
                  online.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    No digital accounts yet — create one in Cash Flow.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Amount received</Label>
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                step="0.01"
                min="0"
                className="h-8 text-right"
                value={digitalAmount}
                onChange={(e) => onDigitalAmountChange(e.target.value)}
                placeholder={total.toFixed(2)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 px-2 text-[11px]"
                onClick={(e) => {
                  e.preventDefault();
                  onDigitalAmountChange(total.toFixed(2));
                }}
              >
                Exact
              </Button>
            </div>
          </div>
          <div className="flex justify-between rounded-md border border-dashed px-2 py-1 text-[11px]">
            <span className="text-muted-foreground">Remaining</span>
            <span className="font-semibold">{fmtMoney(due, sym)}</span>
          </div>
        </PopoverContent>
      </Popover>

      {/* Digital + CB — separate method with its own received / cash-back figures */}
      <Popover
        open={cbOpen}
        onOpenChange={(open) => {
          setCbOpen(open);
          if (open && !isCashBack) {
            onSelectCashBackAccount(digitalAccountId ?? online[0]?.id ?? null);
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`${btn(isCashBack)} leading-tight px-1.5 flex items-center justify-center gap-1`}
            title="Digital payment with cash back"
          >
            <span className="truncate">Digital + CB</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 p-2.5 space-y-2">
          <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
            <span className="font-semibold">Digital cash back</span>
            <span>Total {fmtMoney(total, sym)}</span>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Digital account</Label>
            <Select
              value={digitalAccountId ?? ""}
              onValueChange={(v) => onSelectCashBackAccount(v || null)}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Select account" />
              </SelectTrigger>
              <SelectContent>
                {online.length ? (
                  online.map((o) => (
                    <SelectItem key={o.id} value={o.id}>
                      {o.label}
                    </SelectItem>
                  ))
                ) : (
                  <div className="px-2 py-2 text-xs text-muted-foreground">
                    No digital accounts yet — create one in Cash Flow.
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px]">Amount received</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              className="h-8 text-right"
              value={cashBackReceived}
              onChange={(e) => onCashBackReceivedChange(e.target.value)}
              placeholder={total.toFixed(2)}
            />
          </div>
          <div className="rounded-md border border-dashed px-2 py-1 text-[11px] space-y-0.5">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cash back</span>
              <span className="font-semibold">{fmtMoney(cashBackAmount, sym)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Net digital effect</span>
              <span className="font-semibold text-emerald-600">
                {fmtMoney(Math.max(0, Number(cashBackReceived || 0) - total), sym)}
              </span>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <button type="button" onClick={() => onChange("credit")} className={btn(value === "credit")}>
        Credit
      </button>
    </div>
  );
}

function PaymentMethodSelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const accQ = useQuery({
    queryKey: POS_CASH_ACCOUNTS_QUERY_KEY,
    queryFn: fetchActiveCashAccounts,
  });
  const accounts = accQ.data ?? [];
  const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const options = [
    { value: "cash", label: "Cash" },
    { value: "card", label: "Card" },
    { value: "bank", label: "Bank" },
    { value: "digital_cash_back", label: "Digital + CB" },
    { value: "credit", label: "Credit" },
    { value: "staff", label: "Staff" },
    ...accounts
      .filter((a: any) => a.type !== "cash" && slugify(a.name) !== "card")
      .map((a: any) => ({ value: a.name, label: a.name })),
  ];

  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-8 flex-1"}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between text-sm ${muted ? "text-muted-foreground" : ""}`}>
      <span>{label}</span>
      <span className={muted ? "" : "font-medium"}>{value}</span>
    </div>
  );
}

function ShortcutHint({ k, label }: { k: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="px-1.5 py-0.5 rounded bg-background border text-[10px] font-mono font-semibold text-foreground">
        {k}
      </kbd>
      <span>{label}</span>
    </span>
  );
}

function Kbd({ label, hint }: { label: string; hint: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1.5">
      <kbd className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono font-semibold text-foreground">
        {label}
      </kbd>
      <span>{hint}</span>
    </div>
  );
}

function PrintPromptDialog({
  sale,
  defaultAction = "no",
  onYes,
  onNo,
}: {
  sale: any;
  defaultAction: "yes" | "no";
  onYes: () => void;
  onNo: () => void;
}) {
  const yesRef = useRef<HTMLButtonElement>(null);
  const noRef = useRef<HTMLButtonElement>(null);
  const [focused, setFocused] = useState<"yes" | "no">(defaultAction || "no");
  const settings = useSettings();

  useEffect(() => {
    if (!sale) return;
    setFocused(defaultAction || "no");
    const t = setTimeout(() => {
      (defaultAction === "yes" ? yesRef.current : noRef.current)?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [sale, defaultAction]);

  const focus = (which: "yes" | "no") => {
    setFocused(which);
    (which === "yes" ? yesRef.current : noRef.current)?.focus();
  };

  const doPrint = () => {
    printInvoiceDirect(sale, settings.data);
    onYes();
  };

  return (
    <Dialog open={!!sale} onOpenChange={(o) => !o && onNo()}>
      <DialogContent
        className="max-w-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (focused === "yes") {
              doPrint();
            } else {
              onNo();
            }
          } else if (
            e.key === "ArrowLeft" ||
            e.key === "ArrowRight" ||
            e.key === "ArrowUp" ||
            e.key === "ArrowDown" ||
            e.key === "Tab"
          ) {
            e.preventDefault();
            focus(focused === "yes" ? "no" : "yes");
          } else if (e.key.toLowerCase() === "y") {
            e.preventDefault();
            doPrint();
          } else if (e.key.toLowerCase() === "n" || e.key === "Escape") {
            e.preventDefault();
            onNo();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Print receipt?</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground">
          Invoice <span className="font-mono">{sale?.invoice_no}</span> saved. Print it now?
        </div>
        <DialogFooter className="gap-2">
          <Button ref={noRef} variant={focused === "no" ? "default" : "outline"} onClick={onNo}>
            No
          </Button>
          <Button
            ref={yesRef}
            variant={focused === "yes" ? "default" : "outline"}
            onClick={doPrint}
          >
            <Printer className="h-4 w-4 mr-2" />
            Yes, print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function InvoiceDialog({ invoice, settings, onClose }: any) {
  if (!invoice) return null;
  return (
    <Dialog open={!!invoice} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Invoice {invoice.invoice_no}</DialogTitle>
        </DialogHeader>
        <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
          <div className="print-area">
            <Receipt invoice={invoice} settings={settings} />
          </div>
        </div>
        <DialogFooter className="no-print">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={() => {
              printInvoiceDirect(invoice, settings, "sale");
            }}
          >
            <Printer className="h-4 w-4 mr-2" />
            Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReprintDialog({
  open,
  onOpenChange,
  settings,
  sym,
  reprintAuditEnabled,
  onEdit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  settings: any;
  sym: string;
  reprintAuditEnabled?: boolean;
  onEdit: (s: any) => void;
}) {
  const [q, setQ] = useState("");
  /** How many invoices are loaded. Grows on "Load more" so NO invoice is
   *  permanently hidden behind a fixed cap. */
  const [pageSize, setPageSize] = useState(300);
  const term = q.trim();

  // When the user searches, ask the server across the WHOLE history instead of
  // filtering only the loaded page — otherwise old invoices look missing.
  const { data: serverHits = [] } = useQuery({
    queryKey: ["sales", "reprint-search", term],
    enabled: open && term.length > 0,
    queryFn: async () => {
      const like = `%${term.replace(/[%_]/g, "")}%`;
      const asNum = Number(term);
      const filters = [`invoice_no.ilike.${like}`, `payment_method.ilike.${like}`];
      if (isFinite(asNum) && term !== "") filters.push(`total.eq.${asNum}`, `paid.eq.${asNum}`);
      return await fetchAll<any>(
        (from: number, to: number) =>
          supabase
            .from("sales")
            .select("*, customers(name), sale_items(*)")
            .or(filters.join(","))
            .order("created_at", { ascending: false })
            .range(from, to) as any,
      );
    },
  });

  const { data: sales = [], isFetching } = useQuery({
    queryKey: ["sales", "reprint", pageSize],
    enabled: open,
    queryFn: () =>
      offlineFirst(
        async () => {
          const { data, error } = await supabase
            .from("sales")
            .select("*, customers(name), sale_items(*)")
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(pageSize);
          if (error) throw error;
          return data ?? [];
        },
        async () => {
          const rows = await offlineDb()
            .sales.orderBy("created_at")
            .reverse()
            .limit(pageSize)
            .toArray();
          return Promise.all(
            rows.map(async (r: any) => ({
              ...r,
              sale_items:
                r.sale_items ??
                (await offlineDb().sale_items.where("sale_id").equals(r.id).toArray()),
            })),
          ) as any;
        },
        async (rows) => {
          try {
            await offlineDb().sales.bulkPut(rows as any[]);
            const items = (rows as any[]).flatMap((r: any) => r.sale_items ?? []);
            if (items.length) await offlineDb().sale_items.bulkPut(items);
          } catch {}
        },
      ),
    placeholderData: (prev) => prev,
  });

  const filtered = useMemo(() => {
    const lower = term.toLowerCase();
    const local = !lower
      ? sales
      : sales.filter((s: any) => {
          const asNum = Number(lower);
          const isNum = isFinite(asNum) && lower !== "";
          if (
            String(s.invoice_no ?? "")
              .toLowerCase()
              .includes(lower)
          )
            return true;
          if ((s.customers?.name ?? "").toLowerCase().includes(lower)) return true;
          if ((s.payment_method ?? "").toLowerCase().includes(lower)) return true;
          if (isNum) {
            if (Math.abs(Number(s.total) - asNum) < 1) return true;
            if (Math.abs(Number(s.paid) - asNum) < 1) return true;
          }
          return false;
        });
    // Merge local + server hits, de-duplicated by id, newest first.
    const byId = new Map<string, any>();
    for (const s of [...local, ...(serverHits as any[])]) byId.set(s.id, s);
    return Array.from(byId.values()).sort((a, b) =>
      String(b.created_at).localeCompare(String(a.created_at)),
    );
  }, [term, sales, serverHits]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reprint / past invoices</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              placeholder="Search by invoice no, customer, or amount (e.g. 250)…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="pl-9 h-10"
            />
          </div>
          <div className="rounded-md border max-h-[55vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2">Invoice</th>
                  <th className="text-left px-3 py-2">Date</th>
                  <th className="text-left px-3 py-2">Customer</th>
                  <th className="text-right px-3 py-2">Total</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {isFetching && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-muted-foreground">
                      Loading…
                    </td>
                  </tr>
                )}
                {!isFetching && filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-6 text-muted-foreground">
                      No invoices match.
                    </td>
                  </tr>
                )}
                {filtered.map((s: any) => (
                  <tr key={s.id} className="border-t hover:bg-accent/40">
                    <td className="px-3 py-1.5 font-mono text-xs">{s.invoice_no}</td>
                    <td className="px-3 py-1.5 text-xs">
                      {fmtDate(s.created_at)}
                    </td>
                    <td className="px-3 py-1.5">{s.customers?.name ?? "Walk-in"}</td>
                    <td className="px-3 py-1.5 text-right font-medium tabular-nums">
                      {fmtMoney(s.total, sym)}
                    </td>
                    <td className="px-2 py-1 text-right whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          onEdit(s);
                          onOpenChange(false);
                        }}
                        title="Edit invoice in POS"
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (reprintAuditEnabled) {
                            try {
                              await supabase.rpc("log_receipt_reprint", {
                                _sale_id: s.id,
                                _reason: "reprint from POS",
                              });
                            } catch {
                              /* audit-only */
                            }
                          }
                          printInvoiceDirect(s, settings);
                          onOpenChange(false);
                        }}
                        title="Reprint invoice"
                      >
                        <Printer className="h-3.5 w-3.5 mr-1" /> Reprint
                      </Button>
                    </td>
                  </tr>
                ))}
                {sales.length >= pageSize && (
                  <tr className="border-t">
                    <td colSpan={5} className="text-center py-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPageSize((n) => n + 300)}
                      >
                        Load older invoices
                      </Button>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EditableNumCell({
  active,
  value,
  step,
  min,
  display,
  onActivate,
  onCommit,
  onCancel,
}: {
  active: boolean;
  value: number;
  step?: string;
  min?: number;
  display: string;
  onActivate: () => void;
  onCommit: (v: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active) {
      setDraft(String(value));
      setTimeout(() => {
        ref.current?.focus();
        ref.current?.select();
      }, 0);
    }
  }, [active, value]);

  if (!active) {
    return (
      <button
        type="button"
        onClick={onActivate}
        className="h-8 w-full px-2 text-right text-sm tabular-nums hover:bg-accent/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        title="Click to edit"
      >
        {display}
      </button>
    );
  }
  return (
    <Input
      ref={ref}
      type="number"
      step={step}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(Number(draft))}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(Number(draft));
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      className="h-8 w-full text-right text-sm rounded-none border-0 focus-visible:ring-1"
    />
  );
}
