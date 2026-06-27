import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer, TrendingUp, TrendingDown, Wallet, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/reports")({ component: Page });

function startOfMonth() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d.toISOString().slice(0, 10);
}
function today() { return new Date().toISOString().slice(0, 10); }

function Page() {
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const [from, setFrom] = useState(startOfMonth());
  const [to, setTo] = useState(today());

  const range = { from: new Date(from + "T00:00:00").toISOString(), to: new Date(to + "T23:59:59").toISOString() };

  const { data: sales = [] } = useQuery({
    queryKey: ["report-sales", from, to],
    queryFn: async () =>
      (await supabase.from("sales").select("subtotal,tax,discount,total,cost_total,paid,status,created_at,payment_method")
        .gte("created_at", range.from).lte("created_at", range.to)).data ?? [],
  });
  const { data: purchases = [] } = useQuery({
    queryKey: ["report-purchases", from, to],
    queryFn: async () =>
      (await supabase.from("purchases").select("subtotal,tax,total,paid,created_at")
        .gte("created_at", range.from).lte("created_at", range.to)).data ?? [],
  });
  const { data: expenses = [] } = useQuery({
    queryKey: ["report-expenses", from, to],
    queryFn: async () =>
      (await supabase.from("expenses")
        .select("amount,category,description,expense_date,method,expense_persons(name)")
        .gte("expense_date", from).lte("expense_date", to)
        .order("expense_date", { ascending: false })).data ?? [],
  });

  const revenue = sales.reduce((s, x: any) => s + Number(x.subtotal) - Number(x.discount), 0);
  const cogs = sales.reduce((s, x: any) => s + Number(x.cost_total), 0);
  const grossProfit = revenue - cogs;
  const taxCollected = sales.reduce((s, x: any) => s + Number(x.tax), 0);
  const totalSales = sales.reduce((s, x: any) => s + Number(x.total), 0);
  const totalPurchases = purchases.reduce((s, x: any) => s + Number(x.total), 0);
  const cashIn = sales.reduce((s, x: any) => s + Number(x.paid), 0);
  const cashOut = purchases.reduce((s, x: any) => s + Number(x.paid), 0);
  const creditOut = sales.filter((x: any) => x.status === "credit").reduce((s, x: any) => s + (Number(x.total) - Number(x.paid)), 0);
  const todayStr = new Date().toISOString().slice(0, 10);
  const expensesPeriod = expenses.reduce((s, x: any) => s + Number(x.amount), 0);
  const expensesToday = expenses.filter((x: any) => x.expense_date === todayStr).reduce((s, x: any) => s + Number(x.amount), 0);
  const netProfit = grossProfit - expensesPeriod;
  const expByCategory = Array.from(
    expenses.reduce((m: Map<string, number>, x: any) => m.set(x.category, (m.get(x.category) ?? 0) + Number(x.amount)), new Map()),
    ([name, value]) => ({ name, value: value as number }),
  ).sort((a, b) => b.value - a.value);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Reports — Profit & Loss</h1>
          <p className="text-sm text-muted-foreground">Period summary across sales and purchases</p>
        </div>
        <div className="flex items-end gap-2 no-print">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={TrendingUp} label="Revenue" value={fmtMoney(revenue, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Cost of goods" value={fmtMoney(cogs, sym)} tone="destructive" />
        <Stat icon={Wallet} label="Gross profit" value={fmtMoney(grossProfit, sym)} tone="success" />
        <Stat icon={TrendingDown} label={`Expenses today / period`} value={`${fmtMoney(expensesToday, sym)} / ${fmtMoney(expensesPeriod, sym)}`} tone="warning" />
      </div>

      <div id="printable-invoice" className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Profit & Loss Statement</h2>
          <Table>
            <TableBody>
              <Row label="Sales (net of discount)" value={fmtMoney(revenue, sym)} />
              <Row label="Cost of goods sold" value={`(${fmtMoney(cogs, sym)})`} />
              <Row label="Gross profit" value={fmtMoney(grossProfit, sym)} bold />
              <Row label="Tax collected" value={fmtMoney(taxCollected, sym)} muted />
              <Row label="Net profit" value={fmtMoney(grossProfit, sym)} bold accent />
            </TableBody>
          </Table>
          <div className="text-xs text-muted-foreground mt-3">
            {from} → {to} · {sales.length} sales, {purchases.length} purchases
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Cash Flow</h2>
          <Table>
            <TableBody>
              <Row label="Cash received from sales" value={fmtMoney(cashIn, sym)} />
              <Row label="Cash paid for purchases" value={`(${fmtMoney(cashOut, sym)})`} />
              <Row label="Net cash flow" value={fmtMoney(cashIn - cashOut, sym)} bold />
              <Row label="Total sales (incl. credit)" value={fmtMoney(totalSales, sym)} muted />
              <Row label="Total purchases" value={fmtMoney(totalPurchases, sym)} muted />
            </TableBody>
          </Table>
        </Card>
      </div>
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

function Row({ label, value, bold, muted, accent }: any) {
  return (
    <TableRow>
      <TableCell className={`${muted ? "text-muted-foreground" : ""}`}>{label}</TableCell>
      <TableCell className={`text-right ${bold ? "font-semibold" : ""} ${accent ? "text-primary text-lg" : ""}`}>{value}</TableCell>
    </TableRow>
  );
}
