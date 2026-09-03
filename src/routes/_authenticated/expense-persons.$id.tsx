import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Printer, TrendingUp, TrendingDown, Wallet, Plus, Save, FileDown, Receipt as ReceiptIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Receipt, printReceipt } from "@/components/receipt";
import { buildLedgerPdf } from "@/lib/pdf-ledger";
import { PRESETS, rangeFor, type DatePreset } from "@/lib/date-presets";
import { AddPaymentDialog, EditPaymentDialog } from "@/components/ledger-dialogs";
import { summarizeCustomerLedger } from "@/lib/customer-ledger";

export const Route = createFileRoute("/_authenticated/expense-persons/$id")({ component: Page });

function Page() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const categoryLabel = (c: string) => t(`expenses.category_${c}`, c.replace(/_/g, " "));

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [addPayOpen, setAddPayOpen] = useState(false);
  const [payDefault, setPayDefault] = useState(0);
  const [editPayment, setEditPayment] = useState<any>(null);
  const [obValue, setObValue] = useState<string>("");
  const [obSaving, setObSaving] = useState(false);
  const [view, setView] = useState<any>(null);

  const openSale = async (saleId: string) => {
    const { data } = await supabase
      .from("sales").select("*, sale_items(*), customers(name,phone)")
      .eq("id", saleId).maybeSingle();
    setView(data);
  };

  const { data: person } = useQuery({
    queryKey: ["expense_person", id],
    queryFn: async () =>
      (await supabase.from("expense_persons").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: entries = [], isLoading: ledgerLoading, error: ledgerError } = useQuery({
    queryKey: ["expense-person-ledger", id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_expense_person_ledger", { p_person_id: id });
      if (error) throw error;
      return (data ?? []).map((row: any) => ({
        id: row.id ?? undefined,
        date: row.occurred_at,
        type: row.entry_type === "expense_payment" ? "expense_payment" : row.entry_type === "payment" ? "payment" : "expense",
        entity: row.entry_type === "expense" ? "expense" : row.entry_type === "payment" ? "payment" : undefined,
        ref: row.reference,
        note: row.note ?? "",
        debit: Number(row.debit || 0),
        credit: Number(row.credit || 0),
        data: row.source_data,
      }));
    },
  });

  const filteredEntries = entries.filter((x) => {
    if (from && x.date < from) return false;
    if (to && x.date > to + "T23:59:59") return false;
    return true;
  });

  // Single source of truth: ledger + a manually-entered opening balance drive every number.
  const initialOB = Number(person?.opening_balance ?? 0);
  useEffect(() => { if (person) setObValue(String(Number(person.opening_balance ?? 0))); }, [person?.id, person?.opening_balance]);

  const opening = initialOB + entries
    .filter((x) => from && x.date < from)
    .reduce((s, x) => s + x.debit - x.credit, 0);

  const saveOpeningBalance = async () => {
    const v = Number(obValue);
    if (!Number.isFinite(v)) return toast.error(t('customers.enter_valid_number', 'Enter a valid number'));
    setObSaving(true);
    const { error } = await supabase.from("expense_persons").update({ opening_balance: v }).eq("id", id);
    setObSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('customers.opening_balance_saved', 'Opening balance saved'));
    qc.invalidateQueries({ queryKey: ["expense_person", id] });
  };

  let running = opening;
  const rows = filteredEntries.map((x) => {
    running += x.debit - x.credit;
    return { ...x, balance: running };
  });

  const summary = useMemo(() => summarizeCustomerLedger({ openingBalance: opening, entries: filteredEntries }), [opening, filteredEntries]);
  const totalIn = summary.totalIn;
  const totalOut = summary.totalOut;
  const closing = summary.closing;

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm" className="no-print">
            <Link to="/expenses"><ArrowLeft className="h-4 w-4 mr-1" />{t('expenses.back', 'Back')}</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{person?.name ?? t('expenses.person_fallback', 'Person')}</h1>
            <p className="text-sm text-muted-foreground">
              {person?.role ? t(`expenses.role_${person.role}`, person.role) : "—"} {person?.phone ? `· ${person.phone}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-2 no-print flex-wrap">
          <div><Label className="text-xs">{t('customers.from_label', 'From')}</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9" /></div>
          <div><Label className="text-xs">{t('customers.to_label', 'To')}</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9" /></div>
          <Button variant="outline" onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-2" />{t('common.print', 'Print')}</Button>
          <Button variant="outline" onClick={() => {
            const blob = buildLedgerPdf({
              storeName: settings?.store_name ?? "Store", storeAddress: settings?.address ?? "", storePhone: settings?.phone ?? "",
              partyName: person?.name ?? "Staff", partyPhone: person?.phone ?? "",
              heading: "Staff Ledger", from, to, currency: sym,
              rows, opening, totalDebit: totalIn, totalCredit: totalOut,
              owedLabel: "Owed to staff", advanceLabel: "Advance given",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a"); a.href = url; a.download = `Ledger-${person?.name?.replace(/\s+/g, "_")}.pdf`; a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          }}><FileDown className="h-4 w-4 mr-2" />{t('customers.pdf', 'PDF')}</Button>
          <Button onClick={() => { setPayDefault(Math.max(closing, 0)); setAddPayOpen(true); }}>
            <Plus className="h-4 w-4 mr-1" />{t('expenses.pay_staff', 'Pay staff')}
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
          <option value="">{t('customers.quick_range_placeholder', 'Quick range…')}</option>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>

      <Card className="p-3 no-print">
        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">{t('expenses.opening_balance_label', 'Opening balance')} <span className="text-muted-foreground">{t('expenses.opening_balance_hint', '(amount already owed to this person before this system was used)')}</span></Label>
            <Input type="number" step="0.01" value={obValue} onChange={(e) => setObValue(e.target.value)} placeholder="0.00" />
          </div>
          <Button onClick={saveOpeningBalance} disabled={obSaving}>
            <Save className="h-4 w-4 mr-1" />{obSaving ? t('common.saving', 'Saving…') : t('customers.save_opening', 'Save opening')}
          </Button>
          <div className="text-xs text-muted-foreground">
            {t('customers.current_label', 'Current:')} <span className="font-medium text-foreground">{fmtMoney(initialOB, sym)}</span>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={TrendingUp} label={from ? t('customers.stat_opening_before', 'Opening (before {{date}})', { date: from }) : t('expenses.opening_balance_label', 'Opening balance')} value={fmtMoney(opening, sym)} tone={opening > 0 ? "destructive" : opening < 0 ? "success" : "primary"} />
        <Stat icon={TrendingDown} label={t('expenses.stat_accrued', 'Accrued (owed)')} value={fmtMoney(totalIn, sym)} tone="destructive" />
        <Stat icon={Wallet} label={t('expenses.stat_given', 'Given (paid out)')} value={fmtMoney(totalOut, sym)} tone="success" />
        <Stat icon={Wallet} label={closing > 0 ? t('expenses.closing_owed', 'Owed to staff') : closing < 0 ? t('expenses.closing_advance', 'Advance given') : t('expenses.closing_settled', 'Settled')} value={fmtMoney(Math.abs(closing), sym)} tone={closing > 0 ? "destructive" : closing < 0 ? "success" : "primary"} />
      </div>

      <Card className="p-3 print-area">
        <div className="hidden print:block text-center mb-3">
          <div className="text-lg font-semibold">{settings?.store_name ?? "Store"} — Staff Ledger</div>
          <div className="text-xs">{person?.name} · {new Date().toLocaleString()}</div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('sales.th_date', 'Date')}</TableHead>
              <TableHead>{t('customers.th_type', 'Type')}</TableHead>
              <TableHead>{t('customers.th_ref', 'Ref')}</TableHead>
              <TableHead>{t('common.note', 'Note')}</TableHead>
              <TableHead className="text-right">{t('expenses.th_owed', 'Owed (+)')}</TableHead>
              <TableHead className="text-right">{t('expenses.th_given', 'Given (−)')}</TableHead>
              <TableHead className="text-right">{t('customers.th_balance', 'Balance')}</TableHead>
              <TableHead className="text-right no-print w-20">{t('customers.th_actions', 'Actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow className="bg-muted/40 font-medium">
              <TableCell colSpan={4} className="text-muted-foreground">{t('customers.opening_balance_row', 'Opening balance')} {from ? t('customers.before_date', '(before {{date}})', { date: from }) : ""}</TableCell>
              <TableCell className="text-right">{opening > 0 ? fmtMoney(opening, sym) : "—"}</TableCell>
              <TableCell className="text-right text-success">{opening < 0 ? fmtMoney(-opening, sym) : "—"}</TableCell>
              <TableCell className={`text-right ${opening > 0 ? "text-destructive" : opening < 0 ? "text-success" : ""}`}>{fmtMoney(opening, sym)}</TableCell>
              <TableCell className="no-print"></TableCell>
            </TableRow>
            {ledgerError && (
              <TableRow><TableCell colSpan={8} className="text-center text-destructive py-6">{t('suppliers.ledger_load_error', 'Could not load ledger. Please refresh and try again.')}</TableCell></TableRow>
            )}
            {!ledgerError && ledgerLoading && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">{t('suppliers.loading_ledger', 'Loading ledger…')}</TableCell></TableRow>
            )}
            {!ledgerError && !ledgerLoading && rows.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-6">{t('customers.no_transactions_yet', 'No transactions yet')}</TableCell></TableRow>
            )}
            {rows.map((x, i) => (
              <TableRow
                key={i}
                className={`${x.entity === "payment" && x.id ? "cursor-pointer" : ""} ${x.debit > 0 ? "bg-destructive/10 hover:bg-destructive/15" : x.credit > 0 ? "bg-success/10 hover:bg-success/15" : ""}`}
                onClick={() => {
                  if (x.entity === "payment" && x.id) setEditPayment({ id: x.id, amount: x.credit, method: x.ref, note: x.note, created_at: x.date });
                }}
              >
                <TableCell className="whitespace-nowrap">{new Date(x.date).toLocaleDateString()}</TableCell>
                <TableCell>
                  <Badge variant={x.type === "payment" ? "outline" : "secondary"} className="capitalize">
                    {x.type === "payment" ? t('suppliers.entry_type_payment', 'payment')
                      : x.type === "expense_payment" ? t('expenses.entry_type_paid', 'paid immediately')
                      : categoryLabel(x.ref)}
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
                  {x.entity === "payment" && x.id && (
                    <span className="text-xs text-muted-foreground">{t('common.edit', 'Edit')}</span>
                  )}
                  {x.entity === "expense" && x.data?.sale_id && (
                    <Button size="sm" variant="ghost" className="h-7 px-2" onClick={(e) => { e.stopPropagation(); openSale(x.data.sale_id); }} title={t('sales.view_invoice', 'View invoice')}>
                      <ReceiptIcon className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {rows.length > 0 && (
              <>
                <TableRow className="bg-muted/40 font-semibold">
                  <TableCell colSpan={4}>{t('customers.grand_totals_row', 'Grand totals (incl. opening)')}</TableCell>
                  <TableCell className="text-right">{fmtMoney(totalIn + Math.max(opening, 0), sym)}</TableCell>
                  <TableCell className="text-right text-success">{fmtMoney(totalOut + Math.max(-opening, 0), sym)}</TableCell>
                  <TableCell className={`text-right ${closing > 0 ? "text-destructive" : closing < 0 ? "text-success" : ""}`}>{fmtMoney(closing, sym)}</TableCell>
                  <TableCell className="no-print"></TableCell>
                </TableRow>
                <TableRow className="bg-primary/5 text-xs">
                  <TableCell colSpan={8} className="text-muted-foreground text-right">
                    {fmtMoney(opening, sym)} ({t('customers.formula_opening', 'Opening')}) + {fmtMoney(totalIn, sym)} ({t('expenses.formula_owed', 'Owed')}) − {fmtMoney(totalOut, sym)} ({t('expenses.formula_given', 'Given')}) = <span className="font-semibold text-foreground">{fmtMoney(closing, sym)}</span>
                  </TableCell>
                </TableRow>
                <TableRow className="bg-primary/10 font-bold">
                  <TableCell colSpan={6}>{t('customers.closing_balance_row', 'Closing balance · {{label}}', { label: closing > 0 ? t('expenses.closing_owed', 'Owed to staff') : closing < 0 ? t('expenses.closing_advance', 'Advance given') : t('expenses.closing_settled', 'Settled') })}</TableCell>
                  <TableCell className={`text-right ${closing > 0 ? "text-destructive" : closing < 0 ? "text-success" : ""}`}>{fmtMoney(closing, sym)}</TableCell>
                  <TableCell className="no-print"></TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </Card>

      <AddPaymentDialog open={addPayOpen} onOpenChange={setAddPayOpen} party="expense_person" partyId={id} party_name={person?.name} defaultAmount={payDefault} />
      <EditPaymentDialog open={!!editPayment} onOpenChange={(o) => !o && setEditPayment(null)} payment={editPayment} />

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('sales.invoice_title', 'Invoice {{no}}', { no: view?.invoice_no })}</DialogTitle></DialogHeader>
          {view && <Receipt invoice={view} settings={settings} />}
          <div className="flex justify-end gap-2 no-print">
            <Button variant="outline" onClick={() => setView(null)}>{t('common.close', 'Close')}</Button>
            <Button onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-1" />{t('common.print', 'Print')}</Button>
          </div>
          <div className="text-xs text-muted-foreground">{view?.created_at && fmtDate(view.created_at)}</div>
        </DialogContent>
      </Dialog>
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
