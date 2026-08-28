import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, ShieldCheck, StickyNote, ListTodo,
  Printer, Ban, ClipboardCheck, Sunrise, Play, Trash2, CheckCircle2, PauseCircle,
  Target, AlertTriangle, TrendingUp, TrendingDown, CalendarDays, Zap, Sparkles,
  ShoppingCart, Package, Receipt, BarChart3, ClipboardList, Brain, CalendarClock,
  ChevronLeft, ChevronRight, Activity, Save, Handshake,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { PageHeader } from "@/components/ui/page-header";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/operations")({ component: Page });

const sb = supabase as any;

function Page() {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const [tab, setTab] = useState("morning");

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <PageHeader
        title={t('operations.page_title', 'Business Operations')}
        description={t('operations.page_desc', 'Daily cash operations, held bills, tasks & audit')}
        icon={<ClipboardCheck className="h-5 w-5" />}
      />


      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="morning"><Sunrise className="h-4 w-4 mr-1" />{t('operations.tab_owner', 'Owner')}</TabsTrigger>
          <TabsTrigger value="calendar"><CalendarDays className="h-4 w-4 mr-1" />{t('operations.tab_calendar', 'Calendar')}</TabsTrigger>
          <TabsTrigger value="cash"><Wallet className="h-4 w-4 mr-1" />{t('operations.tab_cash_drawer', 'Cash Drawer')}</TabsTrigger>
          <TabsTrigger value="held"><PauseCircle className="h-4 w-4 mr-1" />{t('operations.tab_held_bills', 'Held Bills')}</TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo className="h-4 w-4 mr-1" />{t('operations.tab_tasks', 'Tasks')}</TabsTrigger>
          <TabsTrigger value="notes"><StickyNote className="h-4 w-4 mr-1" />{t('operations.tab_notes', 'Notes')}</TabsTrigger>
          <TabsTrigger value="checklist"><ClipboardCheck className="h-4 w-4 mr-1" />{t('operations.tab_checklist', 'Checklist')}</TabsTrigger>
          <TabsTrigger value="reprints"><Printer className="h-4 w-4 mr-1" />{t('operations.tab_reprints', 'Reprints')}</TabsTrigger>
          <TabsTrigger value="voids"><Ban className="h-4 w-4 mr-1" />{t('operations.tab_voids', 'Voids')}</TabsTrigger>
          <TabsTrigger value="handover"><Handshake className="h-4 w-4 mr-1" />{t('operations.tab_handover', 'Handover')}</TabsTrigger>
        </TabsList>

        <TabsContent value="morning"><OwnerControlCenter settings={settings} /></TabsContent>
        <TabsContent value="calendar"><BusinessCalendar /></TabsContent>
        <TabsContent value="cash"><CashDrawer settings={settings} /></TabsContent>
        <TabsContent value="held"><HeldBills /></TabsContent>
        <TabsContent value="tasks"><TasksPanel /></TabsContent>
        <TabsContent value="notes"><NotesPanel /></TabsContent>
        <TabsContent value="checklist"><ChecklistPanel settings={settings} /></TabsContent>
        <TabsContent value="reprints"><ReprintsLog /></TabsContent>
        <TabsContent value="voids"><VoidsLog /></TabsContent>
        <TabsContent value="handover"><HandoverPanel /></TabsContent>

      </Tabs>
    </div>
  );
}


/* ---------------- QUICK ACTIONS ---------------- */
const QUICK_ACTIONS = [
  { label: "Open POS", key: "pos", to: "/pos", icon: ShoppingCart },
  { label: "New Purchase", key: "purchases", to: "/purchases", icon: ClipboardList },
  { label: "New Expense", key: "expenses", to: "/expenses", icon: Wallet },
  { label: "Products", key: "products", to: "/products", icon: Package },
  { label: "Stock Count", key: "stock-count", to: "/stock-count", icon: ClipboardCheck },
  { label: "Intelligence", key: "intelligence", to: "/intelligence", icon: Brain },
  { label: "Expiry", key: "expiry", to: "/expiry", icon: CalendarClock },
  { label: "Reports", key: "reports", to: "/reports", icon: BarChart3 },
];

