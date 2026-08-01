import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Printer, TrendingUp, TrendingDown, Wallet, Receipt, FileDown, ChevronDown, ChevronRight, Pencil, DollarSign, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { printReceipt } from "@/components/receipt";

import { buildLedgerPdf } from "@/lib/pdf-ledger";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { AddPaymentDialog, EditPaymentDialog, EditEntryDialog, type LedgerEntity } from "@/components/ledger-dialogs";


export const Route = createFileRoute("/_authenticated/suppliers/$id")({ component: Page });

type Entry = {
  id?: string;
  entity?: LedgerEntity;
  date: string;
  type: "purchase" | "payment" | "return";
  ref: string;
  note: string;
  debit: number;   // In  (+) — we owe more
  credit: number;  // Out (−) — we paid / refunded
  purchase_id?: string;
  paid?: number;
  total?: number;
};

function Page() {
  const { id } = Route.useParams();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [addPayOpen, setAddPayOpen] = useState(false);
  const [payDefault, setPayDefault] = useState(0);
  const [editPayment, setEditPayment] = useState<any>(null);
  const [editEntry, setEditEntry] = useState<{ entity: Exclude<LedgerEntity, "payment">; entry: any } | null>(null);
  const [obValue, setObValue] = useState<string>("");
  const [obSaving, setObSaving] = useState(false);
  const qc = useQueryClient();
  const toggle = (pid: string) => setExpanded((s) => { const n = new Set(s); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });


  const { data: purchaseItems = [] } = useQuery({
    queryKey: ["supplier-purchase-items", id],
    queryFn: async () => {
      const { data: ps } = await supabase.from("purchases").select("id").eq("supplier_id", id);
      const ids = (ps ?? []).map((p) => p.id);
      if (!ids.length) return [];
      return (await supabase.from("purchase_items").select("purchase_id,name,qty,cost,line_total").in("purchase_id", ids)).data ?? [];
    },
  });
  const itemsByPurchase = useMemo(() => {
    const m = new Map<string, any[]>();
    (purchaseItems as any[]).forEach((it) => {
      const arr = m.get(it.purchase_id) ?? []; arr.push(it); m.set(it.purchase_id, arr);
    });
    return m;
  }, [purchaseItems]);

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
      (await supabase.from("party_payments").select("id,amount,method,note,created_at,cash_transaction_id")
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
      e.push({ id: p.id, entity: "purchase", date: p.created_at, type: "purchase", ref: p.invoice_no, note: p.note ?? "", debit: Number(p.total), credit: 0, purchase_id: p.id, paid: Number(p.paid), total: Number(p.total) });
      if (Number(p.paid) > 0) {
        e.push({ date: p.created_at, type: "payment", ref: `${p.invoice_no} · on-invoice`, note: "Paid at purchase time", debit: 0, credit: Number(p.paid) });
      }
    }
    for (const r of returns as any[]) {
      e.push({ id: r.id, entity: "purchase_return", date: r.created_at, type: "return", ref: r.return_no, note: r.note ?? "", debit: 0, credit: Number(r.total) });
    }
    for (const pay of payments as any[]) {
      e.push({ id: pay.id, entity: "payment", date: pay.created_at, type: "payment", ref: pay.method, note: pay.note ?? "", debit: 0, credit: Number(pay.amount) });
    }
    e.sort((a, b) => a.date.localeCompare(b.date));
    return e;
  }, [purchases, payments, returns]);

  const filtered = entries.filter((x) => {
    if (from && x.date < from) return false;
    if (to && x.date > to + "T23:59:59") return false;
    return true;
  });

  // Single source of truth: ledger + a manually-entered opening balance drive every number.
  const initialOB = Number(supplier?.opening_balance ?? 0);
  useEffect(() => { if (supplier) setObValue(String(Number(supplier.opening_balance ?? 0))); }, [supplier?.id, supplier?.opening_balance]);

  const opening = initialOB + entries
    .filter((x) => from && x.date < from)
    .reduce((s, x) => s + x.debit - x.credit, 0);

  const saveOpeningBalance = async () => {
    const v = Number(obValue);
    if (!Number.isFinite(v)) return toast.error("Enter a valid number");
    setObSaving(true);
    const { error } = await supabase.from("suppliers").update({ opening_balance: v }).eq("id", id);
    setObSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Opening balance saved");
    qc.invalidateQueries({ queryKey: ["supplier", id] });
  };


  let running = opening;
  const rows = filtered.map((x) => {
    running += x.debit - x.credit;
    return { ...x, balance: running };
  });

  const totalIn = filtered.reduce((s, x) => s + x.debit, 0);
  const totalOut = filtered.reduce((s, x) => s + x.credit, 0);
  const closing = opening + totalIn - totalOut;
  const closingLabel = closing > 0 ? "Outstanding (we owe)" : closing < 0 ? "Advance (we paid extra)" : "Settled";
  const closingTone = closing > 0 ? "destructive" : closing < 0 ? "success" : "primary";

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
        <div className="flex items-end gap-2 no-print flex-wrap">
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Button variant="outline" onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-2" />Print</Button>
          <Button variant="outline" onClick={() => {
            const blob = buildLedgerPdf({
              storeName: settings?.store_name ?? "Store", storeAddress: settings?.address ?? "", storePhone: settings?.phone ?? "",
              partyName: supplier?.name ?? "Supplier", partyPhone: supplier?.phone ?? "",
              heading: "Supplier Ledger", from, to, currency: sym,
              rows, opening, totalDebit: totalIn, totalCredit: totalOut,
              owedLabel: "Outstanding (we owe)", advanceLabel: "Advance (we paid extra)",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `Ledger-${supplier?.name?.replace(/\s+/g,"_")}.pdf`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }}><FileDown className="h-4 w-4 mr-2" />PDF</Button>
          <Button onClick={() => { setPayDefault(Math.max(Number(supplier?.balance ?? 0), 0)); setAddPayOpen(true); }}>
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
            <Label className="text-xs">Opening balance <span className="text-muted-foreground">(+ they owe us / − advance paid)</span></Label>
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
        <Stat icon={Receipt} label="Total In (+)" value={fmtMoney(totalIn, sym)} tone="primary" />
        <Stat icon={TrendingDown} label="Total Out (−)" value={fmtMoney(totalOut, sym)} tone="success" />
        <Stat icon={Wallet} label={closingLabel} value={fmtMoney(Math.abs(closing), sym)} tone={closingTone} />
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
              <TableHead className="text-right">In (+)</TableHead>
              <TableHead className="text-right">Out (−)</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="text-right no-print w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={4} className="text-muted-foreground">Opening balance {from ? `(before ${from})` : ""}</TableCell>
              <TableCell className="text-right">{opening > 0 ? fmtMoney(opening, sym) : "—"}</TableCell>
              <TableCell className="text-right text-success">{opening < 0 ? fmtMoney(-opening, sym) : "—"}</TableCell>
              <TableCell className={`text-right ${opening > 0 ? "text-destructive" : opening < 0 ? "text-success" : ""}`}>{fmtMoney(opening, sym)}</TableCell>
              <TableCell className="no-print"></TableCell>
            </TableRow>
            {rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">No transactions yet</TableCell></TableRow>
            )}
            {rows.map((x, i) => {
              const isPurchase = x.type === "purchase" && x.purchase_id;
              const open = isPurchase && expanded.has(x.purchase_id!);
              const items = isPurchase ? itemsByPurchase.get(x.purchase_id!) ?? [] : [];
              const due = isPurchase ? Number(x.total || 0) - Number(x.paid || 0) : 0;
              return (
                <Fragment key={i}>
                  <TableRow className={x.debit > 0 ? "bg-destructive/10 hover:bg-destructive/15" : x.credit > 0 ? "bg-success/10 hover:bg-success/15" : ""}>
                    <TableCell className="whitespace-nowrap">{new Date(x.date).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {x.type !== "purchase" && (
                        <Badge variant={x.type === "return" ? "secondary" : "outline"} className="capitalize">
                          {x.type}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {isPurchase ? (
                        <button onClick={() => toggle(x.purchase_id!)} className="inline-flex items-center gap-1 hover:underline no-print">
                          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                          {x.ref}
                        </button>
                      ) : x.ref}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {x.note || "—"}
                      {isPurchase && due <= 0 && Number(x.paid || 0) > 0 && <Badge variant="secondary" className="ml-2 text-[10px]">Paid</Badge>}

                    </TableCell>
                    <TableCell className="text-right">{x.debit > 0 ? fmtMoney(x.debit, sym) : "—"}</TableCell>
                    <TableCell className="text-right text-success">{x.credit > 0 ? fmtMoney(x.credit, sym) : "—"}</TableCell>
                    <TableCell className={`text-right font-medium ${x.balance > 0 ? "text-destructive" : x.balance < 0 ? "text-success" : ""}`}>
                      {fmtMoney(x.balance, sym)}
                    </TableCell>
                    <TableCell className="text-right no-print">
                      <div className="flex justify-end gap-1">
                        {isPurchase && due > 0 && (
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => { setPayDefault(due); setAddPayOpen(true); }}>
                            <DollarSign className="h-3.5 w-3.5 mr-1" />Pay
                          </Button>
                        )}
                        {x.entity === "payment" && x.id && (
                          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => setEditPayment({ id: x.id, amount: x.credit, method: x.ref, note: x.note, created_at: x.date })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {x.entity && x.entity !== "payment" && x.id && (
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setEditEntry({ entity: x.entity as Exclude<LedgerEntity,"payment">, entry: { id: x.id!, ref: x.ref, note: x.note, created_at: x.date } })}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {open && (
                    <TableRow key={`${i}-d`} className="bg-muted/30">
                      <TableCell colSpan={8} className="p-0">
                        <div className="p-3">
                          <div className="text-xs font-medium mb-2 text-muted-foreground">Items in {x.ref} · Total {fmtMoney(Number(x.total||0), sym)} · Paid {fmtMoney(Number(x.paid||0), sym)} · Due {fmtMoney(due, sym)}</div>
                          {items.length === 0 ? (
                            <div className="text-xs text-muted-foreground">No item details</div>
                          ) : (
                            <Table>
                              <TableHeader><TableRow>
                                <TableHead>Item</TableHead>
                                <TableHead className="text-right w-20">Qty</TableHead>
                                <TableHead className="text-right w-28">Cost</TableHead>
                                <TableHead className="text-right w-28">Amount</TableHead>
                              </TableRow></TableHeader>
                              <TableBody>
                                {items.map((it, j) => (
                                  <TableRow key={j}>
                                    <TableCell>{it.name}</TableCell>
                                    <TableCell className="text-right">{Number(it.qty)}</TableCell>
                                    <TableCell className="text-right">{fmtMoney(Number(it.cost), sym)}</TableCell>
                                    <TableCell className="text-right font-medium">{fmtMoney(Number(it.line_total), sym)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
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

      <AddPaymentDialog open={addPayOpen} onOpenChange={setAddPayOpen} party="supplier" partyId={id} party_name={supplier?.name} defaultAmount={payDefault} />
      <EditPaymentDialog open={!!editPayment} onOpenChange={(o) => !o && setEditPayment(null)} payment={editPayment} />
      <EditEntryDialog open={!!editEntry} onOpenChange={(o) => !o && setEditEntry(null)} entity={editEntry?.entity ?? null} entry={editEntry?.entry ?? null} />
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
