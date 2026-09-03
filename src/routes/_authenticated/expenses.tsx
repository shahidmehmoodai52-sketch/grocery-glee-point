import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Wallet, Users as UsersIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { offlineFirst, cacheExpenses, insertOfflineAware } from "@/lib/offline/pos";
import { db } from "@/lib/offline/db";

export const Route = createFileRoute("/_authenticated/expenses")({ component: Page });

function today() { return new Date().toISOString().slice(0, 10); }
function startOfMonth() { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); }

// Presets offered when the shop hasn't created these heads in Cash Flow yet.
// Selecting one creates the matching cash account so expenses always land on
// a real account (and show up correctly in Cash Flow) — mirrors purchases.tsx.
const PAY_SOURCE_PRESETS = ["Cash in hand", "Bank", "Card", "Online"];
function guessAccountType(name: string) {
  const s = (name || "").toLowerCase();
  if (s.includes("bank") || s.includes("cheque") || s.includes("check") || s.includes("online")) return "bank";
  if (s.includes("card")) return "card";
  if (s.includes("easy") || s.includes("jazz") || s.includes("wallet")) return "mobile_wallet";
  return "cash";
}
// Old rows stored one of these 4 generic bucket words instead of a real
// account name. Map them to a real account of the matching type so editing
// an old expense doesn't appear to jump to an unrelated account.
function legacyBucketType(method: string): string {
  const m = (method || "cash").toLowerCase().trim();
  if (m === "bank") return "bank";
  if (m === "card") return "card";
  if (m === "cash") return "cash";
  return "other";
}

