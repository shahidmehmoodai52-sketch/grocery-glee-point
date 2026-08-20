import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Wallet, Banknote, CreditCard, Smartphone,
  Building2, ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, Search, Coins, Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";
import { fmtMoney } from "@/lib/format";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { CalendarIcon } from "lucide-react";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { cn } from "@/lib/utils";
import { fetchAll } from "@/lib/supabase-page";

function DateRangeBar({
  preset, from, to, onPreset, onFrom, onTo,
}: {
  preset: DatePreset; from: string; to: string;
  onPreset: (p: DatePreset) => void; onFrom: (v: string) => void; onTo: (v: string) => void;
}) {
  const pick = (val: string, set: (v: string) => void, label: string) => (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 justify-start font-normal">
          <CalendarIcon className="h-3.5 w-3.5 mr-1.5" />
          {val || label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={val ? new Date(`${val}T00:00:00`) : undefined}
          onSelect={(d) => { onPreset("all"); set(d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : ""); }}
          className={cn("p-3 pointer-events-auto")}
        />
      </PopoverContent>
    </Popover>
  );
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={preset} onValueChange={(v) => { const p = v as DatePreset; onPreset(p); const r = rangeFor(p); onFrom(r.from); onTo(r.to); }}>
        <SelectTrigger className="h-8 w-[150px]"><SelectValue /></SelectTrigger>
        <SelectContent>
          {PRESETS.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}
        </SelectContent>
      </Select>
      {pick(from, onFrom, "From")}
      {pick(to, onTo, "To")}
      {(from || to) && (
        <Button variant="ghost" size="sm" className="h-8" onClick={() => { onPreset("all"); onFrom(""); onTo(""); }}>Clear</Button>
      )}
    </div>
  );
}


export const Route = createFileRoute("/_authenticated/cash-flow")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Cash Flow — Tillix POS" },
      { name: "description", content: "Track cash across till, bank, card, EasyPaisa, JazzCash and more. See every rupee in and out." },
    ],
  }),
});

type Account = {
  id: string;
  name: string;
  type: string;
  opening_balance: number;
  notes: string | null;
  is_active: boolean;
  sort_order: number;
};

type Tx = {
  id: string;
  account_id: string;
  account_name?: string;
  direction: "in" | "out";
  amount: number;
  occurred_on: string;
  category: string;
  reference: string | null;
  notes: string | null;
  transfer_group_id: string | null;
  created_at: string;
  payment_method?: string | null;
};

const ACC_TYPES = [
  { v: "cash", label: "Cash / Till", Icon: Banknote },
  { v: "card", label: "Card terminal", Icon: CreditCard },
  { v: "bank", label: "Bank account", Icon: Building2 },
  { v: "mobile_wallet", label: "Mobile wallet (EasyPaisa/JazzCash)", Icon: Smartphone },
  { v: "other", label: "Other", Icon: Wallet },
] as const;

/** Payment methods offered on every cash-flow entry. */
const PAY_METHODS = [
  { v: "cash", label: "Cash" },
  { v: "card", label: "Card" },
  { v: "easypaisa", label: "EasyPaisa" },
  { v: "jazzcash", label: "JazzCash" },
  { v: "bank", label: "Bank Account" },
] as const;
const payLabel = (v?: string | null) =>
  PAY_METHODS.find((m) => m.v === (v || "cash"))?.label ?? (v || "Cash");

const CATEGORIES = [
  "sale", "expense", "deposit", "withdrawal", "supplier_payment",
  "customer_payment", "salary", "adjustment", "other",
] as const;

const iconFor = (t: string) => ACC_TYPES.find((x) => x.v === t)?.Icon ?? Wallet;
const labelFor = (t: string) => ACC_TYPES.find((x) => x.v === t)?.label ?? t;

const emptyAcc = { name: "", type: "cash", opening_balance: 0, notes: "", is_active: true };
const today = () => new Date().toISOString().slice(0, 10);
const emptyTx = { account_id: "", direction: "in" as "in" | "out", amount: 0, occurred_on: today(), category: "other", reference: "", notes: "", payment_method: "cash" };
const emptyTransfer = { from_id: "", to_id: "", amount: 0, occurred_on: today(), notes: "" };
const emptySupplierPay = { supplier_id: "", from_id: "", amount: 0, occurred_on: today(), note: "" };
const SPLIT_PAYMENT_PREFIX = "split:";

function parseSalePaymentSplits(methodValue: string | null | undefined, paidValue: number) {
  const raw = String(methodValue ?? "").trim();
  const paid = +Math.max(0, Number(paidValue || 0)).toFixed(2);
  if (!raw.startsWith(SPLIT_PAYMENT_PREFIX)) {
    return [{ method: raw || "cash", amount: paid }];
  }
  const body = raw.slice(SPLIT_PAYMENT_PREFIX.length);
  const rows = body
    .split("|")
    .filter(Boolean)
    .map((part) => {
      const [methodEncoded, amountRaw] = part.split("=");
      let decoded = methodEncoded || "";
      try {
        decoded = decodeURIComponent(methodEncoded || "");
      } catch {
        decoded = methodEncoded || "";
      }
      const method = decoded.trim() || "cash";
      const amount = +Math.max(0, Number(amountRaw || 0)).toFixed(2);
      return { method, amount };
    })
    .filter((entry) => entry.amount > 0);
  if (!rows.length) return [{ method: "cash", amount: paid }];
  return rows;
}

