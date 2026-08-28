import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Printer, Receipt as ReceiptIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney, fmtDate } from "@/lib/format";
import { Receipt, printReceipt } from "@/components/receipt";
import { rangeFor, type DatePreset } from "@/lib/date-presets";

export const Route = createFileRoute("/_authenticated/expense-persons/$id")({ component: Page });

function Page() {
  const { t } = useTranslation();
  const { id } = Route.useParams();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const categoryLabel = (c: string) => t(`expenses.category_${c}`, c.replace(/_/g, " "));

  const [preset, setPreset] = useState<DatePreset>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [view, setView] = useState<any>(null);

  const applyPreset = (k: DatePreset) => {
    setPreset(k);
    const r = rangeFor(k);
    setFrom(r.from);
    setTo(r.to);
  };

  const { data: person } = useQuery({
    queryKey: ["expense_person", id],
    queryFn: async () =>
      (await supabase.from("expense_persons").select("*").eq("id", id).maybeSingle()).data,
  });

  const { data: allExpenses = [] } = useQuery({
    queryKey: ["expense_person_ledger", id],
    queryFn: async () =>
      (await supabase.from("expenses")
        .select("id,expense_date,category,description,amount,method,sale_id,created_at")
        .eq("person_id", id)
        .order("expense_date", { ascending: true })
        .order("created_at", { ascending: true })
      ).data ?? [],
  });

  const filtered = useMemo(() => {
    return allExpenses.filter((e: any) => {
      if (from && e.expense_date < from) return false;
      if (to && e.expense_date > to) return false;
      return true;
    });
  }, [allExpenses, from, to]);

  const totalAll = allExpenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const totalPeriod = filtered.reduce((s: number, e: any) => s + Number(e.amount), 0);
  const opening = allExpenses
    .filter((e: any) => from && e.expense_date < from)
    .reduce((s: number, e: any) => s + Number(e.amount), 0);

  const openSale = async (saleId: string) => {
    const { data } = await supabase
      .from("sales").select("*, sale_items(*), customers(name,phone)")
      .eq("id", saleId).maybeSingle();
    setView(data);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm"><Link to="/expenses"><ArrowLeft className="h-4 w-4 mr-1" />{t('expenses.back', 'Back')}</Link></Button>
          <div>
            <h1 className="text-2xl font-semibold">{person?.name ?? t('expenses.person_fallback', 'Person')}</h1>
            <div className="text-xs text-muted-foreground">
              {person?.role ? t(`expenses.role_${person.role}`, person.role) : "—"} {person?.phone ? `· ${person.phone}` : ""}
            </div>
          </div>
        </div>
        <div className="flex items-end gap-2 no-print">
          <div className="w-40">
            <Label className="text-xs">{t('expenses.quick_range', 'Quick range')}</Label>
            <Select value={preset} onValueChange={(v) => applyPreset(v as DatePreset)}>
              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="this_week">This week</SelectItem>
                <SelectItem value="last_week">Last week</SelectItem>
                <SelectItem value="this_month">This month</SelectItem>
                <SelectItem value="last_month">Last month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">{t('customers.from_label', 'From')}</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom" as any); }} className="h-9" /></div>
          <div><Label className="text-xs">{t('customers.to_label', 'To')}</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom" as any); }} className="h-9" /></div>
          <Button variant="outline" size="sm" onClick={() => printReceipt()}><Printer className="h-4 w-4 mr-1" />{t('common.print', 'Print')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4"><div className="text-xs text-muted-foreground">{t('expenses.opening_before_range', 'Opening (before range)')}</div><div className="text-2xl font-semibold mt-1">{fmtMoney(opening, sym)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">{t('expenses.period_spent', 'Period spent')}</div><div className="text-2xl font-semibold mt-1 text-destructive">{fmtMoney(totalPeriod, sym)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">{t('expenses.all_time_total', 'All-time total')}</div><div className="text-2xl font-semibold mt-1">{fmtMoney(totalAll, sym)}</div></Card>
        <Card className="p-4"><div className="text-xs text-muted-foreground">{t('expenses.stat_entries', 'Entries')}</div><div className="text-2xl font-semibold mt-1">{filtered.length}</div></Card>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('sales.th_date', 'Date')}</TableHead>
            <TableHead>{t('pos.qa_category', 'Category')}</TableHead>
            <TableHead>{t('expenses.th_description', 'Description')}</TableHead>
            <TableHead>{t('sales.th_method', 'Method')}</TableHead>
            <TableHead className="text-right">{t('common.amount', 'Amount')}</TableHead>
            <TableHead className="text-right">{t('sales.th_invoice', 'Invoice')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {from && opening > 0 && (
              <TableRow className="bg-muted/50">
                <TableCell>{from}</TableCell>
                <TableCell colSpan={3} className="font-medium text-muted-foreground">{t('expenses.opening_balance_before', 'Opening balance (before {{date}})', { date: from })}</TableCell>
                <TableCell className="text-right font-semibold">{fmtMoney(opening, sym)}</TableCell>
                <TableCell></TableCell>
              </TableRow>
            )}
            {filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">{t('expenses.no_entries', 'No entries')}</TableCell></TableRow>
            )}
            {filtered.map((r: any) => (
              <TableRow key={r.id} className={r.sale_id ? "bg-red-50/40 dark:bg-red-950/10" : ""}>
                <TableCell>{r.expense_date}</TableCell>
                <TableCell><Badge variant="secondary" className="capitalize">{categoryLabel(r.category)}</Badge></TableCell>
                <TableCell className="max-w-[360px] truncate">{r.description ?? "—"}</TableCell>
                <TableCell className="text-xs uppercase text-muted-foreground">{String(t(`expenses.method_${r.method}`, r.method))}</TableCell>
                <TableCell className="text-right font-medium text-destructive">{fmtMoney(r.amount, sym)}</TableCell>
                <TableCell className="text-right">
                  {r.sale_id ? (
                    <Button size="sm" variant="ghost" onClick={() => openSale(r.sale_id)} title={t('sales.view_invoice', 'View invoice')}>
                      <ReceiptIcon className="h-3.5 w-3.5" />
                    </Button>
                  ) : "—"}
                </TableCell>
              </TableRow>
            ))}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell colSpan={4} className="text-right">{t('expenses.period_total', 'Period total')}</TableCell>
              <TableCell className="text-right">{fmtMoney(totalPeriod, sym)}</TableCell>
              <TableCell></TableCell>
            </TableRow>
            <TableRow className="bg-primary/10 font-bold">
              <TableCell colSpan={4} className="text-right">{t('expenses.closing_balance_formula', 'Closing balance (Opening + Period)')}</TableCell>
              <TableCell className="text-right">{fmtMoney(opening + totalPeriod, sym)}</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>

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
