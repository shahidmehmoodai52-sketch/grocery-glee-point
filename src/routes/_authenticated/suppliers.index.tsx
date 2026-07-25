import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, HandCoins, BookOpen, Search, Truck, TrendingUp, TrendingDown, Wallet, Pencil } from "lucide-react";
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
import { offlineFirst, cacheSuppliers, insertOfflineAware } from "@/lib/offline/pos";
import { db } from "@/lib/offline/db";


export const Route = createFileRoute("/_authenticated/suppliers/")({ component: Page });

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
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", balance: 0 });
  const [payOpen, setPayOpen] = useState<any>(null);
  const [pay, setPay] = useState({ amount: 0, method: "cash", note: "" });
  const [search, setSearch] = useState("");

  const { data: rows = [] } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => offlineFirst<any[]>(
      async () => (await supabase.from("suppliers").select("*").order("name")).data ?? [],
      async () => (await db().suppliers.orderBy("name").toArray()) as any[],
      cacheSuppliers,
    ),
  });

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
    let payable = 0, advance = 0;
    for (const s of rows as any[]) {
      const b = Number(s.balance ?? 0);
      if (b > 0) payable += b;
      else if (b < 0) advance += -b;
    }
    return { payable, advance, net: payable - advance };
  }, [rows]);

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    try {
      const row = await insertOfflineAware("suppliers", { ...form, opening_balance: form.balance });
      toast.success(row._offline_pending ? "Supplier saved offline — will sync" : "Supplier added");
    } catch (e: any) { return toast.error(e?.message ?? "Failed"); }
    setOpen(false);
    setForm({ name: "", phone: "", email: "", address: "", balance: 0 });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  const recordPayment = async () => {
    if (!payOpen || pay.amount <= 0) return;
    const { error } = await supabase.rpc("record_payment", {
      p_party_type: "supplier", p_party_id: payOpen.id, p_amount: pay.amount, p_method: pay.method, p_note: pay.note,
    });
    if (error) return toast.error(error.message);
    toast.success("Payment sent");

    setPayOpen(null);
    setPay({ amount: 0, method: "cash", note: "" });
    qc.invalidateQueries({ queryKey: ["suppliers"] });
  };

  return (
    <div className="p-6 space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Suppliers</h1>
          <p className="text-sm text-muted-foreground">Track supplier accounts and amounts you need to pay.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New supplier</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New supplier</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>Opening balance (we owe)</Label><Input type="number" step="0.01" value={form.balance || ""} onChange={(e) => setForm({ ...form, balance: Number(e.target.value) })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Truck} label="Total suppliers" value={String(rows.length)} tone="primary" />
        <Stat icon={TrendingUp} label="Payable (we owe)" value={fmtMoney(totals.payable, sym)} tone="destructive" />
        <Stat icon={TrendingDown} label="Advances paid" value={fmtMoney(totals.advance, sym)} tone="success" />
        <Stat icon={Wallet} label="Net payable" value={fmtMoney(totals.net, sym)} tone={totals.net > 0 ? "destructive" : totals.net < 0 ? "success" : "muted"} />
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, phone, email, address…"
              className="pl-9"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            {filtered.length} of {rows.length} shown
          </div>
        </div>

        <div className="rounded-md border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/50 hover:bg-muted/50">
                <TableHead>Name</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right w-[260px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10">
                    {rows.length === 0 ? "No suppliers yet — add your first supplier." : "No suppliers match your search."}
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((c: any) => {
                const bal = Number(c.balance ?? 0);
                return (
                  <TableRow key={c.id} className="group">
                    <TableCell className="font-medium">
                      <Link to="/suppliers/$id" params={{ id: c.id }} className="hover:underline text-primary inline-flex items-center gap-2">
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
                        <Badge variant="destructive" className="font-medium">To pay {fmtMoney(bal, sym)}</Badge>
                      ) : bal < 0 ? (
                        <Badge className="bg-success/15 text-success hover:bg-success/20 font-medium">Advance {fmtMoney(-bal, sym)}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-sm">Settled</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="ghost" asChild>
                        <Link to="/suppliers/$id" params={{ id: c.id }}><BookOpen className="h-3.5 w-3.5 mr-1" />Ledger</Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setPayOpen(c); setPay({ amount: Math.max(bal, 0), method: "cash", note: "" }); }}>
                        <HandCoins className="h-3.5 w-3.5 mr-1" />Pay
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
          <DialogHeader><DialogTitle>Pay supplier — {payOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={pay.amount || ""} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></div>
            <div><Label>Method</Label><Input value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} /></div>
            <div><Label>Note</Label><Input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayOpen(null)}>Cancel</Button>
            <Button onClick={recordPayment}>Record</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
