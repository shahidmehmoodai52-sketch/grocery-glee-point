import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, DollarSign, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { offlineFirst, cacheCustomers, insertOfflineAware } from "@/lib/offline/pos";
import { db } from "@/lib/offline/db";


export const Route = createFileRoute("/_authenticated/customers/")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", email: "", address: "", balance: 0 });
  const [payOpen, setPayOpen] = useState<any>(null);
  const [pay, setPay] = useState({ amount: 0, method: "cash", note: "" });

  const { data: rows = [] } = useQuery({
    queryKey: ["customers"],
    queryFn: async () => offlineFirst<any[]>(
      async () => (await supabase.from("customers").select("*").order("name")).data ?? [],
      async () => (await db().customers.orderBy("name").toArray()) as any[],
      cacheCustomers,
    ),
  });

  const save = async () => {
    if (!form.name) return toast.error("Name required");
    try {
      const row = await insertOfflineAware("customers", form);
      toast.success(row._offline_pending ? "Customer saved offline — will sync" : "Customer added");
    } catch (e: any) { return toast.error(e?.message ?? "Failed"); }
    setOpen(false);
    setForm({ name: "", phone: "", email: "", address: "", balance: 0 });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  const recordPayment = async () => {
    if (!payOpen || pay.amount <= 0) return;
    const { error } = await supabase.rpc("record_payment", {
      p_party_type: "customer", p_party_id: payOpen.id, p_amount: pay.amount, p_method: pay.method, p_note: pay.note,
    });
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");

    setPayOpen(null);
    setPay({ amount: 0, method: "cash", note: "" });
    qc.invalidateQueries({ queryKey: ["customers"] });
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="text-sm text-muted-foreground">{rows.length} customers</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="h-4 w-4 mr-2" />New customer</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New customer</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Phone</Label><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                <div><Label>Email</Label><Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
              </div>
              <div><Label>Address</Label><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
              <div><Label>Opening balance (they owe)</Label><Input type="number" step="0.01" value={form.balance} onChange={(e) => setForm({ ...form, balance: Number(e.target.value) })} /></div>
            </div>
            <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save}>Save</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead>
            <TableHead className="text-right">Balance</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No customers yet</TableCell></TableRow>}
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link to="/customers/$id" params={{ id: c.id }} className="hover:underline text-primary">{c.name}</Link>
                </TableCell>
                <TableCell>{c.phone ?? "—"}</TableCell>
                <TableCell>{c.email ?? "—"}</TableCell>
                <TableCell className={`text-right font-medium ${Number(c.balance) > 0 ? "text-destructive" : ""}`}>
                  {fmtMoney(c.balance, sym)}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button size="sm" variant="ghost" asChild>
                    <Link to="/customers/$id" params={{ id: c.id }}><BookOpen className="h-3.5 w-3.5 mr-1" />Ledger</Link>
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setPayOpen(c); setPay({ amount: Number(c.balance), method: "cash", note: "" }); }}>
                    <DollarSign className="h-3.5 w-3.5 mr-1" />Receive payment
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!payOpen} onOpenChange={(o) => !o && setPayOpen(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Receive payment — {payOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Amount</Label><Input type="number" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: Number(e.target.value) })} /></div>
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