/**
 * Cash flow is a financial ledger: a fixed `.limit()` silently drops the OLDEST
 * rows once a shop crosses the cap, which reads to the user as history being
 * deleted. Never cap these reads — page until the server stops returning rows.
 * Paging uses the shared helper: build(from, to) => query.range(from, to).
 */
const PAGE_SIZE = 1000;



function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const { isAdmin } = usePermissions();

  const [accOpen, setAccOpen] = useState(false);
  const [editingAccId, setEditingAccId] = useState<string | null>(null);
  const [accForm, setAccForm] = useState<any>({ ...emptyAcc });

  const [txOpen, setTxOpen] = useState(false);
  const [editingTxId, setEditingTxId] = useState<string | null>(null);
  const [txForm, setTxForm] = useState<any>({ ...emptyTx });

  const [tfOpen, setTfOpen] = useState(false);
  const [tfForm, setTfForm] = useState<any>({ ...emptyTransfer });

  const [spOpen, setSpOpen] = useState(false);
  const [spForm, setSpForm] = useState<any>({ ...emptySupplierPay });

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterAcc, setFilterAcc] = useState<string>("all");
  const [filterMethod, setFilterMethod] = useState<string>("all");

  const [details, setDetailsRaw] = useState<
    | { kind: "opening" | "in" | "out" | "balance" }
    | { kind: "account"; accountId: string }
    | null
  >(null);
  const [dFilterAcc, setDFilterAcc] = useState<string>("all");
  const [dFilterMethod, setDFilterMethod] = useState<string>("all");

  const [dPreset, setDPreset] = useState<DatePreset>("all");
  const [dFrom, setDFrom] = useState("");
  const [dTo, setDTo] = useState("");
  const setDetails = (d: typeof details) => {
    if (d) {
      setDPreset("all");
      setDFrom("");
      setDTo("");
      setDFilterAcc(d.kind === "account" ? d.accountId : "all");
      setDFilterMethod("all");
    }
    setDetailsRaw(d);
  };



  const [page, setPage] = useState(0);
  const PAGE_SIZE_PAGED = 50;

  const accountsQ = useQuery({
    queryKey: ["cash-accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_accounts")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Account[];
    },
    staleTime: 30_000,
  });

  const { data: summaryStatsRaw } = useQuery({
    queryKey: ["cf-summary", dateFrom, dateTo, filterAcc],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_summary", {
        p_from_date: dateFrom || "2000-01-01",
        p_to_date: dateTo || "2099-12-31",
        p_account_id: filterAcc === "all" ? null : filterAcc
      });
      if (error) throw error;
      return data;
    },
  });
  const summary = (summaryStatsRaw as any)?.[0] || { total_in: 0, total_out: 0, opening_balance: 0, current_balance: 0 };

  const { data: ledgerPaged = { data: [], count: 0 }, isLoading: ledgerLoading } = useQuery({
    queryKey: ["cf-ledger-paged", dateFrom, dateTo, filterAcc, filterMethod, search, page],
    queryFn: async () => {
      const { data, count, error } = await supabase.rpc("get_cash_flow_ledger", {
        p_from_date: dateFrom || "2000-01-01",
        p_to_date: dateTo || "2099-12-31",
        p_account_id: filterAcc === "all" ? undefined : filterAcc,
        p_payment_method: filterMethod === "all" ? undefined : filterMethod,
        p_search: search || undefined,
        p_limit: PAGE_SIZE_PAGED,
        p_offset: page * PAGE_SIZE_PAGED
      }, { count: "exact" });
      if (error) throw error;
      // map RPC response to Tx type, adding required fields if missing
      const mapped = (data || []).map((row: any) => ({
        ...row,
        transfer_group_id: row.transfer_group_id || null,
        payment_method: row.payment_method || null
      })) as Tx[];
      return { data: mapped, count: count || 0 };
    },
  });

  const txs = ledgerPaged.data;
  const accounts = accountsQ.data ?? [];

  // Suppliers query for Pay Supplier dialog
  const suppliersQ = useQuery({
    queryKey: ["cf-suppliers"],
    queryFn: async () => (await supabase.from("suppliers").select("id,name,balance").order("name")).data ?? [],
    staleTime: 30_000,
  });

  const stats = useMemo(() => {
    return {
      opening: Number(summary.opening_balance || 0),
      in: Number(summary.total_in || 0),
      out: Number(summary.total_out || 0),
      balance: Number(summary.current_balance || 0),
    };
  }, [summary]);

  const accBalances = useMemo(() => {
    return accounts.map(a => ({
      ...a,
      balance: a.id === filterAcc ? stats.balance : a.opening_balance // fallback if not filtered
    }));
  }, [accounts, filterAcc, stats.balance]);

  const isAutoTx = (id: string) => id.startsWith("auto:");
  const isAutoAcc = (id: string) => id.startsWith("auto:");

  const balances = useMemo(() => {
    const map = new Map<string, { inSum: number; outSum: number }>();
    for (const a of accounts) map.set(a.id, { inSum: 0, outSum: 0 });
    for (const t of txs) {
      const b = map.get(t.account_id);
      if (!b) continue;
      if (t.direction === "in") b.inSum += Number(t.amount);
      else b.outSum += Number(t.amount);
    }
    return map;
  }, [accounts, txs]);

  const totals = useMemo(() => {
    let opening = 0, inSum = 0, outSum = 0;
    for (const a of accounts) {
      opening += Number(a.opening_balance);
      const b = balances.get(a.id);
      if (b) { inSum += b.inSum; outSum += b.outSum; }
    }
    return { opening, inSum, outSum, balance: opening + inSum - outSum };
  }, [accounts, balances]);

  // Receivables (credit sales unpaid) / Payables (purchases unpaid)
  const receivables = Number(summary.total_receivables || 0);
  const payables = Number(summary.total_payables || 0);

  /** Payment method of an entry. Stored value wins; legacy/auto rows are
   *  inferred from their account type and default to Cash. */
  const methodOf = (t: Tx): string => {
    if (t.payment_method) return t.payment_method;
    const acc = accounts.find((a) => a.id === t.account_id);
    const type = acc?.type ?? "cash";
    const name = (acc?.name ?? "").toLowerCase();
    if (type === "card") return "card";
    if (type === "bank") return "bank";
    if (type === "mobile_wallet") return name.includes("jazz") ? "jazzcash" : "easypaisa";
    return "cash";
  };

  const allAccounts = accounts; // Compatibility alias
  const autoTxs: Tx[] = []; // Compatibility alias

  const filteredTx = useMemo(() => {
    const term = search.trim().toLowerCase();
    return txs.filter((t) => {
      // Filtering is primarily done server-side via RPC now.
      if (term) {
        const hay = `${t.category} ${t.reference ?? ""} ${t.notes ?? ""} ${payLabel(methodOf(t))}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    }).sort((a, b) => (b.occurred_on > a.occurred_on ? 1 : b.occurred_on < a.occurred_on ? -1 : (b.created_at > a.created_at ? 1 : -1)));
  }, [txs, search, allAccounts]);

  /** CSV export of exactly what is on screen (method + account included). */
  const exportCsv = () => {
    const rows = [
      ["Date", "Account", "Payment method", "Category", "Reference", "Notes", "In", "Out"],
      ...filteredTx.map((t) => [
        t.occurred_on,
        allAccounts.find((a) => a.id === t.account_id)?.name ?? "",
        payLabel(methodOf(t)),
        t.category,
        t.reference ?? "",
        t.notes ?? "",
        t.direction === "in" ? String(t.amount) : "",
        t.direction === "out" ? String(t.amount) : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url; a.download = `cash-flow-${today()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };



  const openAccCreate = () => { setEditingAccId(null); setAccForm({ ...emptyAcc }); setAccOpen(true); };
  const openAccEdit = (a: Account) => {
    setEditingAccId(a.id);
    setAccForm({ name: a.name, type: a.type, opening_balance: Number(a.opening_balance), notes: a.notes ?? "", is_active: a.is_active });
    setAccOpen(true);
  };
  const saveAcc = async () => {
    if (!accForm.name.trim()) { toast.error("Name is required"); return; }
    const payload = {
      name: accForm.name.trim(),
      type: accForm.type,
      opening_balance: Number(accForm.opening_balance) || 0,
      notes: accForm.notes || null,
      is_active: !!accForm.is_active,
    };
    const q = editingAccId
      ? supabase.from("cash_accounts").update(payload).eq("id", editingAccId)
      : supabase.from("cash_accounts").insert(payload);
    const { error } = await q;
    if (error) { toast.error(error.message); return; }
    toast.success(editingAccId ? "Account updated" : "Account added");
    setAccOpen(false);
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
  };
  const deleteAcc = async (id: string) => {
    if (!confirm("Delete this account and all its transactions?")) return;
    const { error } = await supabase.from("cash_accounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });
  };

  const openTxCreate = (dir?: "in" | "out", accId?: string) => {
    setEditingTxId(null);
    setTxForm({ ...emptyTx, direction: dir ?? "in", account_id: accId ?? (accounts[0]?.id ?? "") });
    setTxOpen(true);
  };
  const openTxEdit = (t: Tx) => {
    setEditingTxId(t.id);
    setTxForm({
      account_id: t.account_id, direction: t.direction, amount: Number(t.amount),
      occurred_on: t.occurred_on, category: t.category, reference: t.reference ?? "", notes: t.notes ?? "",
      payment_method: methodOf(t),
    });
    setTxOpen(true);
  };
  const saveTx = async () => {
    if (!txForm.account_id) { toast.error("Choose an account"); return; }
    if (!txForm.amount || Number(txForm.amount) <= 0) { toast.error("Amount must be greater than zero"); return; }
    const payload = {
      account_id: txForm.account_id,
      direction: txForm.direction,
      amount: Number(txForm.amount),
      occurred_on: txForm.occurred_on || today(),
      category: txForm.category || "other",
      reference: txForm.reference || null,
      notes: txForm.notes || null,
      payment_method: txForm.payment_method || "cash",
    };

    const q = editingTxId
      ? supabase.from("cash_transactions").update(payload).eq("id", editingTxId)
      : supabase.from("cash_transactions").insert(payload);
    const { error } = await q;
    if (error) { toast.error(error.message); return; }
    toast.success(editingTxId ? "Entry updated" : "Entry added");
    setTxOpen(false);
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });
  };
  const deleteTx = async (id: string) => {
    if (!confirm("Delete this entry?")) return;
    const { error } = await supabase.from("cash_transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });
  };

  const openTransfer = () => { setTfForm({ ...emptyTransfer }); setTfOpen(true); };
  const openSupplierPay = () => { setSpForm({ ...emptySupplierPay }); setSpOpen(true); };

  // Turn an "auto:<method>" bucket into a real cash_accounts row so it can be referenced by FK
  const materializeAccount = async (id: string): Promise<{ id: string; name: string } | null> => {
    if (!id) return null;
    if (!id.startsWith("auto:")) {
      const a = accounts.find(x => x.id === id);
      return a ? { id: a.id, name: a.name } : null;
    }
    const method = id.slice(5);
    const norm = (s: string) => (s || "").toLowerCase().trim();
    const typeGuess = (m: string): string => {
      const s = norm(m);
      if (!s || s === "cash") return "cash";
      if (s.includes("card")) return "card";
      if (s.includes("bank") || s.includes("online") || s.includes("transfer") || s.includes("cheque") || s.includes("check")) return "bank";
      if (s.includes("easy") || s.includes("jazz") || s.includes("wallet") || s.includes("upi") || s.includes("mobile")) return "mobile_wallet";
      return "other";
    };
    const type = typeGuess(method);
    const name = method.charAt(0).toUpperCase() + method.slice(1);
    const existing = accounts.find(a => a.name.toLowerCase() === name.toLowerCase());
    if (existing) return { id: existing.id, name: existing.name };
    const { data, error } = await supabase.from("cash_accounts")
      .insert({ name, type, opening_balance: 0, is_active: true, notes: "Auto-created from POS bucket" })
      .select("id,name").single();
    if (error) throw error;
    await qc.invalidateQueries({ queryKey: ["cash-accounts"] });
    return { id: data.id as string, name: data.name as string };
  };

  const saveTransfer = async () => {
    if (!tfForm.from_id || !tfForm.to_id) { toast.error("Pick both accounts"); return; }
    if (tfForm.from_id === tfForm.to_id) { toast.error("Choose two different accounts"); return; }
    const amt = Number(tfForm.amount);
    if (!amt || amt <= 0) { toast.error("Amount must be greater than zero"); return; }
    try {
      const from = await materializeAccount(tfForm.from_id);
      const to = await materializeAccount(tfForm.to_id);
      if (!from || !to) { toast.error("Could not resolve accounts"); return; }
      const groupId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const rows = [
        { account_id: from.id, direction: "out", amount: amt, occurred_on: tfForm.occurred_on || today(), category: "transfer", notes: tfForm.notes || null, transfer_group_id: groupId },
        { account_id: to.id, direction: "in", amount: amt, occurred_on: tfForm.occurred_on || today(), category: "transfer", notes: tfForm.notes || null, transfer_group_id: groupId },
      ];
      const { error } = await supabase.from("cash_transactions").insert(rows);
      if (error) { toast.error(error.message); return; }
      toast.success("Transfer recorded");
      setTfOpen(false);
      qc.invalidateQueries({ queryKey: ["cash-transactions"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Transfer failed");
    }
  };

  const saveSupplierPay = async () => {
    if (!spForm.supplier_id) { toast.error("Choose a supplier"); return; }
    if (!spForm.from_id) { toast.error("Choose a payment source account"); return; }
    const amt = Number(spForm.amount);
    if (!amt || amt <= 0) { toast.error("Amount must be greater than zero"); return; }
    try {
      const from = await materializeAccount(spForm.from_id);
      if (!from) { toast.error("Could not resolve source account"); return; }
      const { error } = await supabase.rpc("record_payment", {
        p_party_type: "supplier",
        p_party_id: spForm.supplier_id,
        p_amount: amt,
        p_method: from.name,
        p_note: spForm.note || "",
        p_account_id: from.id,
      });
      if (error) { toast.error(error.message); return; }
      toast.success("Supplier paid");
      setSpOpen(false);
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? "Payment failed");
    }
  };

  const accById = (id: string) => allAccounts.find((a) => a.id === id);
  const fmt = (n: number) => fmtMoney(n, sym);

  const reportRows = useMemo(() => {
    // In current filter window, per-account totals
    return allAccounts.map((a) => {
      let inSum = 0, outSum = 0;
      for (const t of filteredTx) {
        if (t.account_id !== a.id) continue;
        if (t.direction === "in") inSum += Number(t.amount);
        else outSum += Number(t.amount);
      }
      const opening = Number(a.opening_balance);
      const b = balances.get(a.id) ?? { inSum: 0, outSum: 0 };
      const currentBalance = opening + b.inSum - b.outSum;
      return { acc: a, inSum, outSum, net: inSum - outSum, currentBalance };
    });
  }, [accounts, filteredTx, balances]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="h-6 w-6" /> Cash Flow</h1>
          <p className="text-sm text-muted-foreground">Track where every rupee is — till, bank, card, EasyPaisa, JazzCash and more.</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openTransfer}><ArrowLeftRight className="h-4 w-4 mr-2" />Transfer</Button>
            <Button variant="outline" onClick={openSupplierPay}><Truck className="h-4 w-4 mr-2" />Pay supplier</Button>
            <Button variant="outline" onClick={() => openTxCreate("out")}><ArrowUpCircle className="h-4 w-4 mr-2" />Pay out</Button>
            <Button onClick={() => openTxCreate("in")}><ArrowDownCircle className="h-4 w-4 mr-2" />Receive</Button>
            <Button variant="secondary" onClick={openAccCreate}><Plus className="h-4 w-4 mr-2" />New account</Button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "opening" })}
          className="p-4 cursor-pointer hover:shadow-md hover:border-primary/40 transition"
        >
          <div className="text-xs text-muted-foreground">Opening balance</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.opening)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Click to see per-account opening</div>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "in" })}
          className="p-4 cursor-pointer hover:shadow-md hover:border-emerald-500/40 transition"
        >
          <div className="text-xs text-muted-foreground">Total received (POS + manual)</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600">{fmt(totals.inSum)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Sales, customer payments & manual receipts</div>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "out" })}
          className="p-4 cursor-pointer hover:shadow-md hover:border-rose-500/40 transition"
        >
          <div className="text-xs text-muted-foreground">Total paid out</div>
          <div className="text-2xl font-bold mt-1 text-rose-600">{fmt(totals.outSum)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Purchases, expenses, supplier payments & refunds</div>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "balance" })}
          className="p-4 cursor-pointer hover:shadow-md border-primary/40 hover:border-primary transition"
        >
          <div className="text-xs text-muted-foreground">Cash on hand (all accounts)</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.balance)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Click to see per-account balance</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Receivables (credit sales unpaid)</div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{fmt(receivables)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Money customers owe you</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Payables (purchases unpaid)</div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{fmt(payables)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Money you owe suppliers</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Net position</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.balance + receivables - payables)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Cash + receivables − payables</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Auto-synced from POS</div>
          <div className="text-2xl font-bold mt-1">{autoTxs.length}</div>
          <div className="text-[11px] text-muted-foreground mt-1">Sales, returns, purchases, expenses & party payments</div>
        </Card>
      </div>


      <Tabs defaultValue="accounts" className="w-full">
        <TabsList>
          <TabsTrigger value="accounts">Accounts</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        {/* Accounts */}
        <TabsContent value="accounts" className="mt-4">
          {allAccounts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              No accounts yet. Add your Till, Bank, Card terminal, EasyPaisa or JazzCash to get started.
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {allAccounts.map((a) => {
                const Icon = iconFor(a.type);
                const b = balances.get(a.id) ?? { inSum: 0, outSum: 0 };
                const bal = Number(a.opening_balance) + b.inSum - b.outSum;
                const auto = isAutoAcc(a.id);
                return (
                  <Card
                    key={a.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setDetails({ kind: "account", accountId: a.id })}
                    className="p-4 cursor-pointer hover:shadow-md hover:border-primary/40 transition"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center">
                          <Icon className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-semibold">{a.name}</div>
                          <div className="text-xs text-muted-foreground">{labelFor(a.type)}</div>
                        </div>
                      </div>
                      {auto ? <Badge variant="outline">Auto</Badge> : !a.is_active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <div className="mt-3 text-2xl font-bold">{fmt(bal)}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Opening {fmt(Number(a.opening_balance))}</span>
                      <span className="text-emerald-600">In {fmt(b.inSum)}</span>
                      <span className="text-rose-600">Out {fmt(b.outSum)}</span>
                    </div>
                    {isAdmin && !auto && (
                      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="secondary" onClick={() => openTxCreate("in", a.id)}>Receive</Button>
                        <Button size="sm" variant="outline" onClick={() => openTxCreate("out", a.id)}>Pay</Button>
                        <Button size="sm" variant="ghost" onClick={() => openAccEdit(a)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteAcc(a.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                      </div>
                    )}
                    {auto && (
                      <div className="mt-3 text-[11px] text-muted-foreground">Auto bucket from POS. Create a matching account (same name/type) to customize opening balance.</div>
                    )}
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>


        {/* Transactions */}
        <TabsContent value="transactions" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input className="pl-8" placeholder="Search category, reference or notes" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Account</Label>
              <Select value={filterAcc} onValueChange={setFilterAcc}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All accounts</SelectItem>
                  {allAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{isAutoAcc(a.id) ? " · Auto" : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Payment method</Label>
              <Select value={filterMethod} onValueChange={setFilterMethod}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All methods</SelectItem>
                  {PAY_METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <DateRangeBar
              preset={mainPreset}
              from={dateFrom}
              to={dateTo}
              onPreset={setMainPreset}
              onFrom={(v) => { setDateFrom(v); setPage(0); }}
              onTo={(v) => { setDateTo(v); setPage(0); }}
            />

            <Button variant="outline" onClick={exportCsv}>Export CSV</Button>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Reference / Notes</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  {isAdmin && <TableHead className="w-[100px]"></TableHead>}
                </TableRow>

              </TableHeader>
              <TableBody>
                {filteredTx.length === 0 && (
                  <TableRow><TableCell colSpan={isAdmin ? 8 : 7} className="text-center text-muted-foreground py-8">No entries</TableCell></TableRow>
                )}
                {filteredTx.map((t) => {
                  const acc = accById(t.account_id);
                  const auto = isAutoTx(t.id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap">{t.occurred_on}</TableCell>
                      <TableCell className="whitespace-nowrap">{acc?.name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{payLabel(methodOf(t))}</TableCell>
                      <TableCell className="capitalize">

                        {t.category.replace(/_/g, " ")}
                        {auto && <Badge variant="outline" className="ml-2 text-[10px]">Auto</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {t.reference && <span className="font-medium">{t.reference}</span>}
                        {t.reference && t.notes && <span> — </span>}
                        {t.notes && <span className="text-muted-foreground">{t.notes}</span>}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">{t.direction === "in" ? fmt(Number(t.amount)) : ""}</TableCell>
                      <TableCell className="text-right text-rose-600">{t.direction === "out" ? fmt(Number(t.amount)) : ""}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          {!auto ? (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openTxEdit(t)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteTx(t.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">from POS</span>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                 })}
               </TableBody>
             </Table>
             {ledgerPaged.count > PAGE_SIZE_PAGED && (
               <div className="p-4 flex items-center justify-between border-t text-sm">
                 <div className="text-muted-foreground">Showing {page * PAGE_SIZE_PAGED + 1} to {Math.min((page + 1) * PAGE_SIZE_PAGED, ledgerPaged.count)} of {ledgerPaged.count} entries</div>
                 <div className="flex gap-2">
                   <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>Previous</Button>
                   <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE_PAGED >= ledgerPaged.count}>Next</Button>
                 </div>
               </div>
             )}
           </Card>
        </TabsContent>

        {/* Report */}
        <TabsContent value="report" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            <div className="text-xs text-muted-foreground ml-auto">
              {dateFrom || dateTo ? `Filtered ${dateFrom || "…"} → ${dateTo || "…"}` : "Showing all history"}
            </div>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Received (period)</TableHead>
                  <TableHead className="text-right">Paid out (period)</TableHead>
                  <TableHead className="text-right">Net (period)</TableHead>
                  <TableHead className="text-right">Current balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportRows.map((r) => (
                  <TableRow key={r.acc.id}>
                    <TableCell className="font-medium">{r.acc.name}</TableCell>
                    <TableCell className="text-muted-foreground">{labelFor(r.acc.type)}</TableCell>
                    <TableCell className="text-right text-emerald-600">{fmt(r.inSum)}</TableCell>
                    <TableCell className="text-right text-rose-600">{fmt(r.outSum)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(r.net)}</TableCell>
                    <TableCell className="text-right font-bold">{fmt(r.currentBalance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>Totals</TableCell>
                  <TableCell className="text-right text-emerald-600">{fmt(reportRows.reduce((s, r) => s + r.inSum, 0))}</TableCell>
                  <TableCell className="text-right text-rose-600">{fmt(reportRows.reduce((s, r) => s + r.outSum, 0))}</TableCell>
                  <TableCell className="text-right">{fmt(reportRows.reduce((s, r) => s + r.net, 0))}</TableCell>
                  <TableCell className="text-right">{fmt(totals.balance)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Account dialog */}
      <Dialog open={accOpen} onOpenChange={setAccOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editingAccId ? "Edit account" : "New account"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Name *</Label>
              <Input value={accForm.name} onChange={(e) => setAccForm((f: any) => ({ ...f, name: e.target.value }))} placeholder="e.g. Main Till, HBL Bank, EasyPaisa" />
            </div>
            <div>
              <Label>Type</Label>
              <select
                value={accForm.type}
                onChange={(e) => setAccForm((f: any) => ({ ...f, type: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ACC_TYPES.map((t) => (
                  <option key={t.v} value={t.v}>{t.label}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Opening balance</Label>
              <Input type="number" step="0.01" value={accForm.opening_balance} onChange={(e) => setAccForm((f: any) => ({ ...f, opening_balance: e.target.value }))} />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={accForm.notes} onChange={(e) => setAccForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={accForm.is_active} onChange={(e) => setAccForm((f: any) => ({ ...f, is_active: e.target.checked }))} />
              Active
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccOpen(false)}>Cancel</Button>
            <Button onClick={saveAcc}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction dialog */}
      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTxId ? "Edit entry" : txForm.direction === "in" ? "Receive money" : "Pay out"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Direction</Label>
                <Select value={txForm.direction} onValueChange={(v) => setTxForm((f: any) => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Money in</SelectItem>
                    <SelectItem value="out">Money out</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={txForm.occurred_on} onChange={(e) => setTxForm((f: any) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Payment method</Label>
              <Select
                value={txForm.payment_method || "cash"}
                onValueChange={(v) => setTxForm((f: any) => {
                  // Picking a non-bank method keeps the matching account in sync when one exists.
                  const wantType = v === "bank" ? "bank" : v === "card" ? "card" : v === "cash" ? "cash" : "mobile_wallet";
                  const match = accounts.find((a) => a.type === wantType);
                  return { ...f, payment_method: v, account_id: match?.id ?? f.account_id };
                })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAY_METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(txForm.payment_method || "cash") === "bank" ? (
              <div>
                <Label>Select account</Label>
                <Select value={txForm.account_id} onValueChange={(v) => setTxForm((f: any) => ({ ...f, account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose bank account" /></SelectTrigger>
                  <SelectContent>
                    {(accounts.filter((a) => a.type === "bank").length ? accounts.filter((a) => a.type === "bank") : accounts)
                      .map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Account</Label>
                <Select value={txForm.account_id} onValueChange={(v) => setTxForm((f: any) => ({ ...f, account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={txForm.amount} onChange={(e) => setTxForm((f: any) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>Category</Label>
                <Select value={txForm.category} onValueChange={(v) => setTxForm((f: any) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{c.replace(/_/g, " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Reference</Label>
              <Input value={txForm.reference} onChange={(e) => setTxForm((f: any) => ({ ...f, reference: e.target.value }))} placeholder="Invoice #, cheque #, txn id…" />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={txForm.notes} onChange={(e) => setTxForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTxOpen(false)}>Cancel</Button>
            <Button onClick={saveTx}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={tfOpen} onOpenChange={setTfOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Transfer between accounts</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {allAccounts.length < 2 && (
              <div className="text-xs rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
                You need at least two accounts to transfer. Add one from "New account", or start using POS to auto-create buckets.
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>From</Label>
                <Select value={tfForm.from_id} onValueChange={(v) => setTfForm((f: any) => ({ ...f, from_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Source account" /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}{isAutoAcc(a.id) ? " · Auto" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To</Label>
                <Select value={tfForm.to_id} onValueChange={(v) => setTfForm((f: any) => ({ ...f, to_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Destination account" /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}{isAutoAcc(a.id) ? " · Auto" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={tfForm.amount} onChange={(e) => setTfForm((f: any) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={tfForm.occurred_on} onChange={(e) => setTfForm((f: any) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={tfForm.notes} onChange={(e) => setTfForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setTfOpen(false); openSupplierPay(); }}
              >
                <Truck className="h-4 w-4 mr-2" />
                Pay a supplier instead
              </Button>
              <p className="text-[11px] text-muted-foreground mt-1 text-center">
                Deducts from the chosen account and reduces the supplier's ledger balance.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTfOpen(false)}>Cancel</Button>
            <Button onClick={saveTransfer}>Record transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier payment dialog */}
      <Dialog open={spOpen} onOpenChange={setSpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Pay a supplier</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Supplier</Label>
              <Select value={spForm.supplier_id} onValueChange={(v) => {
                const s = (suppliersQ.data ?? []).find((x: any) => x.id === v);
                const owed = Math.max(Number(s?.balance ?? 0), 0);
                setSpForm((f: any) => ({ ...f, supplier_id: v, amount: f.amount || owed }));
              }}>
                <SelectTrigger><SelectValue placeholder="Choose supplier" /></SelectTrigger>
                <SelectContent>
                  {(suppliersQ.data ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{Number(s.balance) > 0 ? ` · owed ${fmt(Number(s.balance))}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Payment source (cash in hand, bank, wallet…)</Label>
              <Select value={spForm.from_id} onValueChange={(v) => setSpForm((f: any) => ({ ...f, from_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>
                  {allAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{isAutoAcc(a.id) ? " · Auto" : ""} — {labelFor(a.type)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Amount</Label>
                <Input type="number" step="0.01" value={spForm.amount} onChange={(e) => setSpForm((f: any) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>Date</Label>
                <Input type="date" value={spForm.occurred_on} onChange={(e) => setSpForm((f: any) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Note</Label>
              <Input value={spForm.note} onChange={(e) => setSpForm((f: any) => ({ ...f, note: e.target.value }))} placeholder="Optional reference" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpOpen(false)}>Cancel</Button>
            <Button onClick={saveSupplierPay}>Pay supplier</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Details dialog */}
      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <DialogContent className="w-[95vw] max-w-6xl max-h-[90vh] flex flex-col">
          {(() => {
            if (!details) return null;
            if (details.kind === "opening" || details.kind === "balance") {
              const title = details.kind === "opening" ? "Opening balance — per account" : "Cash on hand — per account";
              const perAcc = new Map<string, { prior: number; inSum: number; outSum: number }>();
              for (const a of allAccounts) perAcc.set(a.id, { prior: 0, inSum: 0, outSum: 0 });
              for (const t of txs) {
                const r = perAcc.get(t.account_id);
                if (!r) continue;
                const amt = Number(t.amount);
                if (dFrom && t.occurred_on < dFrom) { r.prior += t.direction === "in" ? amt : -amt; continue; }
                if (dTo && t.occurred_on > dTo) continue;
                if (t.direction === "in") r.inSum += amt; else r.outSum += amt;
              }
              return (
                <>
                  <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
                  <DateRangeBar preset={dPreset} from={dFrom} to={dTo} onPreset={setDPreset} onFrom={setDFrom} onTo={setDTo} />
                  <div className="flex-1 overflow-auto min-h-0 mt-4">
                    <Table className="w-full">
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead className="text-right">Opening</TableHead>
                          <TableHead className="text-right">In</TableHead>
                          <TableHead className="text-right">Out</TableHead>
                          <TableHead className="text-right">Balance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {allAccounts.map((a) => {
                          const r = perAcc.get(a.id) ?? { prior: 0, inSum: 0, outSum: 0 };
                          const opening = Number(a.opening_balance) + r.prior;
                          const bal = opening + r.inSum - r.outSum;
                          return (
                            <TableRow key={a.id}>
                              <TableCell className="font-medium">{a.name}</TableCell>
                              <TableCell className="text-muted-foreground">{labelFor(a.type)}</TableCell>
                              <TableCell className="text-right">{fmt(opening)}</TableCell>
                              <TableCell className="text-right text-emerald-600">{fmt(r.inSum)}</TableCell>
                              <TableCell className="text-right text-rose-600">{fmt(r.outSum)}</TableCell>
                              <TableCell className="text-right font-bold">{fmt(bal)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </>
              );
            }

            const dir = details.kind === "in" ? "in" : details.kind === "out" ? "out" : null;
            const accId = details.kind === "account" ? details.accountId : null;
            const scope = txs.filter((t) => {
              if (dir && t.direction !== dir) return false;
              if (accId && t.account_id !== accId) return false;
              if (dFilterAcc !== "all" && t.account_id !== dFilterAcc) return false;
              if (dFilterMethod !== "all" && methodOf(t) !== dFilterMethod) return false;
              return true;
            });
            const list = scope
              .filter((t) => (!dFrom || t.occurred_on >= dFrom) && (!dTo || t.occurred_on <= dTo))
              .sort((a, b) =>
                String(b.occurred_on).localeCompare(String(a.occurred_on)) ||
                String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")) ||
                String(b.id).localeCompare(String(a.id)),
              );

            const inTot = list.filter((t) => t.direction === "in").reduce((s, t) => s + Number(t.amount), 0);
            const outTot = list.filter((t) => t.direction === "out").reduce((s, t) => s + Number(t.amount), 0);
            const baseOpening = accId
              ? Number(accById(accId)?.opening_balance ?? 0)
              : allAccounts.reduce((s, a) => s + Number(a.opening_balance ?? 0), 0);
            // Everything before the selected window rolls into the opening balance
            let prior = 0;
            if (dFrom) {
              for (const t of scope) {
                if (t.occurred_on >= dFrom) continue;
                prior += t.direction === "in" ? Number(t.amount) : -Number(t.amount);
              }
            }
            const openingBal = baseOpening + prior;
            // Running balance (oldest → newest), then map back to display order
            const asc = [...list].reverse();
            const runMap = new Map<string, number>();
            let run = openingBal;
            for (const t of asc) {
              run += t.direction === "in" ? Number(t.amount) : -Number(t.amount);
              runMap.set(t.id, run);
            }
            const closingBal = openingBal + inTot - outTot;

            const title =
              details.kind === "in" ? "Every payment received"
              : details.kind === "out" ? "Every payment sent"
              : `${accById(accId!)?.name ?? "Account"} — full history`;
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <DateRangeBar preset={dPreset} from={dFrom} to={dTo} onPreset={setDPreset} onFrom={setDFrom} onTo={setDTo} />
                  
                  {!accId && (
                    <Select value={dFilterAcc} onValueChange={setDFilterAcc}>
                      <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder="All Accounts" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Accounts</SelectItem>
                        {allAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}

                  <Select value={dFilterMethod} onValueChange={setDFilterMethod}>
                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder="All Methods" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Methods</SelectItem>
                      {PAY_METHODS.map(m => <SelectItem key={m.v} value={m.v}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>


                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-2">
                  <StatMini label="Opening" value={fmt(openingBal)} />
                  <StatMini label="Period In" value={fmt(inTot)} tone="success" />
                  <StatMini label="Period Out" value={fmt(outTot)} tone="destructive" />
                  <StatMini label="Closing" value={fmt(closingBal)} />
                </div>
                <div className="flex-1 overflow-auto min-h-0 border rounded-md">

                  <Table className="w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">Date</TableHead>
                        {!accId && <TableHead>Account</TableHead>}
                        <TableHead>Method</TableHead>
                        <TableHead>Category</TableHead>
                        <TableHead>Reference / Notes</TableHead>
                        <TableHead className="text-right">In</TableHead>
                        <TableHead className="text-right">Out</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.length === 0 && (
                        <TableRow><TableCell colSpan={accId ? 7 : 8} className="text-center text-muted-foreground py-8">No entries</TableCell></TableRow>
                      )}
                      {list.map((t) => {
                        const acc = accById(t.account_id);
                        return (
                          <TableRow key={t.id}>
                            <TableCell>{t.occurred_on}</TableCell>
                            {!accId && <TableCell>{acc?.name ?? "—"}</TableCell>}
                            <TableCell>{payLabel(methodOf(t))}</TableCell>
                            <TableCell className="capitalize">{t.category.replace(/_/g, " ")}</TableCell>

                            <TableCell className="max-w-[260px] break-words">
                              {t.reference && <span className="font-medium">{t.reference}</span>}
                              {t.reference && t.notes && <span> — </span>}
                              {t.notes && <span className="text-muted-foreground">{t.notes}</span>}
                            </TableCell>
                            <TableCell className="text-right text-emerald-600">{t.direction === "in" ? fmt(Number(t.amount)) : ""}</TableCell>
                            <TableCell className="text-right text-rose-600">{t.direction === "out" ? fmt(Number(t.amount)) : ""}</TableCell>
                            <TableCell className="text-right font-semibold">{fmt(runMap.get(t.id) ?? 0)}</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </>
            );
          })()}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetails(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatMini({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  const colors: Record<string, string> = { success: "text-success", destructive: "text-destructive" };
  return (
    <div className="bg-muted/30 p-2 rounded">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-bold ${tone ? colors[tone] : ""}`}>{value}</div>
    </div>
  );
}
