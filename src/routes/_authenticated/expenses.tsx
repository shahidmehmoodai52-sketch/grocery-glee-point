import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Wallet, Users as UsersIcon } from "lucide-react";
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

function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";

  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());

  const [expOpen, setExpOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [exp, setExp] = useState({
    person_id: "", category: "general", amount: 0, description: "",
    method: "cash", expense_date: today(),
  });

  const [personOpen, setPersonOpen] = useState(false);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [person, setPerson] = useState({ name: "", role: "staff", phone: "", notes: "" });

  const { data: persons = [] } = useQuery({
    queryKey: ["expense-persons"],
    queryFn: async () => (await supabase.from("expense_persons").select("*").eq("is_active", true).order("name")).data ?? [],
  });

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
      const pname = r.expense_persons?.name ?? "Unassigned";
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
    if (!exp.amount || exp.amount <= 0) return toast.error("Amount required");
    const payload: any = { ...exp };
    if (!payload.person_id) payload.person_id = null;
    if (editingId) payload.id = editingId;
    
    try {
      const row = await insertOfflineAware("expenses", payload);
      toast.success(row._offline_pending ? "Expense saved offline — will sync" : (editingId ? "Expense updated" : "Expense recorded"));
    } catch (e: any) { return toast.error(e?.message ?? "Failed"); }
    setExpOpen(false);
    setEditingId(null);
    setExp({ person_id: "", category: "general", amount: 0, description: "", method: "cash", expense_date: today() });
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  const openEditExpense = (r: any) => {
    setEditingId(r.id);
    setExp({
      person_id: r.person_id || "",
      category: r.category || "general",
      amount: Number(r.amount),
      description: r.description || "",
      method: r.method || "cash",
      expense_date: r.expense_date || today(),
    });
    setExpOpen(true);
  };

  const savePerson = async () => {
    if (!person.name) return toast.error("Name required");
    const payload: any = { ...person };
    if (editingPersonId) payload.id = editingPersonId;

    const { error } = await supabase.from("expense_persons").upsert(payload);
    if (error) return toast.error(error.message);
    toast.success(editingPersonId ? "Person updated" : "Person added");
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
    if (!confirm("Delete this expense?")) return;
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["expenses"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Expenses</h1>
          <p className="text-sm text-muted-foreground">Track daily expenses by staff or owner</p>
        </div>
        <div className="flex items-end gap-2">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Dialog open={personOpen} onOpenChange={(open) => {
            setPersonOpen(open);
            if (!open) {
              setEditingPersonId(null);
              setPerson({ name: "", role: "staff", phone: "", notes: "" });
            }
          }}>
            <DialogTrigger asChild><Button variant="outline"><UsersIcon className="h-4 w-4 mr-2" />New person</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editingPersonId ? "Edit person" : "Add expense person"}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name</Label><Input value={person.name} onChange={(e) => setPerson({ ...person, name: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Role</Label>
                    <Select value={person.role} onValueChange={(v) => setPerson({ ...person, role: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="owner">Owner</SelectItem>
                        <SelectItem value="staff">Staff</SelectItem>
                        <SelectItem value="manager">Manager</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Phone</Label><Input value={person.phone} onChange={(e) => setPerson({ ...person, phone: e.target.value })} /></div>
                </div>
                <div><Label>Notes</Label><Input value={person.notes} onChange={(e) => setPerson({ ...person, notes: e.target.value })} /></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setPersonOpen(false)}>Cancel</Button><Button onClick={savePerson}>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={expOpen} onOpenChange={setExpOpen}>
            <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New expense</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Record expense</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Person</Label>
                    <Select value={exp.person_id} onValueChange={(v) => setExp({ ...exp, person_id: v })}>
                      <SelectTrigger><SelectValue placeholder="Select person" /></SelectTrigger>
                      <SelectContent>
                        {persons.map((p: any) => (
                          <SelectItem key={p.id} value={p.id}>{p.name} {p.role && `· ${p.role}`}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div><Label>Date</Label><Input type="date" value={exp.expense_date} onChange={(e) => setExp({ ...exp, expense_date: e.target.value })} /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Category</Label>
                    <Select value={exp.category} onValueChange={(v) => setExp({ ...exp, category: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="rent">Rent</SelectItem>
                        <SelectItem value="utilities">Utilities</SelectItem>
                        <SelectItem value="salary">Salary</SelectItem>
                        <SelectItem value="transport">Transport</SelectItem>
                        <SelectItem value="supplies">Supplies</SelectItem>
                        <SelectItem value="repairs">Repairs</SelectItem>
                        <SelectItem value="food">Food</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Method</Label>
                    <Select value={exp.method} onValueChange={(v) => setExp({ ...exp, method: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Cash</SelectItem>
                        <SelectItem value="bank">Bank</SelectItem>
                        <SelectItem value="card">Card</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div><Label>Amount</Label><Input type="number" step="0.01" value={exp.amount || ""} onChange={(e) => setExp({ ...exp, amount: Number(e.target.value) })} /></div>
                <div><Label>Description</Label><Input placeholder="What was this expense for?" value={exp.description} onChange={(e) => setExp({ ...exp, description: e.target.value })} /></div>
              </div>
              <DialogFooter><Button variant="outline" onClick={() => setExpOpen(false)}>Cancel</Button><Button onClick={saveExpense}>Save</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Wallet className="h-3.5 w-3.5" />Today</div>
          <div className="text-2xl font-semibold mt-1 text-destructive">{fmtMoney(totals.today, sym)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Period total</div>
          <div className="text-2xl font-semibold mt-1">{fmtMoney(totals.period, sym)}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Entries</div>
          <div className="text-2xl font-semibold mt-1">{rows.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Active persons</div>
          <div className="text-2xl font-semibold mt-1">{persons.length}</div>
        </Card>
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">All entries</TabsTrigger>
          <TabsTrigger value="byperson">By person</TabsTrigger>
          <TabsTrigger value="bycat">By category</TabsTrigger>
          <TabsTrigger value="persons">People</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow>
                <TableHead>Date</TableHead><TableHead>Person</TableHead><TableHead>Category</TableHead>
                <TableHead>Description</TableHead><TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead><TableHead></TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No expenses in this period</TableCell></TableRow>}
                {rows.map((r: any) => (
                  <TableRow key={r.id}>
                    <TableCell>{r.expense_date}</TableCell>
                    <TableCell>{r.expense_persons?.name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell><Badge variant="secondary">{r.category}</Badge></TableCell>
                    <TableCell className="max-w-[300px] truncate">{r.description ?? "—"}</TableCell>
                    <TableCell className="text-xs uppercase text-muted-foreground">{r.method}</TableCell>
                    <TableCell className="text-right font-medium text-destructive">{fmtMoney(r.amount, sym)}</TableCell>
                    <TableCell className="text-right">
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
              <TableHeader><TableRow><TableHead>Person</TableHead><TableHead className="text-right">Total spent</TableHead></TableRow></TableHeader>
              <TableBody>
                {totals.byPerson.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
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
              <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Total spent</TableHead></TableRow></TableHeader>
              <TableBody>
                {totals.byCat.length === 0 && <TableRow><TableCell colSpan={2} className="text-center text-muted-foreground py-6">No data</TableCell></TableRow>}
                {totals.byCat.map((c) => (
                  <TableRow key={c.name}><TableCell className="font-medium capitalize">{c.name}</TableCell><TableCell className="text-right font-semibold">{fmtMoney(c.value, sym)}</TableCell></TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="persons">
          <Card className="p-3">
            <Table>
              <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Role</TableHead><TableHead>Phone</TableHead><TableHead>Notes</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {persons.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No people added yet</TableCell></TableRow>}
                {persons.map((p: any) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell><Badge variant="outline" className="capitalize">{p.role ?? "—"}</Badge></TableCell>
                    <TableCell>{p.phone ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{p.notes ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      <Button asChild size="sm" variant="ghost"><Link to="/expense-persons/$id" params={{ id: p.id }}>Open ledger</Link></Button>
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
