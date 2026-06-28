import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, TrendingUp, TrendingDown, Wallet, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/suppliers/$id")({ component: Page });

type Entry = {
  date: string;
  type: "purchase" | "payment" | "return";
  ref: string;
  note: string;
  debit: number;   // we owe more
  credit: number;  // we paid / refunded
};

function Page() {
  const { id } = Route.useParams();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const { data: supplier } = useQuery({
    queryKey: ["supplier", id],
    queryFn: async () => (await supabase.from("suppliers").select("*").eq("id", id).maybeSingle()).data,
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["supplier-purchases", id],
    queryFn: async () =>
      (await supabase.from("purchases").select("id,invoice_no,total,paid,created_at,note")
        .eq("supplier_id", id).order("created_at", { ascending: true })).data ?? [],
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["supplier-payments", id],
    queryFn: async () =>
      (await supabase.from("party_payments").select("id,amount,method,note,created_at")
        .eq("party_type", "supplier").eq("party_id", id).order("created_at", { ascending: true })).data ?? [],
  });
  const { data: returns = [] } = useQuery({
    queryKey: ["supplier-returns", id],
    queryFn: async () =>
      (await supabase.from("purchase_returns").select("id,return_no,total,refund_amount,created_at,note")
        .eq("supplier_id", id).order("created_at", { ascending: true })).data ?? [],
  });

  const entries: Entry[] = useMemo(() => {
    const e: Entry[] = [];
    for (const p of purchases as any[]) {
      e.push({ date: p.created_at, type: "purchase", ref: p.invoice_no, note: p.note ?? "", debit: Number(p.total), credit: 0 });
      if (Number(p.paid) > 0) {
        e.push({ date: p.created_at, type: "payment", ref: `${p.invoice_no} · on-invoice`, note: "Paid at purchase time", debit: 0, credit: Number(p.paid) });
      }
    }
    for (const r of returns as any[]) {
      // Return reduces what we owe (credit) by (total - refund). Refund itself is cash received — also credit.
      e.push({ date: r.created_at, type: "return", ref: r.return_no, note: r.note ?? "", debit: 0, credit: Number(r.total) });
    }
    for (const pay of payments as any[]) {
      e.push({ date: pay.created_at, type: "payment", ref: pay.method, note: pay.note ?? "", debit: 0, credit: Number(pay.amount) });
    }
    e.sort((a, b) => a.date.localeCompare(b.date));
    return e;
  }, [purchases, payments, returns]);

  const filtered = entries.filter((x) => {
    if (from && x.date < from) return false;
    if (to && x.date > to + "T23:59:59") return false;
    return true;
  });

  let running = 0;
  const rows = filtered.map((x) => {
    running += x.debit - x.credit;
    return { ...x, balance: running };
  });

  const totalDebit = filtered.reduce((s, x) => s + x.debit, 0);
  const totalCredit = filtered.reduce((s, x) => s + x.credit, 0);
  const outstanding = Number(supplier?.balance ?? 0);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="no-print">
            <Link to="/suppliers"><ArrowLeft className="h-4 w-4 mr-1" />Suppliers</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{supplier?.name ?? "Supplier"}</h1>
            <p className="text-sm text-muted-foreground">
              {supplier?.phone ?? "—"} · {supplier?.email ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2 no-print">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Button variant="outline" onClick={() => { setFrom(""); setTo(""); }}>All</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Receipt} label="Total purchases" value={fmtMoney(totalDebit, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Paid / returned" value={fmtMoney(totalCredit, sym)} tone="success" />
        <Stat icon={TrendingUp} label="Period net" value={fmtMoney(totalDebit - totalCredit, sym)} tone="warning" />
        <Stat icon={Wallet} label="Outstanding (we owe)" value={fmtMoney(outstanding, sym)} tone={outstanding > 0 ? "destructive" : "success"} />
      </div>

      <Card className="p-3 print-area">
        <div className="hidden print:block text-center mb-3">
          <div className="text-lg font-semibold">{settings?.store_name ?? "Store"} — Supplier Ledger</div>
          <div className="text-xs">{supplier?.name} · {new Date().toLocaleString()}</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Ref</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Debit</TableHead>
              <TableHead className="text-right">Credit</TableHead>
              <TableHead className="text-right">Balance</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No transactions yet</TableCell></TableRow>
            )}
            {rows.map((x, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{new Date(x.date).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={x.type === "purchase" ? "default" : x.type === "return" ? "secondary" : "outline"} className="capitalize">
                    {x.type}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{x.ref}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{x.note || "—"}</TableCell>
                <TableCell className="text-right">{x.debit > 0 ? fmtMoney(x.debit, sym) : "—"}</TableCell>
                <TableCell className="text-right text-success">{x.credit > 0 ? fmtMoney(x.credit, sym) : "—"}</TableCell>
                <TableCell className={`text-right font-medium ${x.balance > 0 ? "text-destructive" : x.balance < 0 ? "text-success" : ""}`}>
                  {fmtMoney(x.balance, sym)}
                </TableCell>
              </TableRow>
            ))}
            {rows.length > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={4}>Totals</TableCell>
                <TableCell className="text-right">{fmtMoney(totalDebit, sym)}</TableCell>
                <TableCell className="text-right text-success">{fmtMoney(totalCredit, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(running, sym)}</TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function Stat({ icon: Icon, label, value, tone }: any) {
  const colors: Record<string, string> = {
    primary: "text-primary", success: "text-success", destructive: "text-destructive", warning: "text-warning",
  };
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${colors[tone]}`}>{value}</div>
    </Card>
  );
}