function QuickActionsBar() {
  const { t } = useTranslation();
  return (
    <Card className="p-3">
      <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
        {QUICK_ACTIONS.map((a) => (
          <Link key={a.to} to={a.to as any} className="flex flex-col items-center gap-1 rounded-lg border p-3 hover:bg-accent transition-colors">
            <a.icon className="h-5 w-5" />
            <span className="text-xs text-center">{t(`operations.qa_${a.key}`, a.label)}</span>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- OWNER CONTROL CENTER ---------------- */
function OwnerControlCenter({ settings }: { settings: any }) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);

  const { data: morning, refetch: refetchMorning } = useQuery({
    queryKey: ["morning-dashboard"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("morning_dashboard");
      if (error) throw error;
      return data as any;
    },
  });
  const { data: today_sum, refetch: refetchToday } = useQuery({
    queryKey: ["daily-summary", today],
    queryFn: async () => {
      const { data, error } = await sb.rpc("daily_summary", { _date: today });
      if (error) throw error;
      return data as any;
    },
  });
  const { data: alerts } = useQuery({
    queryKey: ["owner-alerts"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("owner_alerts");
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const { data: recs } = useQuery({
    queryKey: ["owner-recommendations"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("owner_recommendations");
      if (error) throw error;
      return (data || {}) as any;
    },
  });
  const { data: timeline } = useQuery({
    queryKey: ["daily-timeline", today],
    queryFn: async () => {
      const { data, error } = await sb.rpc("daily_timeline", { _date: today });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const todaySum = today_sum || {};
  const y = morning || {};
  const targetSales = Number(settings?.ops_target_sales || 0);
  const targetProfit = Number(settings?.ops_target_profit || 0);
  const targetInvoices = Number(settings?.ops_target_invoices || 0);
  const yestSales = Number(y.yesterday_sales_total || 0);
  const todaySales = Number(todaySum.sales_total || 0);
  const salesTrend = yestSales === 0 ? 0 : ((todaySales - yestSales) / yestSales) * 100;
  const todayProfit = Number(todaySum.profit || 0);
  const yestProfit = Number(y.yesterday_profit || 0);
  const profitTrend = yestProfit === 0 ? 0 : ((todayProfit - yestProfit) / yestProfit) * 100;

  const refreshAll = () => { refetchMorning(); refetchToday(); };

  return (
    <div className="space-y-4">
      {/* Quick actions */}
      <QuickActionsBar />

      {/* Health cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HealthCard status={todaySales > 0 ? "ok" : "info"} title={t('operations.health_todays_sales', "Today's sales")} value={fmtMoney(todaySales)} sub={t('operations.health_receipts_sub', '{{count}} receipts', { count: todaySum.sales_count || 0 })} />
        <HealthCard status={todayProfit >= 0 ? "ok" : "danger"} title={t('operations.health_todays_profit', "Today's profit")} value={fmtMoney(todayProfit)} sub={profitTrend !== 0 ? t('operations.health_profit_trend_sub', '{{arrow}} {{pct}}% vs yesterday', { arrow: profitTrend > 0 ? "▲" : "▼", pct: Math.abs(profitTrend).toFixed(1) }) : undefined} />
        <HealthCard status={salesTrend >= 0 ? "ok" : "warn"} title={t('operations.health_sales_trend', 'Sales trend')} value={`${salesTrend >= 0 ? "+" : ""}${salesTrend.toFixed(1)}%`} sub={t('operations.vs_yesterday', 'vs yesterday')} />
        <HealthCard status={(y.low_stock_products || 0) > 0 ? "warn" : "ok"} title={t('operations.health_low_stock', 'Low stock')} value={y.low_stock_products || 0} sub={t('operations.products_word', 'products')} />
      </div>

      {/* Daily targets */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold flex items-center gap-2"><Target className="h-4 w-4" />{t('operations.daily_targets', 'Daily targets')}</h3>
          <TargetEditor settings={settings} />
        </div>
        <TargetBar label={t('operations.target_sales', 'Sales')} value={todaySales} target={targetSales} formatValue={fmtMoney} />
        <TargetBar label={t('operations.target_profit', 'Profit')} value={todayProfit} target={targetProfit} formatValue={fmtMoney} />
        <TargetBar label={t('operations.target_invoices', 'Invoices')} value={Number(todaySum.sales_count || 0)} target={targetInvoices} formatValue={(v) => String(v)} />
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Alerts */}
        <Card className="p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><AlertTriangle className="h-4 w-4" />{t('operations.alert_center', 'Alert center')}</h3>
          <div className="space-y-2">
            {(alerts || []).filter((a: any) => a.severity !== "ok").map((a: any) => (
              <Link key={a.key} to={a.route as any} className="flex items-center justify-between border rounded-lg p-2 hover:bg-accent transition-colors">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${a.severity === "danger" ? "bg-red-500" : a.severity === "warn" ? "bg-amber-500" : "bg-blue-500"}`} />
                  <span className="text-sm font-medium">{a.title}</span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {a.count !== undefined && a.count !== null ? `${a.count}` : ""}
                  {a.amount ? ` · ${fmtMoney(a.amount)}` : ""}
                </div>
              </Link>
            ))}
            {(alerts || []).every((a: any) => a.severity === "ok") && (
              <div className="text-sm text-emerald-600 flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />{t('operations.all_clear', 'All clear')}</div>
            )}
          </div>
        </Card>

        {/* Recommendations */}
        <Card className="p-4">
          <h3 className="font-semibold flex items-center gap-2 mb-3"><Sparkles className="h-4 w-4" />{t('operations.owner_action_center', 'Owner action center')}</h3>
          <div className="space-y-2 max-h-[280px] overflow-y-auto">
            {["reorder", "expiry", "suppliers", "stock_counts", "cash_diff"].flatMap((k) => (recs?.[k] || []).map((r: any, i: number) => ({ ...r, _k: `${k}-${i}` }))).slice(0, 12).map((r: any) => (
              <div key={r._k} className="flex items-start justify-between border rounded-lg p-2 gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{r.detail}</div>
                </div>
                <Badge variant={r.priority === "high" ? "destructive" : "outline"} className="shrink-0">{t(`operations.priority_${r.priority}`, r.priority)}</Badge>
              </div>
            ))}
            {!Object.values(recs || {}).some((v: any) => Array.isArray(v) && v.length > 0) && (
              <div className="text-sm text-muted-foreground">{t('operations.no_recommendations', 'No recommendations right now')}</div>
            )}
          </div>
        </Card>
      </div>

      {/* Timeline */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold flex items-center gap-2"><Activity className="h-4 w-4" />{t('operations.todays_timeline', "Today's timeline")}</h3>
          <Button size="sm" variant="outline" onClick={refreshAll}>{t('operations.refresh_btn', 'Refresh')}</Button>
        </div>
        <TimelineList events={timeline || []} />
      </Card>
    </div>
  );
}

function HealthCard({ status, title, value, sub }: { status: "ok" | "warn" | "danger" | "info"; title: string; value: any; sub?: string }) {
  const cls = {
    ok: "border-emerald-500/30 bg-emerald-500/5",
    warn: "border-amber-500/30 bg-amber-500/5",
    danger: "border-red-500/30 bg-red-500/5",
    info: "border-blue-500/30 bg-blue-500/5",
  }[status];
  const dot = { ok: "bg-emerald-500", warn: "bg-amber-500", danger: "bg-red-500", info: "bg-blue-500" }[status];
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {title}
      </div>
      <div className="text-xl font-bold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function TargetBar({ label, value, target, formatValue }: { label: string; value: number; target: number; formatValue: (v: number) => string }) {
  const { t } = useTranslation();
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {formatValue(value)} {target > 0 && <>/ {formatValue(target)} · {pct.toFixed(0)}%</>}
        </span>
      </div>
      <div className="h-2 rounded-full bg-muted overflow-hidden">
        <div className={`h-full ${pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-blue-500" : "bg-amber-500"} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {target === 0 && <div className="text-xs text-muted-foreground">{t('operations.no_target_set', 'No target set')}</div>}
    </div>
  );
}

function TargetEditor({ settings }: { settings: any }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [sales, setSales] = useState(String(settings?.ops_target_sales || ""));
  const [profit, setProfit] = useState(String(settings?.ops_target_profit || ""));
  const [invoices, setInvoices] = useState(String(settings?.ops_target_invoices || ""));

  const save = async () => {
    const { error } = await sb.from("store_settings").update({
      ops_target_sales: Number(sales) || 0,
      ops_target_profit: Number(profit) || 0,
      ops_target_invoices: Number(invoices) || 0,
    }).eq("id", settings?.id);
    if (error) return toast.error(error.message);
    toast.success(t('operations.toast_targets_saved', 'Targets saved'));
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["store_settings"] });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline"><Save className="h-3 w-3 mr-1" />{t('operations.set_targets_btn', 'Set targets')}</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{t('operations.daily_targets_dialog_title', 'Daily targets')}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label>{t('operations.sales_target_label', 'Sales target')}</Label><Input type="number" value={sales} onChange={(e) => setSales(e.target.value)} /></div>
          <div className="space-y-1"><Label>{t('operations.profit_target_label', 'Profit target')}</Label><Input type="number" value={profit} onChange={(e) => setProfit(e.target.value)} /></div>
          <div className="space-y-1"><Label>{t('operations.invoice_target_label', 'Invoice count target')}</Label><Input type="number" value={invoices} onChange={(e) => setInvoices(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={save}>{t('common.save', 'Save')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const KIND_META: Record<string, { color: string; icon: any; label: string }> = {
  shift_open: { color: "text-emerald-600", icon: Play, label: "Shift opened" },
  shift_close: { color: "text-amber-600", icon: PauseCircle, label: "Shift closed" },
  sale: { color: "text-blue-600", icon: Receipt, label: "Sale" },
  sale_return: { color: "text-orange-600", icon: ArrowUpCircle, label: "Sale return" },
  purchase: { color: "text-purple-600", icon: ClipboardList, label: "Purchase" },
  expense: { color: "text-red-600", icon: Wallet, label: "Expense" },
  cash_paid_in: { color: "text-emerald-600", icon: ArrowDownCircle, label: "Paid in" },
  cash_paid_out: { color: "text-red-600", icon: ArrowUpCircle, label: "Paid out" },
  cash_safe_drop: { color: "text-indigo-600", icon: ShieldCheck, label: "Safe drop" },
  cash_float_add: { color: "text-emerald-600", icon: ArrowDownCircle, label: "Float add" },
  cash_float_remove: { color: "text-red-600", icon: ArrowUpCircle, label: "Float remove" },
  void: { color: "text-red-600", icon: Ban, label: "Void" },
  reprint: { color: "text-slate-600", icon: Printer, label: "Reprint" },
  note: { color: "text-slate-600", icon: StickyNote, label: "Note" },
};

function TimelineList({ events }: { events: any[] }) {
  const { t } = useTranslation();
  const [limit, setLimit] = useState(30);
  const visible = events.slice(0, limit);
  if (!events.length) return <div className="text-sm text-muted-foreground">{t('operations.no_activity_today', 'No activity yet today')}</div>;
  return (
    <div className="space-y-2">
      {visible.map((e, i) => {
        const meta = KIND_META[e.kind] || { color: "text-muted-foreground", icon: Activity, label: e.kind };
        const Icon = meta.icon;
        return (
          <div key={i} className="flex items-start gap-3 border-l-2 border-muted pl-3 py-1">
            <Icon className={`h-4 w-4 mt-0.5 ${meta.color}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium truncate">{e.title || t(`operations.kind_${e.kind}`, meta.label)}</div>
                <div className="text-xs text-muted-foreground whitespace-nowrap">{new Date(e.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
              </div>
              {e.detail && <div className="text-xs text-muted-foreground truncate">{e.detail}</div>}
            </div>
            {e.amount != null && <div className="text-sm font-mono">{fmtMoney(Number(e.amount))}</div>}
          </div>
        );
      })}
      {events.length > limit && (
        <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimit((l) => l + 30)}>
          {t('operations.load_more', 'Load more ({{count}} left)', { count: events.length - limit })}
        </Button>
      )}
    </div>
  );
}

/* ---------------- BUSINESS CALENDAR ---------------- */
function BusinessCalendar() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(() => {
    const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const days = useMemo(() => {
    const first = new Date(month);
    const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const pad = first.getDay();
    const arr: (string | null)[] = Array(pad).fill(null);
    for (let i = 1; i <= last.getDate(); i++) {
      const d = new Date(month.getFullYear(), month.getMonth(), i);
      arr.push(d.toISOString().slice(0, 10));
    }
    return arr;
  }, [month]);

  const { data: summary } = useQuery({
    queryKey: ["daily-summary", selected],
    queryFn: async () => {
      const { data, error } = await sb.rpc("daily_summary", { _date: selected });
      if (error) throw error;
      return data as any;
    },
  });
  const { data: timeline } = useQuery({
    queryKey: ["daily-timeline", selected],
    queryFn: async () => {
      const { data, error } = await sb.rpc("daily_timeline", { _date: selected });
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const s = summary || {};
  const monthLabel = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Button size="icon" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
          <div className="font-semibold">{monthLabel}</div>
          <Button size="icon" variant="ghost" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground mb-1">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <div key={i}>{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {days.map((d, i) => d === null ? <div key={i} /> : (
            <button
              key={d}
              onClick={() => setSelected(d)}
              className={`aspect-square rounded-md text-sm border transition-colors
                ${selected === d ? "bg-primary text-primary-foreground border-primary" : "hover:bg-accent"}
                ${d === today && selected !== d ? "border-blue-500" : ""}`}
            >
              {Number(d.slice(-2))}
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="font-semibold">{new Date(selected + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric", year: "numeric" })}</div>
        <div className="grid grid-cols-2 gap-2 text-sm">
          <Stat label={t('operations.target_sales', 'Sales')} value={fmtMoney(s.sales_total || 0)} sub={t('operations.health_receipts_sub', '{{count}} receipts', { count: s.sales_count || 0 })} />
          <Stat label={t('operations.target_profit', 'Profit')} value={fmtMoney(s.profit || 0)} />
          <Stat label={t('operations.stat_purchases', 'Purchases')} value={fmtMoney(s.purchases_total || 0)} sub={`${s.purchases_count || 0}`} />
          <Stat label={t('operations.stat_expenses', 'Expenses')} value={fmtMoney(s.expenses_total || 0)} sub={`${s.expenses_count || 0}`} />
          <Stat label={t('operations.stat_returns', 'Returns')} value={fmtMoney(s.returns_total || 0)} sub={`${s.returns_count || 0}`} />
          <Stat label={t('operations.stat_cash_difference', 'Cash difference')} value={fmtMoney(s.cash_difference || 0)} sub={t('operations.shifts_sub', '{{count}} shifts', { count: s.shifts_count || 0 })} />
          <Stat label={t('operations.stat_notes', 'Notes')} value={s.notes_count || 0} />
          <Stat label={t('operations.stat_tasks_created', 'Tasks created')} value={s.tasks_count || 0} />
        </div>
        <div>
          <div className="text-sm font-semibold mt-2 mb-1">{t('operations.activity_label', 'Activity')}</div>
          <div className="max-h-[300px] overflow-y-auto">
            <TimelineList events={timeline || []} />
          </div>
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return (
    <div className="rounded-lg border p-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}


/* ---------------- CASH DRAWER ---------------- */
function CashDrawer({ settings }: { settings: any }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [type, setType] = useState("paid_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const { data: events } = useQuery({
    queryKey: ["cash-events"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => sb
        .from("cash_drawer_events")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return data as any[];
    },
  });

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error(t('operations.toast_enter_valid_amount', 'Enter a valid amount'));
    if (type === "safe_drop" && settings?.ops_safe_drop_threshold > 0 && amt < settings.ops_safe_drop_threshold) {
      if (!confirm(t('operations.confirm_safe_drop_below', 'Safe drop below threshold ({{amount}}). Continue?', { amount: fmtMoney(settings.ops_safe_drop_threshold) }))) return;
    }
    const { error } = await sb.rpc("record_cash_event", {
      _type: type, _amount: amt, _reason: reason || null, _reference: reference || null,
    });
    if (error) return toast.error(error.message);
    toast.success(t('operations.toast_recorded', 'Recorded'));
    setAmount(""); setReason(""); setReference("");
    qc.invalidateQueries({ queryKey: ["cash-events"] });
  };

  const labels: Record<string, string> = {
    paid_in: t('operations.label_paid_in', 'Paid In'), paid_out: t('operations.label_paid_out', 'Paid Out'), safe_drop: t('operations.label_safe_drop', 'Safe Drop'),
    float_add: t('operations.label_float_add', 'Float Add'), float_remove: t('operations.label_float_remove', 'Float Remove'),
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4" />{t('operations.record_event', 'Record event')}</h3>
        <div className="space-y-2">
          <Label>{t('operations.type_label', 'Type')}</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="paid_in">{t('operations.type_paid_in', 'Paid In (cash added)')}</SelectItem>
              <SelectItem value="paid_out">{t('operations.type_paid_out', 'Paid Out (cash removed)')}</SelectItem>
              <SelectItem value="safe_drop">{t('operations.type_safe_drop', 'Safe Drop (to safe)')}</SelectItem>
              <SelectItem value="float_add">{t('operations.type_float_add', 'Float Add')}</SelectItem>
              <SelectItem value="float_remove">{t('operations.type_float_remove', 'Float Remove')}</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>{t('common.amount', 'Amount')}</Label>
          <Input type="number" step="0.01" value={amount || ""} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>{t('expiry.field_reason', 'Reason')}</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('operations.reason_placeholder', 'e.g. Utility bill')} />
        </div>
        <div className="space-y-2">
          <Label>{t('operations.reference_label', 'Reference')}</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t('operations.reference_placeholder', 'Optional receipt / voucher no.')} />
        </div>
        <Button onClick={submit} className="w-full">{t('expiry.record_btn', 'Record')}</Button>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">{t('operations.recent_events', 'Recent events')}</h3>
        <div className="space-y-2 max-h-[500px] overflow-y-auto">
          {(events || []).map((e: any) => (
            <div key={e.id} className="flex items-center justify-between border rounded-lg p-2 text-sm">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {["paid_in", "float_add"].includes(e.event_type) ? <ArrowDownCircle className="h-4 w-4 text-emerald-500" /> : <ArrowUpCircle className="h-4 w-4 text-red-500" />}
                  {labels[e.event_type] || e.event_type}
                </div>
                <div className="text-xs text-muted-foreground">{e.reason || "—"} · {new Date(e.created_at).toLocaleString()}</div>
              </div>
              <div className="font-mono">{fmtMoney(e.amount)}</div>
            </div>
          ))}
          {!events?.length && <div className="text-sm text-muted-foreground">{t('operations.no_events_yet', 'No events yet')}</div>}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- HELD BILLS ---------------- */
function HeldBills() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["held-bills"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("held_bills")
        .select("*, customers(name)")
        .eq("status", "held")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const discard = async (id: string) => {
    if (!confirm(t('operations.confirm_discard', 'Discard this held bill?'))) return;
    const { error } = await sb.rpc("discard_held_bill", { _id: id, _reason: null });
    if (error) return toast.error(error.message);
    toast.success(t('operations.toast_discarded', 'Discarded'));
    qc.invalidateQueries({ queryKey: ["held-bills"] });
  };

  const resume = async (id: string) => {
    // Store payload in localStorage so POS can pick up
    const { data, error } = await sb.rpc("resume_bill", { _id: id });
    if (error) return toast.error(error.message);
    try {
      localStorage.setItem("pos:resume_payload", JSON.stringify(data));
      toast.success(t('operations.toast_resumed', 'Resumed — open POS to continue'));
      window.location.href = "/pos";
    } catch {
      toast.error(t('operations.toast_could_not_load', 'Could not load bill'));
    }
  };

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">{t('operations.held_bills_title', 'Held bills')}</h3>
      <div className="space-y-2">
        {(data || []).map((b: any) => (
          <div key={b.id} className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <div className="font-medium">{b.label || t('operations.untitled', 'Untitled')} <Badge variant="outline" className="ml-2">{t('operations.items_suffix', '{{count}} items', { count: b.item_count })}</Badge></div>
              <div className="text-xs text-muted-foreground">
                {b.customers?.name || t('common.walk_in', 'Walk-in')} · {new Date(b.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="font-mono">{fmtMoney(b.total)}</div>
              <Button size="sm" onClick={() => resume(b.id)}><Play className="h-3 w-3 mr-1" />{t('operations.resume_btn', 'Resume')}</Button>
              <Button size="sm" variant="ghost" onClick={() => discard(b.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">{t('operations.no_held_bills', 'No held bills')}</div>}
      </div>
    </Card>
  );
}

/* ---------------- TASKS ---------------- */
function TasksPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");

  const { data } = useQuery({
    queryKey: ["shift-tasks"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => sb
        .from("shift_tasks")
        .select("*")
        .order("status", { ascending: true })
        .order("created_at", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return data as any[];
    },
  });

  const add = async () => {
    if (!title.trim()) return;
    const { error } = await sb.from("shift_tasks").insert({
      title, priority, created_by: user!.id, tenant_id: undefined,
    } as any);
    // tenant_id auto via trigger? — fetch via current_tenant_id: we need to pass explicitly
    if (error && String(error.message).includes("tenant_id")) {
      const { data: tid } = await sb.rpc("current_tenant_id" as any);
      if (tid) {
        await sb.from("shift_tasks").insert({ title, priority, created_by: user!.id, tenant_id: tid } as any);
      }
    } else if (error) {
      return toast.error(error.message);
    }
    setTitle("");
    qc.invalidateQueries({ queryKey: ["shift-tasks"] });
  };

  const setStatus = async (id: string, status: string) => {
    const patch: any = { status };
    if (status === "done") { patch.completed_at = new Date().toISOString(); patch.completed_by = user!.id; }
    await sb.from("shift_tasks").update(patch).eq("id", id);
    qc.invalidateQueries({ queryKey: ["shift-tasks"] });
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="flex gap-2">
        <Input placeholder={t('operations.new_task_placeholder', 'New task...')} value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">{t('operations.priority_low', 'Low')}</SelectItem>
            <SelectItem value="normal">{t('operations.priority_normal', 'Normal')}</SelectItem>
            <SelectItem value="high">{t('operations.priority_high', 'High')}</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={add}>{t('operations.add_btn', 'Add')}</Button>
      </div>
      <div className="space-y-2">
        {(data || []).map((task: any) => (
          <div key={task.id} className="flex items-center justify-between border rounded-lg p-3">
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={task.status === "done"} onChange={(e) => setStatus(task.id, e.target.checked ? "done" : "open")} />
              <div>
                <div className={`font-medium ${task.status === "done" ? "line-through text-muted-foreground" : ""}`}>{task.title}</div>
                <div className="text-xs text-muted-foreground">{t(`operations.priority_${task.priority}`, task.priority)} · {new Date(task.created_at).toLocaleDateString()}</div>
              </div>
            </div>
            <Badge variant={task.status === "done" ? "secondary" : "outline"}>{t(`operations.task_status_${task.status}`, task.status)}</Badge>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">{t('operations.no_tasks', 'No tasks')}</div>}
      </div>
    </Card>
  );
}

/* ---------------- NOTES ---------------- */
function NotesPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("general");

  const { data } = useQuery({
    queryKey: ["shift-notes"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => sb
        .from("shift_notes")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return data as any[];
    },
  });

  const add = async () => {
    if (!note.trim()) return;
    const { data: tid } = await sb.rpc("current_tenant_id" as any);
    const { error } = await sb.from("shift_notes").insert({
      note, category, user_id: user!.id, tenant_id: tid,
    } as any);
    if (error) return toast.error(error.message);
    setNote("");
    qc.invalidateQueries({ queryKey: ["shift-notes"] });
  };

  return (
    <Card className="p-4 space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="general">{t('operations.category_general', 'General')}</SelectItem>
              <SelectItem value="incident">{t('operations.category_incident', 'Incident')}</SelectItem>
              <SelectItem value="handover">{t('operations.category_handover', 'Handover')}</SelectItem>
              <SelectItem value="customer">{t('operations.category_customer', 'Customer')}</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={add}>{t('operations.save_note_btn', 'Save note')}</Button>
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('operations.note_placeholder', 'Write a note...')} rows={3} />
      </div>
      <div className="space-y-2">
        {(data || []).map((n: any) => (
          <div key={n.id} className="border rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <Badge variant="outline">{t(`operations.category_${n.category}`, n.category)}</Badge>
              <span>{new Date(n.created_at).toLocaleString()}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{n.note}</div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">{t('operations.no_notes', 'No notes')}</div>}
      </div>
    </Card>
  );
}

/* ---------------- CHECKLIST ---------------- */
function ChecklistPanel({ settings }: { settings: any }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const items: string[] = settings?.ops_checklist_items || [
    t('operations.checklist_default_1', 'Cash counted'),
    t('operations.checklist_default_2', 'Safe drop done'),
    t('operations.checklist_default_3', 'Cleaning done'),
    t('operations.checklist_default_4', 'Doors locked'),
  ];

  const { data: shift } = useQuery({
    queryKey: ["current-shift"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("current_shift" as any);
      if (error) return null;
      return data as any;
    },
  });

  const shiftId = shift?.id || shift?.[0]?.id;

  const { data: existing } = useQuery({
    queryKey: ["checklist", shiftId],
    enabled: !!shiftId,
    queryFn: async () => {
      const { data, error } = await sb.from("shift_checklist").select("*").eq("shift_id", shiftId);
      if (error) throw error;
      return data as any[];
    },
  });

  const toggle = async (key: string, label: string, completed: boolean) => {
    if (!shiftId) return toast.error(t('operations.toast_open_shift_first', 'Open a shift first'));
    const { error } = await sb.rpc("set_checklist_item", {
      _shift_id: shiftId, _key: key, _label: label, _completed: completed, _note: null,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["checklist", shiftId] });
  };

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">{t('operations.closing_checklist', 'Closing checklist')}</h3>
      {!shiftId && <div className="text-sm text-muted-foreground mb-3">{t('operations.open_shift_hint', "Open a shift to track today's checklist.")}</div>}
      <div className="space-y-2">
        {items.map((label, i) => {
          const key = `item_${i}`;
          const done = (existing || []).find((x: any) => x.item_key === key)?.completed;
          return (
            <label key={key} className="flex items-center gap-3 border rounded-lg p-3 cursor-pointer">
              <input type="checkbox" checked={!!done} onChange={(e) => toggle(key, label, e.target.checked)} disabled={!shiftId} />
              <span className={done ? "line-through text-muted-foreground" : ""}>{label}</span>
              {done && <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />}
            </label>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------- REPRINTS LOG ---------------- */
function ReprintsLog() {
  const { t } = useTranslation();
  const { data } = useQuery({
    queryKey: ["reprints"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => sb
        .from("receipt_reprints")
        .select("*, sales(invoice_no,total)")
        .order("created_at", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return data as any[];
    },
  });
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">{t('operations.receipt_reprint_audit', 'Receipt reprint audit')}</h3>
      <div className="space-y-2">
        {(data || []).map((r: any) => (
          <div key={r.id} className="flex items-center justify-between border rounded-lg p-3 text-sm">
            <div>
              <div className="font-medium">{t('operations.invoice_prefix', 'Invoice {{no}}', { no: r.sales?.invoice_no || r.sale_id.slice(0, 8) })}</div>
              <div className="text-xs text-muted-foreground">{r.reason || "—"} · {new Date(r.created_at).toLocaleString()}</div>
            </div>
            <div className="font-mono">{fmtMoney(r.sales?.total || 0)}</div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">{t('operations.no_reprints_logged', 'No reprints logged')}</div>}
      </div>
    </Card>
  );
}

/* ---------------- VOIDS LOG ---------------- */
function VoidsLog() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [invoice, setInvoice] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["voids"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => sb
        .from("sale_voids")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return data as any[];
    },
  });

  const voidSale = async () => {
    if (!invoice.trim() || !reason.trim()) return toast.error(t('operations.toast_invoice_reason_required', 'Invoice and reason required'));
    const { data: s, error: e1 } = await sb.from("sales").select("id").eq("invoice_no", invoice.trim()).maybeSingle();
    if (e1 || !s) return toast.error(t('operations.toast_invoice_not_found', 'Invoice not found'));
    const { error } = await sb.rpc("void_sale", { _sale_id: s.id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success(t('operations.toast_sale_voided', 'Sale voided'));
    setOpen(false); setInvoice(""); setReason("");
    qc.invalidateQueries({ queryKey: ["voids"] });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">{t('operations.voided_sales', 'Voided sales')}</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive"><Ban className="h-3 w-3 mr-1" />{t('operations.void_a_sale_btn', 'Void a sale')}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>{t('operations.void_dialog_title', 'Void a sale (admin only)')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>{t('operations.invoice_number_label', 'Invoice number')}</Label>
                <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('operations.reason_required_label', 'Reason (required)')}</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button variant="destructive" onClick={voidSale}>{t('operations.void_btn', 'Void')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(data || []).map((v: any) => (
          <div key={v.id} className="border rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium">{t('operations.invoice_prefix', 'Invoice {{no}}', { no: v.invoice_no || v.sale_id.slice(0, 8) })}</div>
              <div className="font-mono">{fmtMoney(v.original_total)}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">{t('operations.reason_prefix', 'Reason: {{reason}}', { reason: v.reason })} · {new Date(v.created_at).toLocaleString()}</div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">{t('operations.no_voided_sales', 'No voided sales')}</div>}
      </div>
    </Card>
  );
}

/* ---------------- MANAGER HANDOVER ---------------- */
function HandoverPanel() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [cash, setCash] = useState("");
  const [notes, setNotes] = useState("");
  const [toUser, setToUser] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const { data: staff = [] } = useQuery({
    queryKey: ["staff-lite"],
    queryFn: async () => {
      const { data } = await sb.from("tenant_members").select("user_id");
      return (data || []) as any[];
    },
  });

  const { data: currentShift } = useQuery({
    queryKey: ["current-shift"],
    queryFn: async () => {
      const { data } = await sb.rpc("current_shift" as any);
      return data as any;
    },
  });

  const { data: handovers = [], refetch } = useQuery({
    queryKey: ["manager-handovers"],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((from: number, to: number) => sb
        .from("manager_handovers")
        .select("*")
        .order("created_at", { ascending: false })
        .range(from, to) as any), error: null as any };
      if (error) throw error;
      return data as any[];
    },
  });

  const submit = async () => {
    if (!user) return;
    const amt = Number(cash || 0);
    if (isNaN(amt) || amt < 0) return toast.error(t('operations.toast_enter_valid_cash', 'Enter a valid cash amount'));
    setSaving(true);
    const { data: tid } = await sb.rpc("current_tenant_id" as any);
    const shiftId = currentShift?.id || currentShift?.[0]?.id || null;
    const { error } = await sb.from("manager_handovers").insert({
      tenant_id: tid,
      from_user: user.id,
      to_user: toUser || null,
      from_shift_id: shiftId,
      cash_amount: amt,
      notes: notes.trim() || null,
    } as any);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('operations.toast_handover_recorded', 'Handover recorded'));
    setCash(""); setNotes(""); setToUser("");
    qc.invalidateQueries({ queryKey: ["manager-handovers"] });
  };

  const acknowledge = async (id: string) => {
    const { error } = await sb
      .from("manager_handovers")
      .update({ acknowledged_at: new Date().toISOString(), to_user: user?.id })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(t('operations.toast_acknowledged', 'Acknowledged'));
    refetch();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Handshake className="h-5 w-5 text-primary" />
          <div>
            <div className="font-semibold">{t('operations.record_handover', 'Record handover')}</div>
            <div className="text-xs text-muted-foreground">{t('operations.record_handover_desc', 'Pass cash & context to the next manager/cashier')}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label>{t('operations.cash_handed_over_label', 'Cash handed over')}</Label>
            <Input type="number" step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} placeholder="0.00" />
          </div>
          <div>
            <Label>{t('operations.handing_to_label', 'Handing to')}</Label>
            <Select value={toUser} onValueChange={setToUser}>
              <SelectTrigger><SelectValue placeholder={t('operations.select_staff_placeholder', 'Select staff (optional)')} /></SelectTrigger>
              <SelectContent>
                {staff.filter((s: any) => s.user_id !== user?.id).map((s: any) => (
                  <SelectItem key={s.user_id} value={s.user_id}>{s.user_id.slice(0, 8)}…</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div>
          <Label>{t('operations.notes_context_label', 'Notes / context')}</Label>
          <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('operations.notes_context_placeholder', 'Pending tasks, incidents, customer follow-ups…')} />
        </div>
        <Button onClick={submit} disabled={saving} className="w-full">
          <Save className="h-4 w-4 mr-2" />{saving ? t('operations.saving', 'Saving…') : t('operations.record_handover_btn', 'Record handover')}
        </Button>
      </Card>

      <Card className="p-4 space-y-2">
        <div className="font-semibold mb-2">{t('operations.recent_handovers', 'Recent handovers')}</div>
        {!handovers.length && <div className="text-sm text-muted-foreground">{t('operations.no_handovers_yet', 'No handovers yet')}</div>}
        <div className="space-y-2 max-h-[520px] overflow-auto">
          {handovers.map((h: any) => (
            <div key={h.id} className="border rounded-lg p-3">
              <div className="flex items-center justify-between text-sm">
                <div className="font-medium flex items-center gap-2">
                  <Wallet className="h-4 w-4 text-muted-foreground" />
                  {fmtMoney(h.cash_amount)}
                </div>
                {h.acknowledged_at ? (
                  <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" />{t('operations.acknowledged_badge', 'Acknowledged')}</Badge>
                ) : h.to_user === user?.id ? (
                  <Button size="sm" variant="outline" onClick={() => acknowledge(h.id)}>{t('operations.acknowledge_btn', 'Acknowledge')}</Button>
                ) : (
                  <Badge variant="secondary">{t('operations.pending_badge', 'Pending')}</Badge>
                )}
              </div>
              {h.notes && <div className="text-sm mt-2 whitespace-pre-wrap">{h.notes}</div>}
              <div className="text-xs text-muted-foreground mt-2">
                {t('operations.from_to_line', 'From {{from}} → {{to}} · {{date}}', { from: `${String(h.from_user).slice(0, 8)}…`, to: h.to_user ? String(h.to_user).slice(0, 8) + "…" : t('operations.anyone_word', 'anyone'), date: new Date(h.created_at).toLocaleString() })}
                {h.acknowledged_at && t('operations.ack_suffix', ' · ack {{date}}', { date: new Date(h.acknowledged_at).toLocaleString() })}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

