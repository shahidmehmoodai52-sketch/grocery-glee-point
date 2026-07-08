import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Wallet, ArrowDownCircle, ArrowUpCircle, ShieldCheck, StickyNote, ListTodo,
  Printer, Ban, ClipboardCheck, Sunrise, Play, Trash2, CheckCircle2, PauseCircle,
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

export const Route = createFileRoute("/_authenticated/operations")({ component: Page });

const sb = supabase as any;

function Page() {
  const { data: settings } = useSettings();
  const [tab, setTab] = useState("morning");

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Business Operations</h1>
          <p className="text-sm text-muted-foreground">Daily cash operations, held bills, tasks & audit</p>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="morning"><Sunrise className="h-4 w-4 mr-1" />Morning</TabsTrigger>
          <TabsTrigger value="cash"><Wallet className="h-4 w-4 mr-1" />Cash Drawer</TabsTrigger>
          <TabsTrigger value="held"><PauseCircle className="h-4 w-4 mr-1" />Held Bills</TabsTrigger>
          <TabsTrigger value="tasks"><ListTodo className="h-4 w-4 mr-1" />Tasks</TabsTrigger>
          <TabsTrigger value="notes"><StickyNote className="h-4 w-4 mr-1" />Notes</TabsTrigger>
          <TabsTrigger value="checklist"><ClipboardCheck className="h-4 w-4 mr-1" />Checklist</TabsTrigger>
          <TabsTrigger value="reprints"><Printer className="h-4 w-4 mr-1" />Reprints</TabsTrigger>
          <TabsTrigger value="voids"><Ban className="h-4 w-4 mr-1" />Voids</TabsTrigger>
        </TabsList>

        <TabsContent value="morning"><MorningDashboard /></TabsContent>
        <TabsContent value="cash"><CashDrawer settings={settings} /></TabsContent>
        <TabsContent value="held"><HeldBills /></TabsContent>
        <TabsContent value="tasks"><TasksPanel /></TabsContent>
        <TabsContent value="notes"><NotesPanel /></TabsContent>
        <TabsContent value="checklist"><ChecklistPanel settings={settings} /></TabsContent>
        <TabsContent value="reprints"><ReprintsLog /></TabsContent>
        <TabsContent value="voids"><VoidsLog /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- MORNING DASHBOARD ---------------- */
function MorningDashboard() {
  const { data, refetch, isFetching } = useQuery({
    queryKey: ["morning-dashboard"],
    queryFn: async () => {
      const { data, error } = await sb.rpc("morning_dashboard");
      if (error) throw error;
      return data as any;
    },
  });
  const d = data || {};
  const stats = [
    { label: "Yesterday sales", value: fmtMoney(d.yesterday_sales_total || 0), sub: `${d.yesterday_sales_count || 0} receipts` },
    { label: "Yesterday profit", value: fmtMoney(d.yesterday_profit || 0) },
    { label: "Yesterday returns", value: fmtMoney(d.yesterday_returns_total || 0), sub: `${d.yesterday_returns || 0} returns` },
    { label: "Yesterday expenses", value: fmtMoney(d.yesterday_expenses || 0) },
    { label: "Held bills", value: d.held_bills || 0 },
    { label: "Open tasks", value: d.open_tasks || 0 },
    { label: "Low stock alerts", value: d.low_stock_products || 0 },
  ];
  return (
    <Card className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">A quick summary before you open shop</div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>Refresh</Button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{s.label}</div>
            <div className="text-lg font-semibold">{s.value}</div>
            {s.sub && <div className="text-xs text-muted-foreground">{s.sub}</div>}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- CASH DRAWER ---------------- */
function CashDrawer({ settings }: { settings: any }) {
  const qc = useQueryClient();
  const [type, setType] = useState("paid_in");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [reference, setReference] = useState("");

  const { data: events } = useQuery({
    queryKey: ["cash-events"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("cash_drawer_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) return toast.error("Enter a valid amount");
    if (type === "safe_drop" && settings?.ops_safe_drop_threshold > 0 && amt < settings.ops_safe_drop_threshold) {
      if (!confirm(`Safe drop below threshold (${fmtMoney(settings.ops_safe_drop_threshold)}). Continue?`)) return;
    }
    const { error } = await sb.rpc("record_cash_event", {
      _type: type, _amount: amt, _reason: reason || null, _reference: reference || null,
    });
    if (error) return toast.error(error.message);
    toast.success("Recorded");
    setAmount(""); setReason(""); setReference("");
    qc.invalidateQueries({ queryKey: ["cash-events"] });
  };

  const labels: Record<string, string> = {
    paid_in: "Paid In", paid_out: "Paid Out", safe_drop: "Safe Drop",
    float_add: "Float Add", float_remove: "Float Remove",
  };

  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card className="p-4 space-y-3">
        <h3 className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4" />Record event</h3>
        <div className="space-y-2">
          <Label>Type</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="paid_in">Paid In (cash added)</SelectItem>
              <SelectItem value="paid_out">Paid Out (cash removed)</SelectItem>
              <SelectItem value="safe_drop">Safe Drop (to safe)</SelectItem>
              <SelectItem value="float_add">Float Add</SelectItem>
              <SelectItem value="float_remove">Float Remove</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Amount</Label>
          <Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label>Reason</Label>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Utility bill" />
        </div>
        <div className="space-y-2">
          <Label>Reference</Label>
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional receipt / voucher no." />
        </div>
        <Button onClick={submit} className="w-full">Record</Button>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Recent events</h3>
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
          {!events?.length && <div className="text-sm text-muted-foreground">No events yet</div>}
        </div>
      </Card>
    </div>
  );
}

/* ---------------- HELD BILLS ---------------- */
function HeldBills() {
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
    if (!confirm("Discard this held bill?")) return;
    const { error } = await sb.rpc("discard_held_bill", { _id: id, _reason: null });
    if (error) return toast.error(error.message);
    toast.success("Discarded");
    qc.invalidateQueries({ queryKey: ["held-bills"] });
  };

  const resume = async (id: string) => {
    // Store payload in localStorage so POS can pick up
    const { data, error } = await sb.rpc("resume_bill", { _id: id });
    if (error) return toast.error(error.message);
    try {
      localStorage.setItem("pos:resume_payload", JSON.stringify(data));
      toast.success("Resumed — open POS to continue");
      window.location.href = "/pos";
    } catch {
      toast.error("Could not load bill");
    }
  };

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Held bills</h3>
      <div className="space-y-2">
        {(data || []).map((b: any) => (
          <div key={b.id} className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <div className="font-medium">{b.label || "Untitled"} <Badge variant="outline" className="ml-2">{b.item_count} items</Badge></div>
              <div className="text-xs text-muted-foreground">
                {b.customers?.name || "Walk-in"} · {new Date(b.created_at).toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="font-mono">{fmtMoney(b.total)}</div>
              <Button size="sm" onClick={() => resume(b.id)}><Play className="h-3 w-3 mr-1" />Resume</Button>
              <Button size="sm" variant="ghost" onClick={() => discard(b.id)}><Trash2 className="h-3 w-3" /></Button>
            </div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">No held bills</div>}
      </div>
    </Card>
  );
}

/* ---------------- TASKS ---------------- */
function TasksPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");

  const { data } = useQuery({
    queryKey: ["shift-tasks"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("shift_tasks")
        .select("*")
        .order("status", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(100);
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
      const { data: t } = await sb.rpc("current_tenant_id" as any);
      if (t) {
        await sb.from("shift_tasks").insert({ title, priority, created_by: user!.id, tenant_id: t } as any);
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
        <Input placeholder="New task..." value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <Select value={priority} onValueChange={setPriority}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="high">High</SelectItem>
          </SelectContent>
        </Select>
        <Button onClick={add}>Add</Button>
      </div>
      <div className="space-y-2">
        {(data || []).map((t: any) => (
          <div key={t.id} className="flex items-center justify-between border rounded-lg p-3">
            <div className="flex items-center gap-3">
              <input type="checkbox" checked={t.status === "done"} onChange={(e) => setStatus(t.id, e.target.checked ? "done" : "open")} />
              <div>
                <div className={`font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</div>
                <div className="text-xs text-muted-foreground">{t.priority} · {new Date(t.created_at).toLocaleDateString()}</div>
              </div>
            </div>
            <Badge variant={t.status === "done" ? "secondary" : "outline"}>{t.status}</Badge>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">No tasks</div>}
      </div>
    </Card>
  );
}

/* ---------------- NOTES ---------------- */
function NotesPanel() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [note, setNote] = useState("");
  const [category, setCategory] = useState("general");

  const { data } = useQuery({
    queryKey: ["shift-notes"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("shift_notes")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as any[];
    },
  });

  const add = async () => {
    if (!note.trim()) return;
    const { data: t } = await sb.rpc("current_tenant_id" as any);
    const { error } = await sb.from("shift_notes").insert({
      note, category, user_id: user!.id, tenant_id: t,
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
              <SelectItem value="general">General</SelectItem>
              <SelectItem value="incident">Incident</SelectItem>
              <SelectItem value="handover">Handover</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={add}>Save note</Button>
        </div>
        <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Write a note..." rows={3} />
      </div>
      <div className="space-y-2">
        {(data || []).map((n: any) => (
          <div key={n.id} className="border rounded-lg p-3">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <Badge variant="outline">{n.category}</Badge>
              <span>{new Date(n.created_at).toLocaleString()}</span>
            </div>
            <div className="text-sm whitespace-pre-wrap">{n.note}</div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">No notes</div>}
      </div>
    </Card>
  );
}

/* ---------------- CHECKLIST ---------------- */
function ChecklistPanel({ settings }: { settings: any }) {
  const qc = useQueryClient();
  const items: string[] = settings?.ops_checklist_items || ["Cash counted", "Safe drop done", "Cleaning done", "Doors locked"];

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
    if (!shiftId) return toast.error("Open a shift first");
    const { error } = await sb.rpc("set_checklist_item", {
      _shift_id: shiftId, _key: key, _label: label, _completed: completed, _note: null,
    });
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["checklist", shiftId] });
  };

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Closing checklist</h3>
      {!shiftId && <div className="text-sm text-muted-foreground mb-3">Open a shift to track today's checklist.</div>}
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
  const { data } = useQuery({
    queryKey: ["reprints"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("receipt_reprints")
        .select("*, sales(invoice_no,total)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as any[];
    },
  });
  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3">Receipt reprint audit</h3>
      <div className="space-y-2">
        {(data || []).map((r: any) => (
          <div key={r.id} className="flex items-center justify-between border rounded-lg p-3 text-sm">
            <div>
              <div className="font-medium">Invoice {r.sales?.invoice_no || r.sale_id.slice(0, 8)}</div>
              <div className="text-xs text-muted-foreground">{r.reason || "—"} · {new Date(r.created_at).toLocaleString()}</div>
            </div>
            <div className="font-mono">{fmtMoney(r.sales?.total || 0)}</div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">No reprints logged</div>}
      </div>
    </Card>
  );
}

/* ---------------- VOIDS LOG ---------------- */
function VoidsLog() {
  const [open, setOpen] = useState(false);
  const [invoice, setInvoice] = useState("");
  const [reason, setReason] = useState("");
  const qc = useQueryClient();

  const { data } = useQuery({
    queryKey: ["voids"],
    queryFn: async () => {
      const { data, error } = await sb
        .from("sale_voids")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as any[];
    },
  });

  const voidSale = async () => {
    if (!invoice.trim() || !reason.trim()) return toast.error("Invoice and reason required");
    const { data: s, error: e1 } = await sb.from("sales").select("id").eq("invoice_no", invoice.trim()).maybeSingle();
    if (e1 || !s) return toast.error("Invoice not found");
    const { error } = await sb.rpc("void_sale", { _sale_id: s.id, _reason: reason });
    if (error) return toast.error(error.message);
    toast.success("Sale voided");
    setOpen(false); setInvoice(""); setReason("");
    qc.invalidateQueries({ queryKey: ["voids"] });
  };

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold">Voided sales</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="destructive"><Ban className="h-3 w-3 mr-1" />Void a sale</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Void a sale (admin only)</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label>Invoice number</Label>
                <Input value={invoice} onChange={(e) => setInvoice(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Reason (required)</Label>
                <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={voidSale}>Void</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <div className="space-y-2">
        {(data || []).map((v: any) => (
          <div key={v.id} className="border rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between">
              <div className="font-medium">Invoice {v.invoice_no || v.sale_id.slice(0, 8)}</div>
              <div className="font-mono">{fmtMoney(v.original_total)}</div>
            </div>
            <div className="text-xs text-muted-foreground mt-1">Reason: {v.reason} · {new Date(v.created_at).toLocaleString()}</div>
          </div>
        ))}
        {!data?.length && <div className="text-sm text-muted-foreground">No voided sales</div>}
      </div>
    </Card>
  );
}
