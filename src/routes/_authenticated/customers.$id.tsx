import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, TrendingUp, TrendingDown, Wallet, Receipt as ReceiptIcon, FileDown, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtQty } from "@/lib/format";

import { buildLedgerPdf, type LedgerItem } from "@/lib/pdf-ledger";
import { Receipt } from "@/components/receipt";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/customers/$id")({ component: Page });

type Entry = {
  date: string;
  type: "sale" | "payment" | "return";
  ref: string;
  note: string;
  debit: number;
  credit: number;
  sale?: any;       // attached for sale rows so we can re-open / re-print the invoice
};

function Page() {
  const { id } = Route.useParams();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openInvoice, setOpenInvoice] = useState<any>(null);

  const { data: customer } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => (await supabase.from("customers").select("*").eq("id", id).maybeSingle()).data,
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["customer-sales", id],
    queryFn: async () =>
      (await supabase.from("sales")
        .select("id,invoice_no,subtotal,tax,discount,total,paid,change_due,payment_method,created_at,note,sale_items(id,name,qty,price,line_total)")
        .eq("customer_id", id).order("created_at", { ascending: true })).data ?? [],
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["customer-payments", id],
    queryFn: async () =>
      (await supabase.from("party_payments").select("id,amount,method,note,created_at")
        .eq("party_type", "customer").eq("party_id", id).order("created_at", { ascending: true })).data ?? [],
  });
  const { data: returns = [] } = useQuery({
    queryKey: ["customer-returns", id],
    queryFn: async () =>
      (await supabase.from("sale_returns").select("id,return_no,total,refund_amount,created_at,note")
        .eq("customer_id", id).order("created_at", { ascending: true })).data ?? [],
  });

  const entries: Entry[] = useMemo(() => {
    const e: Entry[] = [];
    for (const s of sales as any[]) {
      e.push({ date: s.created_at, type: "sale", ref: s.invoice_no, note: s.note ?? "", debit: Number(s.total), credit: 0, sale: s });
      if (Number(s.paid) > 0) {
        e.push({ date: s.created_at, type: "payment", ref: `${s.invoice_no} · on-invoice`, note: "Paid at sale", debit: 0, credit: Number(s.paid) });
      }
    }
    for (const r of returns as any[]) {
      e.push({ date: r.created_at, type: "return", ref: r.return_no, note: r.note ?? "", debit: 0, credit: Number(r.total) });
    }
    for (const p of payments as any[]) {
      e.push({ date: p.created_at, type: "payment", ref: p.method, note: p.note ?? "", debit: 0, credit: Number(p.amount) });
    }
    e.sort((a, b) => a.date.localeCompare(b.date));
    return e;
  }, [sales, payments, returns]);

  const filtered = entries.filter((x) => {
    if (from && x.date < from) return false;
    if (to && x.date > to + "T23:59:59") return false;
    return true;
  });

  let running = 0;
  const rows = filtered.map((x) => { running += x.debit - x.credit; return { ...x, balance: running }; });
  const totalDebit = filtered.reduce((s, x) => s + x.debit, 0);
  const totalCredit = filtered.reduce((s, x) => s + x.credit, 0);
  const outstanding = Number(customer?.balance ?? 0);

  const items: LedgerItem[] = useMemo(() => {
    const out: LedgerItem[] = [];
    for (const s of sales as any[]) {
      if (from && s.created_at < from) continue;
      if (to && s.created_at > to + "T23:59:59") continue;
      for (const it of s.sale_items ?? []) {
        out.push({
          date: s.created_at, invoice: s.invoice_no, name: it.name,
          qty: Number(it.qty), price: Number(it.price), total: Number(it.line_total),
        });
      }
    }
    return out;
  }, [sales, from, to]);

  const buildPdf = () => buildLedgerPdf({
    storeName: settings?.store_name ?? "Store",
    storeAddress: settings?.address ?? "",
    storePhone: settings?.phone ?? "",
    partyName: customer?.name ?? "Customer",
    partyPhone: customer?.phone ?? "",
    heading: "Customer Ledger",
    from, to, currency: sym,
    rows, items,
    totalDebit, totalCredit, outstanding,
  });

  const summaryMsg = () =>
    `*${settings?.store_name ?? "Store"}* — Account statement for ${customer?.name}\n` +
    (from || to ? `Period: ${from || "—"} to ${to || "—"}\n` : "") +
    `Total purchases: ${sym}${totalDebit.toFixed(2)}\n` +
    `Paid / returns: ${sym}${totalCredit.toFixed(2)}\n` +
    `*Outstanding balance: ${sym}${outstanding.toFixed(2)}*\n` +
    `Thank you for your business.`;

  const sendQuickWa = () => {
    if (!customer?.phone) return toast.error("No phone number on file");
    openWhatsApp(customer.phone, summaryMsg());
  };
  const sendPdfWa = async () => {
    const blob = buildPdf();
    const res = await shareOrDownloadPdf({
      phone: customer?.phone, message: summaryMsg(),
      filename: `Ledger-${customer?.name?.replace(/\s+/g, "_")}.pdf`, blob,
    });
    if (res === "downloaded") toast.info("PDF downloaded — attach it in WhatsApp");
  };
  const downloadPdf = () => {
    const blob = buildPdf();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Ledger-${customer?.name?.replace(/\s+/g, "_")}.pdf`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="no-print">
            <Link to="/customers"><ArrowLeft className="h-4 w-4 mr-1" />Customers</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{customer?.name ?? "Customer"}</h1>
            <p className="text-sm text-muted-foreground">
              {customer?.phone ?? "—"} · {customer?.email ?? "—"}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2 no-print flex-wrap">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Button variant="outline" onClick={() => { setFrom(""); setTo(""); }}>All</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          <Button variant="outline" onClick={downloadPdf}><FileDown className="h-4 w-4 mr-2" />PDF</Button>
          <Button variant="outline" onClick={sendQuickWa} className="text-success border-success/40">
            <MessageCircle className="h-4 w-4 mr-2" />WhatsApp summary
          </Button>
          <Button onClick={sendPdfWa} className="bg-success hover:bg-success/90 text-success-foreground">
            <MessageCircle className="h-4 w-4 mr-2" />Send full PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={ReceiptIcon} label="Total sales" value={fmtMoney(totalDebit, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Received / returned" value={fmtMoney(totalCredit, sym)} tone="success" />
        <Stat icon={TrendingUp} label="Period net" value={fmtMoney(totalDebit - totalCredit, sym)} tone="warning" />
        <Stat icon={Wallet} label="Outstanding (they owe)" value={fmtMoney(outstanding, sym)} tone={outstanding > 0 ? "destructive" : "success"} />
      </div>

      <Card className="p-3 print-area">
        <div className="hidden print:block text-center mb-3">
          <div className="text-lg font-semibold">{settings?.store_name ?? "Store"} — Customer Ledger</div>
          <div className="text-xs">{customer?.name} · {new Date().toLocaleString()}</div>
        </div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Type</TableHead><TableHead>Ref</TableHead>
            <TableHead>Note</TableHead>
            <TableHead className="text-right">Debit</TableHead>
            <TableHead className="text-right">Credit</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right no-print w-20">Invoice</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No transactions yet</TableCell></TableRow>}
            {rows.map((x, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{new Date(x.date).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={x.type === "sale" ? "default" : x.type === "return" ? "secondary" : "outline"} className="capitalize">
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
                <TableCell className="text-right no-print">
                  {x.type === "sale" && x.sale && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenInvoice({ ...x.sale, customers: { name: customer?.name, phone: customer?.phone } })}>
                      <Eye className="h-3.5 w-3.5 mr-1" />Open
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length > 0 && (
              <TableRow className="bg-muted/40 font-semibold">
                <TableCell colSpan={4}>Totals</TableCell>
                <TableCell className="text-right">{fmtMoney(totalDebit, sym)}</TableCell>
                <TableCell className="text-right text-success">{fmtMoney(totalCredit, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(running, sym)}</TableCell>
                <TableCell className="no-print"></TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Invoice viewer — open from any sale row */}
      <Dialog open={!!openInvoice} onOpenChange={(o) => !o && setOpenInvoice(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Invoice {openInvoice?.invoice_no}</DialogTitle>
          </DialogHeader>
          <div className="bg-muted/30 rounded p-3 max-h-[70vh] overflow-auto">
            <div className="print-area">
              {openInvoice && <Receipt invoice={openInvoice} settings={settings as any} />}
            </div>
          </div>
          <DialogFooter className="no-print">
            <Button variant="outline" onClick={() => setOpenInvoice(null)}>Close</Button>
            <Button onClick={() => window.print()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


      <Card className="p-3 print-area">
        <div className="mb-2 font-semibold">Item-wise details</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Invoice</TableHead><TableHead>Item</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {items.length === 0 && <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No items in this period</TableCell></TableRow>}
            {items.map((it, i) => (
              <TableRow key={i}>
                <TableCell className="whitespace-nowrap">{new Date(it.date).toLocaleDateString()}</TableCell>
                <TableCell className="font-mono text-xs">{it.invoice}</TableCell>
                <TableCell>{it.name}</TableCell>
                <TableCell className="text-right">{fmtQty(it.qty)}</TableCell>
                <TableCell className="text-right">{fmtMoney(it.price, sym)}</TableCell>
                <TableCell className="text-right">{fmtMoney(it.total, sym)}</TableCell>
              </TableRow>
            ))}
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
