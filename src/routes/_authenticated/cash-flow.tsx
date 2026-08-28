import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation();
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
      {pick(from, onFrom, t('cash_flow.from_placeholder', 'From'))}
      {pick(to, onTo, t('cash_flow.to_placeholder', 'To'))}
      {(from || to) && (
        <Button variant="ghost" size="sm" className="h-8" onClick={() => { onPreset("all"); onFrom(""); onTo(""); }}>{t('cash_flow.clear', 'Clear')}</Button>
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
  const { t } = useTranslation();
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
  const [mainPreset, setMainPreset] = useState<DatePreset>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [userPicked, setUserPicked] = useState(false);

  const { data: earliest } = useQuery({
    queryKey: ["earliest-cf-date"],
    queryFn: async () => {
      const { data } = await supabase
        .from("cash_transactions")
        .select("created_at")
        .order("created_at", { ascending: true })
        .limit(1);
      const v = (data?.[0] as any)?.created_at;
      return v ? v.slice(0, 10) : null;
    },
  });

  useEffect(() => {
    if (userPicked || !earliest) return;
    setDateFrom(earliest);
    
    // Always include at least tomorrow in Pakistan Time to ensure today's 
    // data is visible even with timezone offsets.
    const now = new Date();
    const tomorrow = new Date(now.getTime() + (5 + 24) * 60 * 60 * 1000);
    setDateTo(tomorrow.toISOString().slice(0, 10));
  }, [earliest, userPicked]);

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
        p_from_date: dateFrom ? `${dateFrom}T00:00:00` : "2000-01-01T00:00:00",
        p_to_date: dateTo ? `${dateTo}T23:59:59` : "2099-12-31T23:59:59",
        p_account_id: filterAcc === "all" ? undefined : filterAcc
      });
      if (error) throw error;
      return data;
    },
  });
  const summary = (summaryStatsRaw as any) || { total_in: 0, total_out: 0, opening: 0, balance: 0, receivables: 0, payables: 0 };

  const { data: ledgerPaged = { data: [], count: 0 }, isLoading: ledgerLoading } = useQuery({
    queryKey: ["cf-ledger-paged", dateFrom, dateTo, filterAcc, filterMethod, search, page],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_ledger", {
        p_from_date: dateFrom ? `${dateFrom}T00:00:00` : "2000-01-01T00:00:00",
        p_to_date: dateTo ? `${dateTo}T23:59:59` : "2099-12-31T23:59:59",
        p_account_id: filterAcc === "all" ? undefined : filterAcc,
        p_payment_method: filterMethod === "all" ? undefined : filterMethod,
        p_search: search || undefined,
        p_limit: PAGE_SIZE_PAGED,
        p_offset: page * PAGE_SIZE_PAGED
      });
      if (error) throw error;
      const rows = data || [];
      const totalCount = rows.length > 0 ? Number(rows[0].total_count) : 0;
      // map RPC response to Tx type, adding required fields if missing
      const mapped = rows.map((row: any) => ({
        ...row,
        transfer_group_id: row.transfer_group_id || null,
        payment_method: row.payment_method || null
      })) as Tx[];
      return { data: mapped, count: totalCount };
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
      opening: Number(summary.opening || 0),
      in: Number(summary.total_in || 0),
      out: Number(summary.total_out || 0),
      balance: Number(summary.balance || 0),
    };
  }, [summary]);

  const isAutoTx = (id: string) => id.startsWith("auto:");
  const isAutoAcc = (id: string) => id.startsWith("auto:");

  /** Per-account in/out for the WHOLE selected period (server-side aggregate).
   *  The transactions table is paged (50 rows), so account cards and the report
   *  must never be summed from `txs` — that showed only page 1 of the history. */
  const { data: accountTotalsRaw } = useQuery({
    queryKey: ["cf-account-totals", dateFrom, dateTo],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_cash_flow_account_totals", {
        p_from_date: dateFrom ? `${dateFrom}T00:00:00` : "2000-01-01T00:00:00",
        p_to_date: dateTo ? `${dateTo}T23:59:59` : "2099-12-31T23:59:59",
      });
      if (error) throw error;
      return (data ?? []) as { account_id: string | null; total_in: number; total_out: number; entry_count: number }[];
    },
  });

  /** Drill-down dialogs need the FULL history (day 1 → today) so opening/prior
   *  balances and running balances are correct. Only fetched while a dialog is open.
   *  PostgREST caps a single response (~1000 rows), so page through the ledger and
   *  scope the fetch to the selected account when the dialog is account-specific. */
  const detailAccountId = details?.kind === "account" ? details.accountId : null;
  const { data: detailTxs = [] } = useQuery({
    queryKey: ["cf-ledger-full", detailAccountId ?? "all"],
    enabled: !!details,
    staleTime: 60_000,
    queryFn: async () => {
      const CHUNK = 1000;
      const rows: any[] = [];
      for (let offset = 0; ; offset += CHUNK) {
        const { data, error } = await supabase.rpc("get_cash_flow_ledger", {
          p_from_date: "2000-01-01T00:00:00",
          p_to_date: "2099-12-31T23:59:59",
          p_limit: CHUNK,
          p_offset: offset,
          ...(detailAccountId ? { p_account_id: detailAccountId } : {}),
        });
        if (error) throw error;
        const batch = data ?? [];
        rows.push(...batch);
        const total = Number((batch[0] as any)?.total_count ?? 0);
        if (batch.length < CHUNK || (total && rows.length >= total) || offset > 200000) break;
      }
      return rows.map((row: any) => ({
        ...row,
        transfer_group_id: row.transfer_group_id || null,
        payment_method: row.payment_method || null,
      })) as Tx[];
    },
  });



  const balances = useMemo(() => {
    const map = new Map<string, { inSum: number; outSum: number }>();
    for (const a of accounts) map.set(a.id, { inSum: 0, outSum: 0 });
    for (const row of accountTotalsRaw ?? []) {
      if (!row.account_id) continue;
      map.set(row.account_id, { inSum: Number(row.total_in || 0), outSum: Number(row.total_out || 0) });
    }
    return map;
  }, [accounts, accountTotalsRaw]);

  /** Headline figures always come from the server summary (full period). */
  const totals = useMemo(
    () => ({ opening: stats.opening, inSum: stats.in, outSum: stats.out, balance: stats.balance }),
    [stats],
  );

  // Receivables (credit sales unpaid) / Payables (purchases unpaid)
  const receivables = Number(summary.receivables || 0);
  const payables = Number(summary.payables || 0);

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
    if (!accForm.name.trim()) { toast.error(t('cash_flow.toast_name_required', 'Name is required')); return; }
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
    toast.success(editingAccId ? t('cash_flow.toast_account_updated', 'Account updated') : t('cash_flow.toast_account_added', 'Account added'));
    setAccOpen(false);
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
  };
  const deleteAcc = async (id: string) => {
    if (!confirm(t('cash_flow.confirm_delete_account', 'Delete this account and all its transactions?'))) return;
    const { error } = await supabase.from("cash_accounts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('cash_flow.toast_deleted', 'Deleted'));
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
    if (!txForm.account_id) { toast.error(t('cash_flow.toast_choose_account', 'Choose an account')); return; }
    if (!txForm.amount || Number(txForm.amount) <= 0) { toast.error(t('cash_flow.toast_amount_gt_zero', 'Amount must be greater than zero')); return; }
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
    toast.success(editingTxId ? t('cash_flow.toast_entry_updated', 'Entry updated') : t('cash_flow.toast_entry_added', 'Entry added'));
    setTxOpen(false);
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });
  };
  const deleteTx = async (id: string) => {
    if (!confirm(t('cash_flow.confirm_delete_entry', 'Delete this entry?'))) return;
    const { error } = await supabase.from("cash_transactions").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(t('cash_flow.toast_deleted', 'Deleted'));
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
    if (!tfForm.from_id || !tfForm.to_id) { toast.error(t('cash_flow.toast_pick_both_accounts', 'Pick both accounts')); return; }
    if (tfForm.from_id === tfForm.to_id) { toast.error(t('cash_flow.toast_choose_two_different', 'Choose two different accounts')); return; }
    const amt = Number(tfForm.amount);
    if (!amt || amt <= 0) { toast.error(t('cash_flow.toast_amount_gt_zero', 'Amount must be greater than zero')); return; }
    try {
      const from = await materializeAccount(tfForm.from_id);
      const to = await materializeAccount(tfForm.to_id);
      if (!from || !to) { toast.error(t('cash_flow.toast_could_not_resolve_accounts', 'Could not resolve accounts')); return; }
      const groupId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      const rows = [
        { account_id: from.id, direction: "out", amount: amt, occurred_on: tfForm.occurred_on || today(), category: "transfer", notes: tfForm.notes || null, transfer_group_id: groupId },
        { account_id: to.id, direction: "in", amount: amt, occurred_on: tfForm.occurred_on || today(), category: "transfer", notes: tfForm.notes || null, transfer_group_id: groupId },
      ];
      const { error } = await supabase.from("cash_transactions").insert(rows);
      if (error) { toast.error(error.message); return; }
      toast.success(t('cash_flow.toast_transfer_recorded', 'Transfer recorded'));
      setTfOpen(false);
      qc.invalidateQueries({ queryKey: ["cash-transactions"] });
    } catch (e: any) {
      toast.error(e?.message ?? t('cash_flow.toast_transfer_failed', 'Transfer failed'));
    }
  };

  const saveSupplierPay = async () => {
    if (!spForm.supplier_id) { toast.error(t('cash_flow.toast_choose_supplier', 'Choose a supplier')); return; }
    if (!spForm.from_id) { toast.error(t('cash_flow.toast_choose_source_account', 'Choose a payment source account')); return; }
    const amt = Number(spForm.amount);
    if (!amt || amt <= 0) { toast.error(t('cash_flow.toast_amount_gt_zero', 'Amount must be greater than zero')); return; }
    try {
      const from = await materializeAccount(spForm.from_id);
      if (!from) { toast.error(t('cash_flow.toast_could_not_resolve_source', 'Could not resolve source account')); return; }
      const { error } = await supabase.rpc("record_payment", {
        p_party_type: "supplier",
        p_party_id: spForm.supplier_id,
        p_amount: amt,
        p_method: from.name,
        p_note: spForm.note || "",
        p_account_id: from.id,
      });
      if (error) { toast.error(error.message); return; }
      toast.success(t('cash_flow.toast_supplier_paid', 'Supplier paid'));
      setSpOpen(false);
      qc.invalidateQueries();
    } catch (e: any) {
      toast.error(e?.message ?? t('cash_flow.toast_payment_failed', 'Payment failed'));
    }
  };

  const accById = (id: string) => allAccounts.find((a) => a.id === id);
  const fmt = (n: number) => fmtMoney(n, sym);

  const reportRows = useMemo(() => {
    // Per-account totals for the WHOLE selected period (server aggregate, not the current page)
    return allAccounts.map((a) => {
      const b = balances.get(a.id) ?? { inSum: 0, outSum: 0 };
      const opening = Number(a.opening_balance);
      const currentBalance = opening + b.inSum - b.outSum;
      return { acc: a, inSum: b.inSum, outSum: b.outSum, net: b.inSum - b.outSum, currentBalance };
    });
  }, [allAccounts, balances]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Coins className="h-6 w-6" /> {t('cash_flow.page_title', 'Cash Flow')}</h1>
          <p className="text-sm text-muted-foreground">{t('cash_flow.page_desc', 'Track where every rupee is — till, bank, card, EasyPaisa, JazzCash and more.')}</p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={openTransfer}><ArrowLeftRight className="h-4 w-4 mr-2" />{t('cash_flow.btn_transfer', 'Transfer')}</Button>
            <Button variant="outline" onClick={openSupplierPay}><Truck className="h-4 w-4 mr-2" />{t('cash_flow.btn_pay_supplier', 'Pay supplier')}</Button>
            <Button variant="outline" onClick={() => openTxCreate("out")}><ArrowUpCircle className="h-4 w-4 mr-2" />{t('cash_flow.btn_pay_out', 'Pay out')}</Button>
            <Button onClick={() => openTxCreate("in")}><ArrowDownCircle className="h-4 w-4 mr-2" />{t('cash_flow.btn_receive', 'Receive')}</Button>
            <Button variant="secondary" onClick={openAccCreate}><Plus className="h-4 w-4 mr-2" />{t('cash_flow.btn_new_account', 'New account')}</Button>
          </div>
        )}
      </div>

      {/* Global date filter */}
      <DateRangeBar
        preset={mainPreset}
        from={dateFrom}
        to={dateTo}
        onPreset={(p) => {
          setUserPicked(true);
          setMainPreset(p);
          if (p === "all") {
            setDateFrom(earliest || "");
            const now = new Date();
            const tomorrow = new Date(now.getTime() + (5 + 24) * 60 * 60 * 1000);
            setDateTo(tomorrow.toISOString().slice(0, 10));
          }
        }}
        onFrom={(v) => { setUserPicked(true); setDateFrom(v); setPage(0); }}
        onTo={(v) => { setUserPicked(true); setDateTo(v); setPage(0); }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "opening" })}
          className="p-4 cursor-pointer hover:shadow-md hover:border-primary/40 transition"
        >
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_opening', 'Opening balance')}</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.opening)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_opening_sub', 'Click to see per-account opening')}</div>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "in" })}
          className="p-4 cursor-pointer hover:shadow-md hover:border-emerald-500/40 transition"
        >
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_total_received', 'Total received (POS + manual)')}</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600">{fmt(totals.inSum)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_total_received_sub', 'Sales, customer payments & manual receipts')}</div>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "out" })}
          className="p-4 cursor-pointer hover:shadow-md hover:border-rose-500/40 transition"
        >
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_total_paid', 'Total paid out')}</div>
          <div className="text-2xl font-bold mt-1 text-rose-600">{fmt(totals.outSum)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_total_paid_sub', 'Purchases, expenses, supplier payments & refunds')}</div>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setDetails({ kind: "balance" })}
          className="p-4 cursor-pointer hover:shadow-md border-primary/40 hover:border-primary transition"
        >
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_cash_on_hand', 'Cash on hand (all accounts)')}</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.balance)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_cash_on_hand_sub', 'Click to see per-account balance')}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_receivables', 'Receivables (credit sales unpaid)')}</div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{fmt(receivables)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_receivables_sub', 'Money customers owe you')}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_payables', 'Payables (purchases unpaid)')}</div>
          <div className="text-2xl font-bold mt-1 text-amber-600">{fmt(payables)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_payables_sub', 'Money you owe suppliers')}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_net_position', 'Net position')}</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.balance + receivables - payables)}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_net_position_sub', 'Cash + receivables − payables')}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">{t('cash_flow.card_auto_synced', 'Auto-synced from POS')}</div>
          <div className="text-2xl font-bold mt-1">{ledgerPaged.count}</div>
          <div className="text-[11px] text-muted-foreground mt-1">{t('cash_flow.card_auto_synced_sub', 'Sales, returns, purchases, expenses & party payments')}</div>
        </Card>
      </div>


      <Tabs defaultValue="accounts" className="w-full">
        <TabsList>
          <TabsTrigger value="accounts">{t('cash_flow.tab_accounts', 'Accounts')}</TabsTrigger>
          <TabsTrigger value="transactions">{t('cash_flow.tab_transactions', 'Transactions')}</TabsTrigger>
          <TabsTrigger value="report">{t('cash_flow.tab_report', 'Report')}</TabsTrigger>
        </TabsList>

        {/* Accounts */}
        <TabsContent value="accounts" className="mt-4">
          {allAccounts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              {t('cash_flow.no_accounts', 'No accounts yet. Add your Till, Bank, Card terminal, EasyPaisa or JazzCash to get started.')}
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
                          <div className="text-xs text-muted-foreground">{t(`cash_flow.acc_type_${a.type}`, labelFor(a.type))}</div>
                        </div>
                      </div>
                      {auto ? <Badge variant="outline">{t('cash_flow.badge_auto', 'Auto')}</Badge> : !a.is_active && <Badge variant="secondary">{t('cash_flow.badge_inactive', 'Inactive')}</Badge>}
                    </div>
                    <div className="mt-3 text-2xl font-bold">{fmt(bal)}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{t('cash_flow.opening_prefix', 'Opening {{amount}}', { amount: fmt(Number(a.opening_balance)) })}</span>
                      <span className="text-emerald-600">{t('cash_flow.in_prefix', 'In {{amount}}', { amount: fmt(b.inSum) })}</span>
                      <span className="text-rose-600">{t('cash_flow.out_prefix', 'Out {{amount}}', { amount: fmt(b.outSum) })}</span>
                    </div>
                    {isAdmin && !auto && (
                      <div className="mt-3 flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="secondary" onClick={() => openTxCreate("in", a.id)}>{t('cash_flow.btn_receive_small', 'Receive')}</Button>
                        <Button size="sm" variant="outline" onClick={() => openTxCreate("out", a.id)}>{t('cash_flow.btn_pay_small', 'Pay')}</Button>
                        <Button size="sm" variant="ghost" onClick={() => openAccEdit(a)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteAcc(a.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                      </div>
                    )}
                    {auto && (
                      <div className="mt-3 text-[11px] text-muted-foreground">{t('cash_flow.auto_bucket_note', 'Auto bucket from POS. Create a matching account (same name/type) to customize opening balance.')}</div>
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
              <Input className="pl-8" placeholder={t('cash_flow.search_placeholder', 'Search category, reference or notes')} value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t('cash_flow.account_label', 'Account')}</Label>
              <Select value={filterAcc} onValueChange={setFilterAcc}>
                <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('cash_flow.all_accounts', 'All accounts')}</SelectItem>
                  {allAccounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}{isAutoAcc(a.id) ? t('cash_flow.auto_suffix', ' · Auto') : ""}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t('cash_flow.payment_method_label', 'Payment method')}</Label>
              <Select value={filterMethod} onValueChange={setFilterMethod}>
                <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('cash_flow.all_methods', 'All methods')}</SelectItem>
                  {PAY_METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{t(`cash_flow.pay_method_${m.v}`, m.label)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={exportCsv}>{t('cash_flow.export_csv', 'Export CSV')}</Button>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('sales.th_date', 'Date')}</TableHead>
                  <TableHead>{t('cash_flow.th_account', 'Account')}</TableHead>
                  <TableHead>{t('sales.th_method', 'Method')}</TableHead>
                  <TableHead>{t('reports.th_category', 'Category')}</TableHead>
                  <TableHead>{t('cash_flow.th_reference_notes', 'Reference / Notes')}</TableHead>
                  <TableHead className="text-right">{t('cash_flow.th_in', 'In')}</TableHead>
                  <TableHead className="text-right">{t('cash_flow.th_out', 'Out')}</TableHead>
                  {isAdmin && <TableHead className="w-[100px]"></TableHead>}
                </TableRow>

              </TableHeader>
              <TableBody>
                {filteredTx.length === 0 && (
                  <TableRow><TableCell colSpan={isAdmin ? 8 : 7} className="text-center text-muted-foreground py-8">{t('cash_flow.no_entries', 'No entries')}</TableCell></TableRow>
                )}
                {filteredTx.map((tx) => {
                  const acc = accById(tx.account_id);
                  const auto = isAutoTx(tx.id);
                  return (
                    <TableRow key={tx.id}>
                      <TableCell className="whitespace-nowrap">{tx.occurred_on}</TableCell>
                      <TableCell className="whitespace-nowrap">{acc?.name ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">{t(`cash_flow.pay_method_${methodOf(tx)}`, payLabel(methodOf(tx)))}</TableCell>
                      <TableCell className="capitalize">

                        {t(`cash_flow.category_${tx.category}`, tx.category.replace(/_/g, " "))}
                        {auto && <Badge variant="outline" className="ml-2 text-[10px]">{t('cash_flow.badge_auto', 'Auto')}</Badge>}
                      </TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {tx.reference && <span className="font-medium">{tx.reference}</span>}
                        {tx.reference && tx.notes && <span> — </span>}
                        {tx.notes && <span className="text-muted-foreground">{tx.notes}</span>}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">{tx.direction === "in" ? fmt(Number(tx.amount)) : ""}</TableCell>
                      <TableCell className="text-right text-rose-600">{tx.direction === "out" ? fmt(Number(tx.amount)) : ""}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          {!auto ? (
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={() => openTxEdit(tx)}><Pencil className="h-4 w-4" /></Button>
                              <Button size="icon" variant="ghost" onClick={() => deleteTx(tx.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">{t('cash_flow.from_pos', 'from POS')}</span>
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
                 <div className="text-muted-foreground">{t('cash_flow.showing_entries', 'Showing {{from}} to {{to}} of {{total}} entries', { from: page * PAGE_SIZE_PAGED + 1, to: Math.min((page + 1) * PAGE_SIZE_PAGED, ledgerPaged.count), total: ledgerPaged.count })}</div>
                 <div className="flex gap-2">
                   <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>{t('reports.previous', 'Previous')}</Button>
                   <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE_PAGED >= ledgerPaged.count}>{t('reports.next', 'Next')}</Button>
                 </div>
               </div>
             )}
           </Card>
        </TabsContent>

        {/* Report */}
        <TabsContent value="report" className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="text-xs text-muted-foreground ml-auto">
              {dateFrom || dateTo ? t('cash_flow.filtered_label', 'Filtered {{from}} → {{to}}', { from: dateFrom || "…", to: dateTo || "…" }) : t('cash_flow.showing_all_history', 'Showing all history')}
            </div>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('cash_flow.th_account', 'Account')}</TableHead>
                  <TableHead>{t('reports.th_type', 'Type')}</TableHead>
                  <TableHead className="text-right">{t('cash_flow.th_received_period', 'Received (period)')}</TableHead>
                  <TableHead className="text-right">{t('cash_flow.th_paid_period', 'Paid out (period)')}</TableHead>
                  <TableHead className="text-right">{t('cash_flow.th_net_period', 'Net (period)')}</TableHead>
                  <TableHead className="text-right">{t('cash_flow.th_current_balance', 'Current balance')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportRows.map((r) => (
                  <TableRow key={r.acc.id}>
                    <TableCell className="font-medium">{r.acc.name}</TableCell>
                    <TableCell className="text-muted-foreground">{t(`cash_flow.acc_type_${r.acc.type}`, labelFor(r.acc.type))}</TableCell>
                    <TableCell className="text-right text-emerald-600">{fmt(r.inSum)}</TableCell>
                    <TableCell className="text-right text-rose-600">{fmt(r.outSum)}</TableCell>
                    <TableCell className={`text-right font-medium ${r.net >= 0 ? "text-emerald-600" : "text-rose-600"}`}>{fmt(r.net)}</TableCell>
                    <TableCell className="text-right font-bold">{fmt(r.currentBalance)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={2}>{t('cash_flow.totals_label', 'Totals')}</TableCell>
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
          <DialogHeader><DialogTitle>{editingAccId ? t('cash_flow.edit_account', 'Edit account') : t('cash_flow.new_account_title', 'New account')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('cash_flow.name_required_label', 'Name *')}</Label>
              <Input value={accForm.name} onChange={(e) => setAccForm((f: any) => ({ ...f, name: e.target.value }))} placeholder={t('cash_flow.name_placeholder', 'e.g. Main Till, HBL Bank, EasyPaisa')} />
            </div>
            <div>
              <Label>{t('cash_flow.type_label', 'Type')}</Label>
              <select
                value={accForm.type}
                onChange={(e) => setAccForm((f: any) => ({ ...f, type: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {ACC_TYPES.map((opt) => (
                  <option key={opt.v} value={opt.v}>{t(`cash_flow.acc_type_${opt.v}`, opt.label)}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>{t('cash_flow.opening_balance_label', 'Opening balance')}</Label>
              <Input type="number" step="0.01" value={accForm.opening_balance} onChange={(e) => setAccForm((f: any) => ({ ...f, opening_balance: e.target.value }))} />
            </div>
            <div>
              <Label>{t('cash_flow.notes_label', 'Notes')}</Label>
              <Textarea value={accForm.notes} onChange={(e) => setAccForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={accForm.is_active} onChange={(e) => setAccForm((f: any) => ({ ...f, is_active: e.target.checked }))} />
              {t('cash_flow.active_label', 'Active')}
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAccOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={saveAcc}>{t('common.save', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transaction dialog */}
      <Dialog open={txOpen} onOpenChange={setTxOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTxId ? t('cash_flow.edit_entry', 'Edit entry') : txForm.direction === "in" ? t('cash_flow.receive_money', 'Receive money') : t('cash_flow.pay_out_title', 'Pay out')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('cash_flow.direction_label', 'Direction')}</Label>
                <Select value={txForm.direction} onValueChange={(v) => setTxForm((f: any) => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">{t('cash_flow.money_in', 'Money in')}</SelectItem>
                    <SelectItem value="out">{t('cash_flow.money_out', 'Money out')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('cash_flow.date_label', 'Date')}</Label>
                <Input type="date" value={txForm.occurred_on} onChange={(e) => setTxForm((f: any) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>{t('cash_flow.payment_method_label', 'Payment method')}</Label>
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
                  {PAY_METHODS.map((m) => <SelectItem key={m.v} value={m.v}>{t(`cash_flow.pay_method_${m.v}`, m.label)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(txForm.payment_method || "cash") === "bank" ? (
              <div>
                <Label>{t('cash_flow.select_account_label', 'Select account')}</Label>
                <Select value={txForm.account_id} onValueChange={(v) => setTxForm((f: any) => ({ ...f, account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={t('cash_flow.choose_bank_account', 'Choose bank account')} /></SelectTrigger>
                  <SelectContent>
                    {(accounts.filter((a) => a.type === "bank").length ? accounts.filter((a) => a.type === "bank") : accounts)
                      .map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>{t('cash_flow.account_label', 'Account')}</Label>
                <Select value={txForm.account_id} onValueChange={(v) => setTxForm((f: any) => ({ ...f, account_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={t('cash_flow.choose_account', 'Choose account')} /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('common.amount', 'Amount')}</Label>
                <Input type="number" step="0.01" value={txForm.amount} onChange={(e) => setTxForm((f: any) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>{t('cash_flow.category_label', 'Category')}</Label>
                <Select value={txForm.category} onValueChange={(v) => setTxForm((f: any) => ({ ...f, category: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => <SelectItem key={c} value={c} className="capitalize">{t(`cash_flow.category_${c}`, c.replace(/_/g, " "))}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>{t('cash_flow.reference_label', 'Reference')}</Label>
              <Input value={txForm.reference} onChange={(e) => setTxForm((f: any) => ({ ...f, reference: e.target.value }))} placeholder={t('cash_flow.reference_placeholder', 'Invoice #, cheque #, txn id…')} />
            </div>
            <div>
              <Label>{t('cash_flow.notes_label', 'Notes')}</Label>
              <Textarea value={txForm.notes} onChange={(e) => setTxForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTxOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={saveTx}>{t('common.save', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Transfer dialog */}
      <Dialog open={tfOpen} onOpenChange={setTfOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('cash_flow.transfer_between', 'Transfer between accounts')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {allAccounts.length < 2 && (
              <div className="text-xs rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-amber-700">
                {t('cash_flow.need_two_accounts', 'You need at least two accounts to transfer. Add one from "New account", or start using POS to auto-create buckets.')}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('cash_flow.from_label', 'From')}</Label>
                <Select value={tfForm.from_id} onValueChange={(v) => setTfForm((f: any) => ({ ...f, from_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={t('cash_flow.source_account_placeholder', 'Source account')} /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}{isAutoAcc(a.id) ? t('cash_flow.auto_suffix', ' · Auto') : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('cash_flow.to_label', 'To')}</Label>
                <Select value={tfForm.to_id} onValueChange={(v) => setTfForm((f: any) => ({ ...f, to_id: v }))}>
                  <SelectTrigger><SelectValue placeholder={t('cash_flow.destination_account_placeholder', 'Destination account')} /></SelectTrigger>
                  <SelectContent>
                    {allAccounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}{isAutoAcc(a.id) ? t('cash_flow.auto_suffix', ' · Auto') : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('common.amount', 'Amount')}</Label>
                <Input type="number" step="0.01" value={tfForm.amount} onChange={(e) => setTfForm((f: any) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>{t('cash_flow.date_label', 'Date')}</Label>
                <Input type="date" value={tfForm.occurred_on} onChange={(e) => setTfForm((f: any) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>{t('cash_flow.notes_label', 'Notes')}</Label>
              <Textarea value={tfForm.notes} onChange={(e) => setTfForm((f: any) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="pt-2 border-t">
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setTfOpen(false); openSupplierPay(); }}
              >
                <Truck className="h-4 w-4 mr-2" />
                {t('cash_flow.pay_supplier_instead', 'Pay a supplier instead')}
              </Button>
              <p className="text-[11px] text-muted-foreground mt-1 text-center">
                {t('cash_flow.pay_supplier_instead_note', "Deducts from the chosen account and reduces the supplier's ledger balance.")}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTfOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={saveTransfer}>{t('cash_flow.record_transfer', 'Record transfer')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Supplier payment dialog */}
      <Dialog open={spOpen} onOpenChange={setSpOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('cash_flow.pay_a_supplier', 'Pay a supplier')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>{t('cash_flow.supplier_label', 'Supplier')}</Label>
              <Select value={spForm.supplier_id} onValueChange={(v) => {
                const s = (suppliersQ.data ?? []).find((x: any) => x.id === v);
                const owed = Math.max(Number(s?.balance ?? 0), 0);
                setSpForm((f: any) => ({ ...f, supplier_id: v, amount: f.amount || owed }));
              }}>
                <SelectTrigger><SelectValue placeholder={t('cash_flow.choose_supplier', 'Choose supplier')} /></SelectTrigger>
                <SelectContent>
                  {(suppliersQ.data ?? []).map((s: any) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{Number(s.balance) > 0 ? t('cash_flow.owed_suffix', ' · owed {{amount}}', { amount: fmt(Number(s.balance)) }) : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>{t('cash_flow.payment_source_label', 'Payment source (cash in hand, bank, wallet…)')}</Label>
              <Select value={spForm.from_id} onValueChange={(v) => setSpForm((f: any) => ({ ...f, from_id: v }))}>
                <SelectTrigger><SelectValue placeholder={t('cash_flow.choose_account', 'Choose account')} /></SelectTrigger>
                <SelectContent>
                  {allAccounts.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.name}{isAutoAcc(a.id) ? t('cash_flow.auto_suffix', ' · Auto') : ""} — {t(`cash_flow.acc_type_${a.type}`, labelFor(a.type))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>{t('common.amount', 'Amount')}</Label>
                <Input type="number" step="0.01" value={spForm.amount} onChange={(e) => setSpForm((f: any) => ({ ...f, amount: e.target.value }))} />
              </div>
              <div>
                <Label>{t('cash_flow.date_label', 'Date')}</Label>
                <Input type="date" value={spForm.occurred_on} onChange={(e) => setSpForm((f: any) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>{t('common.note', 'Note')}</Label>
              <Input value={spForm.note} onChange={(e) => setSpForm((f: any) => ({ ...f, note: e.target.value }))} placeholder={t('cash_flow.note_placeholder', 'Optional reference')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSpOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={saveSupplierPay}>{t('cash_flow.pay_supplier_btn', 'Pay supplier')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      {/* Details dialog */}
      <Dialog open={!!details} onOpenChange={(o) => !o && setDetails(null)}>
        <DialogContent className="w-[95vw] max-w-6xl max-h-[90vh] flex flex-col">
          {(() => {
            if (!details) return null;
            if (details.kind === "opening" || details.kind === "balance") {
              const title = details.kind === "opening" ? t('cash_flow.title_opening_per_account', 'Opening balance — per account') : t('cash_flow.title_balance_per_account', 'Cash on hand — per account');
              const perAcc = new Map<string, { prior: number; inSum: number; outSum: number }>();
              for (const a of allAccounts) perAcc.set(a.id, { prior: 0, inSum: 0, outSum: 0 });
              for (const t of detailTxs) {
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
                          <TableHead>{t('cash_flow.th_account', 'Account')}</TableHead>
                          <TableHead>{t('reports.th_type', 'Type')}</TableHead>
                          <TableHead className="text-right">{t('cash_flow.th_opening', 'Opening')}</TableHead>
                          <TableHead className="text-right">{t('cash_flow.th_in', 'In')}</TableHead>
                          <TableHead className="text-right">{t('cash_flow.th_out', 'Out')}</TableHead>
                          <TableHead className="text-right">{t('cash_flow.th_balance', 'Balance')}</TableHead>
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
                              <TableCell className="text-muted-foreground">{t(`cash_flow.acc_type_${a.type}`, labelFor(a.type))}</TableCell>
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
            const scope = detailTxs.filter((t) => {
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
              details.kind === "in" ? t('cash_flow.title_every_received', 'Every payment received')
              : details.kind === "out" ? t('cash_flow.title_every_sent', 'Every payment sent')
              : t('cash_flow.title_account_history', '{{name}} — full history', { name: accById(accId!)?.name ?? t('cash_flow.account_fallback', 'Account') });
            return (
              <>
                <DialogHeader>
                  <DialogTitle>{title}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-wrap items-center gap-3">
                  <DateRangeBar preset={dPreset} from={dFrom} to={dTo} onPreset={setDPreset} onFrom={setDFrom} onTo={setDTo} />
                  
                  {!accId && (
                    <Select value={dFilterAcc} onValueChange={setDFilterAcc}>
                      <SelectTrigger className="h-8 w-[180px] text-xs"><SelectValue placeholder={t('cash_flow.all_accounts_placeholder', 'All Accounts')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('cash_flow.all_accounts_placeholder', 'All Accounts')}</SelectItem>
                        {allAccounts.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}

                  <Select value={dFilterMethod} onValueChange={setDFilterMethod}>
                    <SelectTrigger className="h-8 w-[150px] text-xs"><SelectValue placeholder={t('cash_flow.all_methods_placeholder', 'All Methods')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('cash_flow.all_methods_placeholder', 'All Methods')}</SelectItem>
                      {PAY_METHODS.map(m => <SelectItem key={m.v} value={m.v}>{t(`cash_flow.pay_method_${m.v}`, m.label)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>


                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-2">
                  <StatMini label={t('cash_flow.stat_opening', 'Opening')} value={fmt(openingBal)} />
                  <StatMini label={t('cash_flow.stat_period_in', 'Period In')} value={fmt(inTot)} tone="success" />
                  <StatMini label={t('cash_flow.stat_period_out', 'Period Out')} value={fmt(outTot)} tone="destructive" />
                  <StatMini label={t('cash_flow.stat_closing', 'Closing')} value={fmt(closingBal)} />
                </div>
                <div className="flex-1 overflow-auto min-h-0 border rounded-md">

                  <Table className="w-full">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[100px]">{t('sales.th_date', 'Date')}</TableHead>
                        {!accId && <TableHead>{t('cash_flow.th_account', 'Account')}</TableHead>}
                        <TableHead>{t('sales.th_method', 'Method')}</TableHead>
                        <TableHead>{t('reports.th_category', 'Category')}</TableHead>
                        <TableHead>{t('cash_flow.th_reference_notes', 'Reference / Notes')}</TableHead>
                        <TableHead className="text-right">{t('cash_flow.th_in', 'In')}</TableHead>
                        <TableHead className="text-right">{t('cash_flow.th_out', 'Out')}</TableHead>
                        <TableHead className="text-right">{t('cash_flow.th_balance', 'Balance')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {list.length === 0 && (
                        <TableRow><TableCell colSpan={accId ? 7 : 8} className="text-center text-muted-foreground py-8">{t('cash_flow.no_entries', 'No entries')}</TableCell></TableRow>
                      )}
                      {list.map((tx) => {
                        const acc = accById(tx.account_id);
                        return (
                          <TableRow key={tx.id}>
                            <TableCell>{tx.occurred_on}</TableCell>
                            {!accId && <TableCell>{acc?.name ?? "—"}</TableCell>}
                            <TableCell>{t(`cash_flow.pay_method_${methodOf(tx)}`, payLabel(methodOf(tx)))}</TableCell>
                            <TableCell className="capitalize">{t(`cash_flow.category_${tx.category}`, tx.category.replace(/_/g, " "))}</TableCell>

                            <TableCell className="max-w-[260px] break-words">
                              {tx.reference && <span className="font-medium">{tx.reference}</span>}
                              {tx.reference && tx.notes && <span> — </span>}
                              {tx.notes && <span className="text-muted-foreground">{tx.notes}</span>}
                            </TableCell>
                            <TableCell className="text-right text-emerald-600">{tx.direction === "in" ? fmt(Number(tx.amount)) : ""}</TableCell>
                            <TableCell className="text-right text-rose-600">{tx.direction === "out" ? fmt(Number(tx.amount)) : ""}</TableCell>
                            <TableCell className="text-right font-semibold">{fmt(runMap.get(tx.id) ?? 0)}</TableCell>
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
            <Button variant="outline" onClick={() => setDetails(null)}>{t('common.close', 'Close')}</Button>
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
