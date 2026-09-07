import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, HandCoins, BookOpen, Search, Users, TrendingUp, TrendingDown, Wallet, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { offlineFirst, cacheCustomers, insertOfflineAware } from "@/lib/offline/pos";
import { readLocalFirst } from "@/lib/offline/data-access";
import { db } from "@/lib/offline/db";


export const Route = createFileRoute("/_authenticated/customers/")({ component: Page });

function Stat({ icon: Icon, label, value, tone = "primary" }: { icon: any; label: string; value: string; tone?: "primary" | "destructive" | "success" | "muted" }) {
  const toneCls =
    tone === "destructive" ? "text-destructive bg-destructive/10"
    : tone === "success" ? "text-success bg-success/10"
    : tone === "muted" ? "text-muted-foreground bg-muted"
    : "text-primary bg-primary/10";
  return (
    <Card className="p-4 flex items-center gap-3">
      <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${toneCls}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground truncate">{label}</div>
        <div className="text-lg font-semibold truncate">{value}</div>
      </div>
    </Card>
  );
}

function Page() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", balance: 0 });
  const [payOpen, setPayOpen] = useState<any>(null);
  const [pay, setPay] = useState({ amount: 0, method: "Cash in hand", note: "", account_id: "" });
  const [search, setSearch] = useState("");
  const [editRow, setEditRow] = useState<any>(null);
  const [editForm, setEditForm] = useState({ name: "", phone: "", email: "", address: "", opening_balance: 0 });

  const openEdit = (c: any) => {
    setEditRow(c);
    setEditForm({
      name: c.name ?? "",
      phone: c.phone ?? "",
      email: c.email ?? "",
      address: c.address ?? "",
      opening_balance: Number(c.opening_balance ?? 0),
    });
  };

  const saveEdit = async () => {
    if (!editRow) return;
    if (!editForm.name.trim()) return toast.error(t('common.name_required', 'Name required'));
    const { error } = await supabase.from("customers").update(editForm).eq("id", editRow.id);
    if (error) return toast.error(error.message);
    toast.success(t('customers.customer_updated', 'Customer updated'));
    setEditRow(null);
    qc.invalidateQueries();
  };

  const deleteCustomer = async (customer: any) => {
    if (!confirm(t('customers.delete_confirm', 'Delete customer {{name}}? This cannot be undone.', { name: customer.name ?? "this customer" }))) return;
    const { error } = await supabase.from("customers").delete().eq("id", customer.id);
    if (error) return toast.error(error.message);
    toast.success(t('customers.customer_deleted', 'Customer deleted'));
    qc.invalidateQueries();
  };

  const { data: rows = [] } = useQuery({
    queryKey: ["customers"],
    // Local-first on cold start (instant paint), cloud on every later refetch.
    queryFn: async () => readLocalFirst<any[]>({
      table: "customers",
      cloud: async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
      local: async () => (await db().customers.orderBy("name").toArray()) as any[],
      cache: cacheCustomers,
      onRevalidated: (fresh: any[]) => qc.setQueryData(["customers"], fresh),
    }),
  });

  const { data: cashAccounts = [] } = useQuery({
    queryKey: ["cash-accounts", "customer-receive"],
    queryFn: async () => (await supabase.from("cash_accounts").select("id,name,type,is_active").eq("is_active", true).order("sort_order").order("name")).data ?? [],
  });
  // Server-side balance per customer (mirrors get_supplier_balances(), used
  // the same way by suppliers.index.tsx) instead of downloading the
  // tenant's entire sales/party_payments/sale_returns tables client-side
  // just to sum a few numbers per customer. Falls back to each customer's
  // own cached `balance` column (below, same as before) when this hasn't
  // loaded yet or the RPC call fails — that column is part of the `rows`
  // query above, which already has an offline-safe local mirror, so the
  // list still shows a reasonable balance while offline.
  const { data: balanceRows = [] } = useQuery({
    queryKey: ["customer-balances"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_customer_balances");
      if (error) throw error;
      return data ?? [];
    },
  });
  const customerBalances = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balanceRows as any[]) map.set(b.id, Number(b.current_balance ?? 0));
    return map;
  }, [balanceRows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c: any) =>
      (c.name ?? "").toLowerCase().includes(q) ||
      (c.phone ?? "").toLowerCase().includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.address ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    let receivable = 0, advance = 0;
    for (const c of rows as any[]) {
      const b = customerBalances.get(c.id) ?? Number(c.balance ?? 0);
      if (b > 0) receivable += b;
      else if (b < 0) advance += -b;
    }
    return { receivable, advance, net: receivable - advance };
  }, [rows, customerBalances]);

  const save = async () => {
    if (!form.name) return toast.error(t('common.name_required', 'Name required'));
    try {
      const row = await insertOfflineAware("customers", { ...form, opening_balance: form.balance });
      toast.success(row._offline_pending ? t('customers.customer_saved_offline', 'Customer saved offline — will sync') : t('customers.customer_added', 'Customer added'));
    } catch (e: any) { return toast.error(e?.message ?? t('common.failed', 'Failed')); }
    setOpen(false);
    setForm({ name: "", phone: "", email: "", address: "", balance: 0 });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const recordPayment = async () => {
    if (!payOpen || pay.amount <= 0) return toast.error(t('customers.enter_amount', 'Enter amount'));
    if (!pay.method) return toast.error(t('customers.pick_payment_source', 'Pick a payment source'));
    let account = (cashAccounts as any[]).find((a) => a.name.toLowerCase() === pay.method.toLowerCase());
    if (!account) {
      const t = pay.method.toLowerCase();
      const type = t.includes("bank") ? "bank" : t.includes("card") ? "card" : (t.includes("easy") || t.includes("jazz") || t.includes("wallet")) ? "mobile_wallet" : "cash";
      const { data, error: accErr } = await supabase.from("cash_accounts").insert({ name: pay.method, type, opening_balance: 0, is_active: true }).select("id,name").single();
      if (accErr) return toast.error(accErr.message);
      account = data;
    }
    const { error } = await supabase.rpc("record_payment", {
      p_party_type: "customer", p_party_id: payOpen.id, p_amount: pay.amount, p_method: account.name, p_note: pay.note, p_account_id: account.id,
    });
    if (error) return toast.error(error.message);
    toast.success(t('customers.payment_recorded', 'Payment recorded'));

    setPayOpen(null);
    setPay({ amount: 0, method: "Cash in hand", note: "", account_id: "" });
    qc.invalidateQueries();
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('customers.title', 'Customers')}</h1>
          <p className="text-sm text-muted-foreground">{t('customers.subtitle', 'Manage customer accounts and view outstanding balances.')}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />{t('customers.new_customer', 'New customer')}</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('customers.new_customer', 'New customer')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>{t('common.name', 'Name')}</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>{t('common.phone', 'Phone')}</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>{t('common.email', 'Email')}</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div><Label>{t('common.address', 'Address')}</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>{t('customers.opening_balance_label', 'Opening balance (they owe)')}</Label><Input type="number" step="0.01" value={form.balance || ""} onChange={(e) => setForm({ ...form, balance: Number(e.target.value) })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button><Button onClick={save}>{t('common.save', 'Save')}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label={t('customers.stat_total_customers', 'Total customers')} value={String(rows.length)} tone="primary" />
        <Stat icon={TrendingUp} label={t('customers.stat_receivable', 'Receivable (they owe)')} value={fmtMoney(totals.receivable, sym)} tone="destructive" />
        <Stat icon={TrendingDown} label={t('customers.stat_advance', 'Advances held')} value={fmtMoney(totals.advance, sym)} tone="success" />
        <Stat icon={Wallet} label={t('customers.stat_net_receivable', 'Net receivable')} value={fmtMoney(totals.net, sym)} tone={totals.net > 0 ? "destructive" : totals.net < 0 ? "success" : "muted"} />
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('customers.search_placeholder', 'Search by name, phone, email, address…')}
              className="pl-9"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {t('customers.shown_count', '{{filtered}} of {{total}} shown', { filtered: filtered.length, total: rows.length })}
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>{t('common.name', 'Name')}</TableHead>
                <TableHead>{t('common.phone', 'Phone')}</TableHead>
                <TableHead>{t('common.email', 'Email')}</TableHead>
                <TableHead className="text-right">{t('customers.th_balance', 'Balance')}</TableHead>
                <TableHead className="text-right w-[260px]">{t('customers.th_actions', 'Actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    {rows.length === 0 ? t('customers.no_customers_yet', 'No customers yet — add your first customer.') : t('customers.no_customers_match', 'No customers match your search.')}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c: any) => {
                const bal = customerBalances.get(c.id) ?? Number(c.balance ?? 0);
                return (
                  <TableRow key={c.id} className="group">
                    <TableCell className="font-medium">
                      <Link to="/customers/$id" params={{ id: c.id }} className="hover:underline text-primary inline-flex items-center gap-2">
                        <span className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold">
                          {(c.name ?? "?").trim().slice(0, 2).toUpperCase()}
                        </span>
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{c.phone ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {bal > 0 ? (
                        <Badge variant="destructive" className="font-medium">{t('customers.owes', 'Owes {{amount}}', { amount: fmtMoney(bal, sym) })}</Badge>
                      ) : bal < 0 ? (
                        <Badge className="bg-success/15 text-success hover:bg-success/20 font-medium">{t('customers.advance', 'Advance {{amount}}', { amount: fmtMoney(-bal, sym) })}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">{t('customers.settled', 'Settled')}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/customers/$id" params={{ id: c.id }}><BookOpen className="h-3.5 w-3.5 mr-1" />{t('customers.ledger', 'Ledger')}</Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setPayOpen(c); setPay({ amount: Math.max(bal, 0), method: "Cash in hand", note: "", account_id: "" }); }}>
                        <HandCoins className="h-3.5 w-3.5 mr-1" />{t('customers.receive', 'Receive')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => openEdit(c)} title={t('customers.edit_customer', 'Edit customer')}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteCustomer(c)} title={t('customers.delete_customer', 'Delete customer')}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Dialog open={!!payOpen} onOpenChange={(o) => !o && setPayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('customers.receive_payment_title', 'Receive payment — {{name}}', { name: payOpen?.name })}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={pay.amount || ""} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></div>
            <div>
              <Label>{t('customers.receive_in', 'Receive in')}</Label>
              <div className="flex flex-wrap gap-2 mt-1">
                {(() => {
                  const presets = ["Cash in hand", "Bank", "EasyPaisa", "JazzCash", "Card"];
                  const names = new Set((cashAccounts as any[]).map((a) => a.name));
                  const merged = [
                    ...(cashAccounts as any[]).map((a) => ({ id: a.id, name: a.name })),
                    ...presets.filter((p) => !names.has(p)).map((p) => ({ id: `preset:${p}`, name: p })),
                  ];
                  return merged.map((a) => {
                    const active = pay.account_id === a.id || (!pay.account_id && pay.method.toLowerCase() === a.name.toLowerCase());
                    return (
                      <Button
                        key={a.id}
                        type="button"
                        size="sm"
                        variant={active ? "default" : "outline"}
                        onClick={() => setPay({ ...pay, account_id: a.id, method: a.name })}
                      >
                        {a.name}
                      </Button>
                    );
                  });
                })()}
              </div>
              <p className="text-[11px] text-muted-foreground mt-2">{t('customers.receive_in_note', 'Adds to this account in Cash Flow. New sources are created automatically.')}</p>
            </div>
            <div><Label>{t('common.note', 'Note')}</Label><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={recordPayment}>{t('customers.record', 'Record')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editRow} onOpenChange={(o) => !o && setEditRow(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('customers.edit_customer', 'Edit customer')}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>{t('common.name', 'Name')}</Label><Input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('common.phone', 'Phone')}</Label><Input value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
              <div><Label>{t('common.email', 'Email')}</Label><Input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
            </div>
            <div><Label>{t('common.address', 'Address')}</Label><Input value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></div>
            <div><Label>{t('customers.opening_balance_label', 'Opening balance (they owe)')}</Label><Input type="number" step="0.01" value={editForm.opening_balance || ""} onChange={(e) => setEditForm({ ...editForm, opening_balance: Number(e.target.value) })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditRow(null)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={saveEdit}>{t('common.save', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
