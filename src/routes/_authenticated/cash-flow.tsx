import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus, Pencil, Trash2, Wallet, Banknote, CreditCard, Smartphone,
  Building2, ArrowLeftRight, ArrowDownCircle, ArrowUpCircle, Search, Coins,
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
  direction: "in" | "out";
  amount: number;
  occurred_on: string;
  category: string;
  reference: string | null;
  notes: string | null;
  transfer_group_id: string | null;
  created_at: string;
};

const ACC_TYPES = [
  { v: "cash", label: "Cash / Till", Icon: Banknote },
  { v: "card", label: "Card terminal", Icon: CreditCard },
  { v: "bank", label: "Bank account", Icon: Building2 },
  { v: "mobile_wallet", label: "Mobile wallet (EasyPaisa/JazzCash)", Icon: Smartphone },
  { v: "other", label: "Other", Icon: Wallet },
] as const;

const CATEGORIES = [
  "sale", "expense", "deposit", "withdrawal", "supplier_payment",
  "customer_payment", "salary", "adjustment", "other",
] as const;

const iconFor = (t: string) => ACC_TYPES.find((x) => x.v === t)?.Icon ?? Wallet;
const labelFor = (t: string) => ACC_TYPES.find((x) => x.v === t)?.label ?? t;

const emptyAcc = { name: "", type: "cash", opening_balance: 0, notes: "", is_active: true };
const today = () => new Date().toISOString().slice(0, 10);
const emptyTx = { account_id: "", direction: "in" as "in" | "out", amount: 0, occurred_on: today(), category: "other", reference: "", notes: "" };
const emptyTransfer = { from_id: "", to_id: "", amount: 0, occurred_on: today(), notes: "" };

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

  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterAcc, setFilterAcc] = useState<string>("all");

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
  });

  const txQ = useQuery({
    queryKey: ["cash-transactions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cash_transactions")
        .select("*")
        .order("occurred_on", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Tx[];
    },
  });

  const accounts = accountsQ.data ?? [];
  const txs = txQ.data ?? [];

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

  const filteredTx = useMemo(() => {
    const term = search.trim().toLowerCase();
    return txs.filter((t) => {
      if (filterAcc !== "all" && t.account_id !== filterAcc) return false;
      if (dateFrom && t.occurred_on < dateFrom) return false;
      if (dateTo && t.occurred_on > dateTo) return false;
      if (term) {
        const hay = `${t.category} ${t.reference ?? ""} ${t.notes ?? ""}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [txs, search, dateFrom, dateTo, filterAcc]);

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
  const saveTransfer = async () => {
    if (!tfForm.from_id || !tfForm.to_id) { toast.error("Pick both accounts"); return; }
    if (tfForm.from_id === tfForm.to_id) { toast.error("Choose two different accounts"); return; }
    const amt = Number(tfForm.amount);
    if (!amt || amt <= 0) { toast.error("Amount must be greater than zero"); return; }
    const groupId = (crypto as any).randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const rows = [
      { account_id: tfForm.from_id, direction: "out", amount: amt, occurred_on: tfForm.occurred_on || today(), category: "transfer", notes: tfForm.notes || null, transfer_group_id: groupId },
      { account_id: tfForm.to_id, direction: "in", amount: amt, occurred_on: tfForm.occurred_on || today(), category: "transfer", notes: tfForm.notes || null, transfer_group_id: groupId },
    ];
    const { error } = await supabase.from("cash_transactions").insert(rows);
    if (error) { toast.error(error.message); return; }
    toast.success("Transfer recorded");
    setTfOpen(false);
    qc.invalidateQueries({ queryKey: ["cash-transactions"] });
  };

  const accById = (id: string) => accounts.find((a) => a.id === id);
  const fmt = (n: number) => fmtMoney(n, sym);

  const reportRows = useMemo(() => {
    // In current filter window, per-account totals
    return accounts.map((a) => {
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
            <Button variant="outline" onClick={() => openTxCreate("out")}><ArrowUpCircle className="h-4 w-4 mr-2" />Pay out</Button>
            <Button onClick={() => openTxCreate("in")}><ArrowDownCircle className="h-4 w-4 mr-2" />Receive</Button>
            <Button variant="secondary" onClick={openAccCreate}><Plus className="h-4 w-4 mr-2" />New account</Button>
          </div>
        )}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Opening balance</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.opening)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total received</div>
          <div className="text-2xl font-bold mt-1 text-emerald-600">{fmt(totals.inSum)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Total paid out</div>
          <div className="text-2xl font-bold mt-1 text-rose-600">{fmt(totals.outSum)}</div>
        </Card>
        <Card className="p-4 border-primary/40">
          <div className="text-xs text-muted-foreground">Cash on hand (all accounts)</div>
          <div className="text-2xl font-bold mt-1">{fmt(totals.balance)}</div>
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
          {accounts.length === 0 ? (
            <Card className="p-8 text-center text-muted-foreground">
              No accounts yet. Add your Till, Bank, Card terminal, EasyPaisa or JazzCash to get started.
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {accounts.map((a) => {
                const Icon = iconFor(a.type);
                const b = balances.get(a.id) ?? { inSum: 0, outSum: 0 };
                const bal = Number(a.opening_balance) + b.inSum - b.outSum;
                return (
                  <Card key={a.id} className="p-4">
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
                      {!a.is_active && <Badge variant="secondary">Inactive</Badge>}
                    </div>
                    <div className="mt-3 text-2xl font-bold">{fmt(bal)}</div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>Opening {fmt(Number(a.opening_balance))}</span>
                      <span className="text-emerald-600">In {fmt(b.inSum)}</span>
                      <span className="text-rose-600">Out {fmt(b.outSum)}</span>
                    </div>
                    {isAdmin && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button size="sm" variant="secondary" onClick={() => openTxCreate("in", a.id)}>Receive</Button>
                        <Button size="sm" variant="outline" onClick={() => openTxCreate("out", a.id)}>Pay</Button>
                        <Button size="sm" variant="ghost" onClick={() => openAccEdit(a)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => deleteAcc(a.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                      </div>
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
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>
          <Card className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Reference / Notes</TableHead>
                  <TableHead className="text-right">In</TableHead>
                  <TableHead className="text-right">Out</TableHead>
                  {isAdmin && <TableHead className="w-[100px]"></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTx.length === 0 && (
                  <TableRow><TableCell colSpan={isAdmin ? 7 : 6} className="text-center text-muted-foreground py-8">No entries</TableCell></TableRow>
                )}
                {filteredTx.map((t) => {
                  const acc = accById(t.account_id);
                  return (
                    <TableRow key={t.id}>
                      <TableCell className="whitespace-nowrap">{t.occurred_on}</TableCell>
                      <TableCell className="whitespace-nowrap">{acc?.name ?? "—"}</TableCell>
                      <TableCell className="capitalize">{t.category.replace(/_/g, " ")}</TableCell>
                      <TableCell className="max-w-[300px] truncate">
                        {t.reference && <span className="font-medium">{t.reference}</span>}
                        {t.reference && t.notes && <span> — </span>}
                        {t.notes && <span className="text-muted-foreground">{t.notes}</span>}
                      </TableCell>
                      <TableCell className="text-right text-emerald-600">{t.direction === "in" ? fmt(Number(t.amount)) : ""}</TableCell>
                      <TableCell className="text-right text-rose-600">{t.direction === "out" ? fmt(Number(t.amount)) : ""}</TableCell>
                      {isAdmin && (
                        <TableCell>
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => openTxEdit(t)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => deleteTx(t.id)}><Trash2 className="h-4 w-4 text-rose-600" /></Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
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
              <Select value={accForm.type} onValueChange={(v) => setAccForm((f: any) => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACC_TYPES.map((t) => <SelectItem key={t.v} value={t.v}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
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
              <Label>Account</Label>
              <Select value={txForm.account_id} onValueChange={(v) => setTxForm((f: any) => ({ ...f, account_id: v }))}>
                <SelectTrigger><SelectValue placeholder="Choose account" /></SelectTrigger>
                <SelectContent>
                  {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
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
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>From</Label>
                <Select value={tfForm.from_id} onValueChange={(v) => setTfForm((f: any) => ({ ...f, from_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>To</Label>
                <Select value={tfForm.to_id} onValueChange={(v) => setTfForm((f: any) => ({ ...f, to_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Destination" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
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
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTfOpen(false)}>Cancel</Button>
            <Button onClick={saveTransfer}>Record transfer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