function Page() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const roleLabel = (r: string) => t(`expenses.role_${r}`, r);
  const categoryLabel = (c: string) => t(`expenses.category_${c}`, c);
  const methodLabel = (m: string) => t(`expenses.method_${m}`, m);

  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());

  const [expOpen, setExpOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exp, setExp] = useState({
    person_id: "", category: "general", amount: 0, description: "",
    method: "", expense_date: today(),
  });

  const [personOpen, setPersonOpen] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [person, setPerson] = useState({ name: "", role: "staff", phone: "", notes: "" });

  const { data: persons = [] } = useQuery({
    queryKey: ["expense-persons"],
    queryFn: async () => (await supabase.from("expense_persons").select("*").eq("is_active", true).order("name")).data ?? [],
  });

  // Payment heads come from Cash Flow accounts so both screens stay in sync.
  const { data: cashAccounts = [] } = useQuery({
    queryKey: ["cash-accounts", "expense-pay"],
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
  const defaultPaySource =
    paySourceOptions.find((a) => a.name.toLowerCase() === "cash in hand")
    ?? paySourceOptions.find((a) => a.name.toLowerCase().includes("cash"))
    ?? paySourceOptions[0];
  const effectivePaySource = exp.method || defaultPaySource?.id || "";

  /** Turn the selected option into a real cash_accounts row (creating presets on demand). */
  const resolvePayAccount = async (optionId?: string): Promise<{ id: string | null; name: string }> => {
    const wanted = optionId || effectivePaySource;
    const selected = paySourceOptions.find((a) => a.id === wanted) ?? defaultPaySource;
    if (!selected) return { id: null, name: "cash" };
    if (!selected.preset) return { id: selected.id, name: selected.name };

    const existing = cashAccounts.find((a: any) => a.name.toLowerCase() === selected.name.toLowerCase());
    if (existing) return { id: existing.id, name: existing.name };

    const { data, error } = await supabase
      .from("cash_accounts")
      .insert({ name: selected.name, type: guessAccountType(selected.name), opening_balance: 0, is_active: true })
      .select("id,name")
      .single();
    if (error) {
      if (error.code === "23505") {
        const { data: found } = await supabase.from("cash_accounts").select("id,name").eq("name", selected.name).single();
        if (found) return { id: found.id, name: found.name };
      }
      throw error;
    }
    qc.invalidateQueries({ queryKey: ["cash-accounts"] });
    return { id: data.id as string, name: data.name as string };
  };

  const { data: rows = [] } = useQuery({
    queryKey: ["expenses", from, to],
    queryFn: async () => offlineFirst<any[]>(
      async () =>
        (await supabase.from("expenses")
          .select("*, expense_persons(name,role)")
          .gte("expense_date", from).lte("expense_date", to)
          .order("expense_date", { ascending: false }).order("created_at", { ascending: false })
        ).data ?? [],
      async () => {
        const all = await db().expenses.toArray();
        const inRange = all.filter((r: any) => r.expense_date >= from && r.expense_date <= to);
        inRange.sort((a: any, b: any) =>
          (b.expense_date ?? "").localeCompare(a.expense_date ?? "") ||
          (b.created_at ?? "").localeCompare(a.created_at ?? ""));
        return inRange.map((r: any) => ({ ...r, expense_persons: r.expense_persons ?? null }));
      },
      cacheExpenses,
    ),
  });

  const totals = useMemo(() => {
    const today_ = today();
    const sum = (arr: any[]) => arr.reduce((s, r) => s + Number(r.amount), 0);
    const todayRows = rows.filter((r: any) => r.expense_date === today_);
    const byPerson = new Map<string, number>();
    const byCat = new Map<string, number>();
    rows.forEach((r: any) => {
      const pname = r.expense_persons?.name ?? t('expenses.unassigned', 'Unassigned');
      byPerson.set(pname, (byPerson.get(pname) ?? 0) + Number(r.amount));
      byCat.set(r.category, (byCat.get(r.category) ?? 0) + Number(r.amount));
    });
    return {
      today: sum(todayRows),
      period: sum(rows),
      byPerson: Array.from(byPerson, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
      byCat: Array.from(byCat, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    };
  }, [rows]);

  const saveExpense = async () => {
    if (!exp.amount || exp.amount <= 0) return toast.error(t('expenses.amount_required', 'Amount required'));
    let account: { id: string | null; name: string };
    try {
      account = await resolvePayAccount();
    } catch (e: any) {
      return toast.error(e?.message ?? t('expenses.could_not_resolve_payment', 'Could not resolve payment account'));
    }
    const payload: any = { ...exp, method: account.name };
    if (!payload.person_id) payload.person_id = null;

    try {
      if (editingId) {
        const { error } = await supabase.from("expenses").update(payload).eq("id", editingId);
        if (error) throw error;
        toast.success(t('expenses.expense_updated', 'Expense updated'));
      } else {
        const row = await insertOfflineAware("expenses", payload);
        toast.success(row._offline_pending ? t('expenses.expense_saved_offline', 'Expense saved offline — will sync') : t('expenses.expense_recorded', 'Expense recorded'));
      }
    } catch (e: any) { return toast.error(e?.message ?? t('common.failed', 'Failed')); }
    setExpOpen(false);
    setEditingId(null);
    setExp({ person_id: "", category: "general", amount: 0, description: "", method: "", expense_date: today() });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const openEditExpense = (r: any) => {
    setEditingId(r.id);
    // r.method holds the real account name for new-style rows, or a legacy
    // generic bucket word ("cash"/"bank"/"card"/"other") for old ones —
    // resolve either to the matching option so the dropdown pre-selects the
    // right account instead of always resetting to the default.
    // Match against real accounts only (never a generic preset) — a shop
    // whose real bank account isn't literally named "Bank" must still land
    // on that real account, not a same-named preset that would create a
    // duplicate account on save.
    const rawMethod = (r.method || "cash") as string;
    const byName = cashAccounts.find((a: any) => a.name.toLowerCase() === rawMethod.toLowerCase());
    const byType = !byName ? cashAccounts.find((a: any) => a.type === legacyBucketType(rawMethod)) : null;
    setExp({
      person_id: r.person_id || "",
      category: r.category || "general",
      amount: Number(r.amount),
      description: r.description || "",
      method: byName?.id ?? byType?.id ?? "",
      expense_date: r.expense_date || today(),
    });
    setExpOpen(true);
  };

  const savePerson = async () => {
    if (!person.name) return toast.error(t('common.name_required', 'Name required'));
    const payload: any = { ...person };
    if (editingPersonId) payload.id = editingPersonId;

    const { error } = await supabase.from("expense_persons").upsert(payload);
    if (error) return toast.error(error.message);
    toast.success(editingPersonId ? t('expenses.person_updated', 'Person updated') : t('expenses.person_added', 'Person added'));
    setPersonOpen(false);
    setEditingPersonId(null);
    setPerson({ name: "", role: "staff", phone: "", notes: "" });
    qc.invalidateQueries({ queryKey: ["expense-persons"] });
  };

  const openEditPerson = (p: any) => {
    setEditingPersonId(p.id);
    setPerson({
      name: p.name || "",
      role: p.role || "staff",
      phone: p.phone || "",
      notes: p.notes || "",
    });
    setPersonOpen(true);
  };

  const remove = async (id: string) => {
    if (!confirm(t('expenses.delete_expense_confirm', 'Delete this expense?'))) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('expenses.title', 'Expenses')}</h1>
          <p className="text-sm text-muted-foreground">{t('expenses.subtitle', 'Track daily expenses by staff or owner')}</p>
        </div>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">{t('customers.from_label', 'From')}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">{t('customers.to_label', 'To')}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Dialog open={personOpen} onOpenChange={(open) => {
            setPersonOpen(open);
            if (!open) {
              setEditingPersonId(null);
              setPerson({ name: "", role: "staff", phone: "", notes: "" });
            }
          }}>
            <DialogTrigger asChild><Button variant="outline"><UsersIcon className="h-4 w-4 mr-2" />{t('expenses.new_person', 'New person')}</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingPersonId ? t('expenses.edit_person', 'Edit person') : t('expenses.add_person', 'Add expense person')}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>{t('common.name', 'Name')}</Label><Input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('expenses.th_role', 'Role')}</Label>
                    <Select value={person.role} onValueChange={(v) => setPerson({ ...person, role: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">{t('expenses.role_owner', 'Owner')}</SelectItem>
                        <SelectItem value="staff">{t('expenses.role_staff', 'Staff')}</SelectItem>
                        <SelectItem value="manager">{t('expenses.role_manager', 'Manager')}</SelectItem>
                        <SelectItem value="other">{t('expenses.role_other', 'Other')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>{t('common.phone', 'Phone')}</Label><Input value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} /></div>
                </div>
                <div><Label>{t('expenses.th_notes', 'Notes')}</Label><Input value={person.notes} onChange={(e) => setPerson({ ...person, notes: e.target.value })} /></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setPersonOpen(false)}>{t('common.cancel', 'Cancel')}</Button><Button onClick={savePerson}>{t('common.save', 'Save')}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={expOpen} onOpenChange={(open) => {
            setExpOpen(open);
            if (!open) {
              setEditingId(null);
              setExp({ person_id: "", category: "general", amount: 0, description: "", method: "", expense_date: today() });
            }
          }}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />{t('expenses.new_expense', 'New expense')}</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingId ? t('expenses.edit_expense', 'Edit expense') : t('expenses.record_expense', 'Record expense')}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('expenses.th_person', 'Person')}</Label>
                    <Select value={exp.person_id} onValueChange={(v) => setExp({ ...exp, person_id: v })}>
                      <SelectTrigger><SelectValue placeholder={t('expenses.select_person_placeholder', 'Select person')} /></SelectTrigger>
                      <SelectContent>
                        {persons.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} {p.role && `· ${roleLabel(p.role)}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>{t('sales.th_date', 'Date')}</Label><Input type="date" value={exp.expense_date} onChange={(e) => setExp({ ...exp, expense_date: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>{t('pos.qa_category', 'Category')}</Label>
                    <Select value={exp.category} onValueChange={(v) => setExp({ ...exp, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">{t('expenses.category_general', 'General')}</SelectItem>
                        <SelectItem value="rent">{t('expenses.category_rent', 'Rent')}</SelectItem>
                        <SelectItem value="utilities">{t('expenses.category_utilities', 'Utilities')}</SelectItem>
                        <SelectItem value="salary">{t('expenses.category_salary', 'Salary')}</SelectItem>
                        <SelectItem value="transport">{t('expenses.category_transport', 'Transport')}</SelectItem>
                        <SelectItem value="supplies">{t('expenses.category_supplies', 'Supplies')}</SelectItem>
                        <SelectItem value="repairs">{t('expenses.category_repairs', 'Repairs')}</SelectItem>
                        <SelectItem value="food">{t('expenses.category_food', 'Food')}</SelectItem>
                        <SelectItem value="other">{t('expenses.category_other', 'Other')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>{t('sales.th_method', 'Method')}</Label>
                    <Select value={effectivePaySource} onValueChange={(v) => setExp({ ...exp, method: v })}>
                      <SelectTrigger><SelectValue placeholder={t('purchases.pay_from_placeholder', 'Cash / Cheque / Bank…')} /></SelectTrigger>
                      <SelectContent>
                        {paySourceOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={exp.amount || ""} onChange={(e) => setExp({ ...exp, amount: Number(e.target.value) })} /></div>
                <div><Label>{t('expenses.th_description', 'Description')}</Label><Input placeholder={t('expenses.description_placeholder', 'What was this expense for?')} value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} /></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setExpOpen(false)}>{t('common.cancel', 'Cancel')}</Button><Button onClick={saveExpense}>{t('common.save', 'Save')}</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpOpen(true)}>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3.5 w-3.5" />{t('expenses.stat_today', 'Today')}</div>
          <div className="text-2xl font-semibold mt-1 text-destructive">{fmtMoney(totals.today, sym)}</div>
        </Card>
        <Card className="p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpOpen(true)}>
          <div className="text-xs text-muted-foreground">{t('expenses.stat_period_total', 'Period total')}</div>
          <div className="text-2xl font-semibold mt-1">{fmtMoney(totals.period, sym)}</div>
        </Card>
        <Card className="p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setExpOpen(true)}>
          <div className="text-xs text-muted-foreground">{t('expenses.stat_entries', 'Entries')}</div>
          <div className="text-2xl font-semibold mt-1">{rows.length}</div>
        </Card>
        <Card className="p-4 cursor-pointer hover:bg-muted/50 transition-colors" onClick={() => setPersonOpen(true)}>
          <div className="text-xs text-muted-foreground">{t('expenses.stat_active_persons', 'Active persons')}</div>
          <div className="text-2xl font-semibold mt-1">{persons.length}</div>
        </Card>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">{t('expenses.tab_all_entries', 'All entries')}</TabsTrigger>
          <TabsTrigger value="byperson">{t('expenses.tab_by_person', 'By person')}</TabsTrigger>
          <TabsTrigger value="bycat">{t('expenses.tab_by_category', 'By category')}</TabsTrigger>
          <TabsTrigger value="persons">{t('expenses.tab_persons', 'People')}</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>{t('sales.th_date', 'Date')}</TableHead><TableHead>{t('expenses.th_person', 'Person')}</TableHead><TableHead>{t('pos.qa_category', 'Category')}</TableHead>
                <TableHead>{t('expenses.th_description', 'Description')}</TableHead><TableHead>{t('sales.th_method', 'Method')}</TableHead>
                <TableHead className="text-right">{t('common.amount', 'Amount')}</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">{t('expenses.no_expenses_period', 'No expenses in this period')}</TableCell></TableRow>}
                {rows.map((r: any) => (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEditExpense(r)}>
                    <TableCell>{r.expense_date}</TableCell>
                    <TableCell>{r.expense_persons?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Badge variant="secondary">{categoryLabel(r.category)}</Badge></TableCell>
                    <TableCell className="max-w-[300px] truncate">{r.description ?? "—"}</TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{methodLabel(r.method)}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">{fmtMoney(r.amount, sym)}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" onClick={() => openEditExpense(r)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="byperson">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow><TableHead>{t('expenses.th_person', 'Person')}</TableHead><TableHead className="text-right">{t('expenses.th_total_spent', 'Total spent')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {totals.byPerson.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">{t('dashboard.no_data', 'No data')}</TableCell></TableRow>}
                {totals.byPerson.map((p) => {
                  const pp = persons.find((x: any) => x.name === p.name);
                  return (
                    <TableRow key={p.name}>
                      <TableCell className="font-medium">
                        {pp ? <Link to="/expense-persons/$id" params={{ id: pp.id }} className="hover:underline">{p.name}</Link> : p.name}
                      </TableCell>
                      <TableCell className="text-right font-semibold">{fmtMoney(p.value, sym)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="bycat">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow><TableHead>{t('pos.qa_category', 'Category')}</TableHead><TableHead className="text-right">{t('expenses.th_total_spent', 'Total spent')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {totals.byCat.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">{t('dashboard.no_data', 'No data')}</TableCell></TableRow>}
                {totals.byCat.map((c) => (
                  <TableRow key={c.name}><TableCell className="font-medium capitalize">{categoryLabel(c.name)}</TableCell><TableCell className="text-right font-semibold">{fmtMoney(c.value, sym)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="persons">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow><TableHead>{t('common.name', 'Name')}</TableHead><TableHead>{t('expenses.th_role', 'Role')}</TableHead><TableHead>{t('common.phone', 'Phone')}</TableHead><TableHead>{t('expenses.th_notes', 'Notes')}</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {persons.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">{t('expenses.no_people_yet', 'No people added yet')}</TableCell></TableRow>}
                {persons.map((p: any) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEditPerson(p)}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{p.role ? roleLabel(p.role) : "—"}</Badge></TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.notes ?? "—"}</TableCell>
                    <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                      <Button size="icon" variant="ghost" onClick={() => openEditPerson(p)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button asChild size="sm" variant="ghost"><Link to="/expense-persons/$id" params={{ id: p.id }}>{t('expenses.open_ledger', 'Open ledger')}</Link></Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
