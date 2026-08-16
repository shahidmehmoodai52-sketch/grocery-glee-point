import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Printer, TrendingUp, TrendingDown, Wallet, Receipt as ReceiptIcon, FileDown, Eye, Pencil, DollarSign, Plus, Save, Ban } from "lucide-react";
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
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { Receipt, printReceipt } from "@/components/receipt";
import { AddPaymentDialog, EditPaymentDialog, EditEntryDialog, type LedgerEntity } from "@/components/ledger-dialogs";
import { summarizeCustomerLedger, buildLedgerEntries } from "@/lib/customer-ledger";

export const Route = createFileRoute("/_authenticated/customers/$id")({ component: Page });

type Entry = {
  id?: string;
  entity?: LedgerEntity;
  date: string;
  type: "sale" | "payment" | "return";
  ref: string;
  note: string;
  debit: number;
  credit: number;
  data?: any;
  balance?: number;
};

function Page() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [openInvoice, setOpenInvoice] = useState<any>(null);
  const [pdfPrompt, setPdfPrompt] = useState(false);
  const [addPayOpen, setAddPayOpen] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [payDefault, setPayDefault] = useState(0);
  const [editPayment, setEditPayment] = useState<any>(null);
  const [editEntry, setEditEntry] = useState<{ entity: Exclude<LedgerEntity, "payment">; entry: any } | null>(null);
  const [obValue, setObValue] = useState<string>("");
  const [obSaving, setObSaving] = useState(false);

  const { data: customer } = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => (await supabase.from("customers").select("*").eq("id", id).maybeSingle()).data,
  });
  const { data: sales = [] } = useQuery({
    queryKey: ["customer-sales", id],
    queryFn: async () =>
      (await supabase.from("sales")
        .select("id,invoice_no,subtotal,tax,discount,total,paid,change_due,payment_method,status,created_at,note,sale_items(id,name,qty,price,line_total)")
        .eq("customer_id", id).order("created_at", { ascending: true })).data ?? [],
  });
  const { data: payments = [] } = useQuery({
    queryKey: ["customer-payments", id],
    queryFn: async () =>
      (await supabase.from("party_payments").select("id,amount,method,note,created_at,cash_transaction_id")
        .eq("party_type", "customer").eq("party_id", id).order("created_at", { ascending: true })).data ?? [],
  });
  const { data: returns = [] } = useQuery({
    queryKey: ["customer-returns", id],
    queryFn: async () =>
      (await supabase.from("sale_returns").select("id,return_no,total,refund_amount,created_at,note")
        .eq("customer_id", id).order("created_at", { ascending: true })).data ?? [],
  });

  const entries: Entry[] = useMemo(() => {
    return buildLedgerEntries({
      sales: sales as any[],
      payments: payments as any[],
      returns: returns as any[],
    }) as any[];
  }, [sales, payments, returns]);

  const initialOB = Number(customer?.opening_balance ?? 0);
  useEffect(() => { if (customer) setObValue(String(Number(customer.opening_balance ?? 0))); }, [customer?.id, customer?.opening_balance]);

  const filteredEntries = entries.filter((x) => {
    if (from && x.date < from) return false;
    if (to && x.date > to + "T23:59:59") return false;
    return true;
  });

  const opening = initialOB + entries
    .filter((x) => from && x.date < from)
    .reduce((s, x) => s + x.debit - x.credit, 0);

  const saveOpeningBalance = async () => {
    const v = Number(obValue);
    if (!Number.isFinite(v)) return toast.error("Enter a valid number");
    setObSaving(true);
    const { error } = await supabase.from("customers").update({ opening_balance: v }).eq("id", id);
    setObSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Opening balance saved");
    qc.invalidateQueries({ queryKey: ["customer", id] });
  };

  let running = opening;
  const rows = filteredEntries.map((x) => { running += x.debit - x.credit; return { ...x, balance: running }; });
  const summary = useMemo(() => summarizeCustomerLedger({ openingBalance: opening, entries: filteredEntries }), [opening, filteredEntries]);
  const totalIn = summary.totalIn;
  const totalOut = summary.totalOut;
  const closing = summary.closing;
  const closingLabel = summary.closingLabel;
  const closingTone = summary.closingTone;

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

  const buildPdf = (includeItems: boolean) => buildLedgerPdf({
    storeName: settings?.store_name ?? "Store",
    storeAddress: settings?.address ?? "",
    storePhone: settings?.phone ?? "",
    partyName: customer?.name ?? "Customer",
    partyPhone: customer?.phone ?? "",
    heading: "Customer Ledger",
    from, to, currency: sym,
    rows, items: includeItems ? items : undefined,
    opening, totalDebit: totalIn, totalCredit: totalOut,
    owedLabel: "Outstanding (they owe)", advanceLabel: "Advance (credit)",
  });

  const voidSale = async (sale: any) => {
    if (!sale) return;
    if (!confirm(`Void invoice ${sale.invoice_no ?? sale.id}?`)) return;
    setVoiding(true);
    const { error } = await supabase.rpc("void_sale", { _sale_id: sale.id, _reason: "Voided from customer page" });
    setVoiding(false);
    if (error) return toast.error(error.message);
    toast.success("Invoice voided");
    qc.invalidateQueries();
  };

  const downloadPdf = (includeItems: boolean) => {
    const blob = buildPdf(includeItems);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Ledger-${customer?.name?.replace(/\s+/g, "_")}${includeItems ? "-detailed" : "-summary"}.pdf`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    setPdfPrompt(false);
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
          <Button variant="outline" onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          <Button variant="outline" onClick={() => setPdfPrompt(true)}><FileDown className="h-4 w-4 mr-2" />PDF</Button>
          <Button onClick={() => { setPayDefault(Math.max(closing, 0)); setAddPayOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />Add payment
          </Button>
        </div>
      </div>

      <div className="no-print">
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={(() => {
            for (const p of PRESETS) { const r = rangeFor(p.key); if (r.from === from && r.to === to) return p.key; }
            return "";
          })()}
          onChange={(e) => {
            if (!e.target.value) return;
            const r = rangeFor(e.target.value as DatePreset);
            setFrom(r.from); setTo(r.to);
          }}
        >
          <option value="">Quick range…</option>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>


      <Card className="p-3 no-print">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">Opening balance <span className="text-muted-foreground">(+ they owe / − advance)</span></Label>
            <Input
              type="number"
              step="0.01"
              value={obValue}
              onChange={(e) => setObValue(e.target.value)}
              placeholder="0.00"
            />
          </div>
          <Button onClick={saveOpeningBalance} disabled={obSaving}>
            <Save className="h-4 w-4 mr-1" />{obSaving ? "Saving…" : "Save opening"}
          </Button>
          <div className="text-xs text-muted-foreground">
            Current: <span className="font-medium text-foreground">{fmtMoney(initialOB, sym)}</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={TrendingUp} label={from ? `Opening (before ${from})` : "Opening balance"} value={fmtMoney(opening, sym)} tone={opening > 0 ? "destructive" : opening < 0 ? "success" : "primary"} />
        <Stat icon={ReceiptIcon} label="Total In (+)" value={fmtMoney(totalIn, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Total Out (−)" value={fmtMoney(totalOut, sym)} tone="success" />
        <Stat icon={Wallet} label={closingLabel} value={fmtMoney(Math.abs(closing), sym)} tone={closingTone} />
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
            <TableHead className="text-right">In (+)</TableHead>
            <TableHead className="text-right">Out (−)</TableHead>
            <TableHead className="text-right">Balance</TableHead>
            <TableHead className="text-right no-print w-52">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={4} className="text-muted-foreground">Opening balance {from ? `(before ${from})` : ""}</TableCell>
              <TableCell className="text-right">{opening > 0 ? fmtMoney(opening, sym) : "—"}</TableCell>
              <TableCell className="text-right text-success">{opening < 0 ? fmtMoney(-opening, sym) : "—"}</TableCell>
              <TableCell className={`text-right ${opening > 0 ? "text-destructive" : opening < 0 ? "text-success" : ""}`}>{fmtMoney(opening, sym)}</TableCell>
              <TableCell className="no-print"></TableCell>
            </TableRow>
            {rows.length === 0 && <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No transactions yet</TableCell></TableRow>}
            {rows.map((x, i) => {
              const due = x.type === "sale" ? Math.max(Number((x.data as any)?.total || 0) - Number((x.data as any)?.paid || 0), 0) : 0;
              return (
              <TableRow
                key={i}
                className={`cursor-pointer ${x.debit > 0 ? "bg-destructive/10 hover:bg-destructive/15" : x.credit > 0 ? "bg-success/10 hover:bg-success/15" : "hover:bg-muted/50"}`}
                onClick={(e) => {
                  // Inline action buttons keep their own behaviour.
                  if ((e.target as HTMLElement).closest("button")) return;
                  if (x.type === "payment" && x.id) return setEditPayment({ id: x.id, amount: x.credit, method: x.ref, note: x.note, created_at: x.date });
                  if (x.type && x.type !== "payment" && x.id) return setEditEntry({ entity: x.type === "sale" ? "sale" : "sale_return", entry: { id: x.id!, ref: x.ref, note: x.note, created_at: x.date } });
                }}
              >

                <TableCell className="whitespace-nowrap">{new Date(x.date).toLocaleString()}</TableCell>
                <TableCell>
                  <Badge variant={x.type === "sale" ? "default" : x.type === "return" ? "secondary" : "outline"} className="capitalize">
                    {x.type}
                  </Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">{x.ref}</TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {x.note || "—"}
                  {/* unpaid badge removed */}
                </TableCell>
                <TableCell className="text-right">{x.debit > 0 ? fmtMoney(x.debit, sym) : "—"}</TableCell>
                <TableCell className="text-right text-success">{x.credit > 0 ? fmtMoney(x.credit, sym) : "—"}</TableCell>
                <TableCell className={`text-right font-medium ${x.balance > 0 ? "text-destructive" : x.balance < 0 ? "text-success" : ""}`}>
                  {fmtMoney(x.balance, sym)}
                </TableCell>
                <TableCell className="text-right no-print">
                  <div className="flex justify-end gap-1">
                    {x.type === "sale" && x.data && (
                      <>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setOpenInvoice({ ...x.data, customers: { name: customer?.name, phone: customer?.phone } })}>
                          <Eye className="h-3.5 w-3.5" />
                        </Button>
                        {x.data.status !== "voided" && (
                          <Button size="sm" variant="destructive" className="h-7 px-2" onClick={() => voidSale(x.data)} disabled={voiding}>
                            <Ban className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </>
                    )}
                    {x.type === "sale" && due > 0 && (
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setPayDefault(due); setAddPayOpen(true); }}>
                        <DollarSign className="h-3.5 w-3.5 mr-1" />Pay
                      </Button>
                    )}
                    {x.type === "payment" && x.id && (
                      <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditPayment({ id: x.id, amount: x.credit, method: x.ref, note: x.note, created_at: x.date })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {x.type && x.type !== "payment" && x.id && (
                      <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditEntry({ entity: (x.type === "sale" ? "sale" : "sale_return") as any, entry: { id: x.id!, ref: x.ref, note: x.note, created_at: x.date } })}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
              );
            })}
            {rows.length > 0 && (
              <>
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={4}>Grand totals (incl. opening)</TableCell>
                  <TableCell className="text-right">{fmtMoney(totalIn + Math.max(opening, 0), sym)}</TableCell>
                  <TableCell className="text-right text-success">{fmtMoney(totalOut + Math.max(-opening, 0), sym)}</TableCell>
                  <TableCell className={`text-right ${closing > 0 ? "text-destructive" : closing < 0 ? "text-success" : ""}`}>{fmtMoney(closing, sym)}</TableCell>
                  <TableCell className="no-print"></TableCell>
                </TableRow>
                <TableRow className="bg-primary/5 text-xs">
                  <TableCell colSpan={8} className="text-muted-foreground text-right">
                    {fmtMoney(opening, sym)} (Opening) + {fmtMoney(totalIn, sym)} (In) − {fmtMoney(totalOut, sym)} (Out) = <span className="font-semibold text-foreground">{fmtMoney(closing, sym)}</span>
                  </TableCell>
                </TableRow>
                <TableRow className="bg-primary/10 font-bold">
                  <TableCell colSpan={6}>Closing balance · {closingLabel}</TableCell>
                  <TableCell className={`text-right ${closing > 0 ? "text-destructive" : closing < 0 ? "text-success" : ""}`}>{fmtMoney(closing, sym)}</TableCell>
                  <TableCell className="no-print"></TableCell>
                </TableRow>
              </>
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
            <Button onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddPaymentDialog open={addPayOpen} onOpenChange={setAddPayOpen} party="customer" partyId={id} party_name={customer?.name} defaultAmount={payDefault} />
      <EditPaymentDialog open={!!editPayment} onOpenChange={(o) => !o && setEditPayment(null)} payment={editPayment} />
      <EditEntryDialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)} entity={editEntry?.entity ?? null} entry={editEntry?.entry ?? null} />




      <Dialog open={pdfPrompt} onOpenChange={setPdfPrompt}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Generate PDF</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Choose how you want the ledger PDF: a clean summary with only bills & payments, or a full version that also includes item-wise details for every invoice.
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setPdfPrompt(false)}>Cancel</Button>
            <Button variant="secondary" onClick={() => downloadPdf(false)}>
              <FileDown className="h-4 w-4 mr-2" />Summary (bills only)
            </Button>
            <Button onClick={() => downloadPdf(true)}>
              <FileDown className="h-4 w-4 mr-2" />Full + item-wise
            </Button>
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
