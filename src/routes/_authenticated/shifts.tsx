import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Printer, PlayCircle, StopCircle, AlertOctagon, CheckCircle2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";
import { fetchAll } from "@/lib/supabase-page";

export const Route = createFileRoute("/_authenticated/shifts")({ component: Page });

type ShiftRow = {
  id: string;
  cashier_id: string;
  business_date: string;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_notes: string | null;
  closing_notes: string | null;
  close_reason: string | null;
  emergency_reason: string | null;
};

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    open: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
    closed: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    approved: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
    emergency_closed: "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30",
  };
  const label: Record<string, string> = {
    open: "Open",
    closed: "Closed",
    approved: "Approved",
    emergency_closed: "Emergency",
  };
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${map[status] ?? ""}`}>
      {label[status] ?? status}
    </span>
  );
}

function Page() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { isAdmin } = usePermissions();
  const { data: settings } = useSettings();
  const enabled = !!settings?.ops_shift_enabled;

  const [openDlg, setOpenDlg] = useState(false);
  const [closeDlg, setCloseDlg] = useState<{ shift: ShiftRow } | null>(null);
  const [emgDlg, setEmgDlg] = useState<{ shift: ShiftRow } | null>(null);
  const [reportDlg, setReportDlg] = useState<{ shift: ShiftRow; kind: "X" | "Z" } | null>(null);

  const [openingCash, setOpeningCash] = useState("");
  const [openingNotes, setOpeningNotes] = useState("");
  const [actualCash, setActualCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [emgReason, setEmgReason] = useState("");

  const currentQ = useQuery({
    queryKey: ["current_shift", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_shift");
      if (error) throw error;
      return (Array.isArray(data) ? (data[0] ?? null) : (data ?? null)) as ShiftRow | null;
    },
  });
  const current = currentQ.data;

  const listQ = useQuery({
    queryKey: ["shifts_list", isAdmin],
    queryFn: async () => {
      const { data, error } = { data: await fetchAll<any>((_f, _t) => supabase
        .from("shift_sessions")
        .select("*")
        .order("opened_at", { ascending: false })
        .range(_f, _t) as any), error: null as any };
      if (error) throw error;
      return (data ?? []) as ShiftRow[];
    },
  });

  const reportQ = useQuery({
    queryKey: ["shift_report", reportDlg?.shift.id],
    enabled: !!reportDlg?.shift.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("shift_report", { _shift_id: reportDlg!.shift.id });
      if (error) throw error;
      return data as any;
    },
  });

  const liveReportQ = useQuery({
    queryKey: ["shift_report_live", current?.id],
    enabled: !!current?.id,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("shift_report", { _shift_id: current!.id });
      if (error) throw error;
      return data as any;
    },
  });

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["current_shift"] });
    qc.invalidateQueries({ queryKey: ["shifts_list"] });
    qc.invalidateQueries({ queryKey: ["shift_report_live"] });
  };

  const doOpen = async () => {
    const cash = Number(openingCash || 0);
    if (isNaN(cash) || cash < 0) return toast.error("Enter a valid opening cash");
    const { error } = await supabase.rpc("open_shift", { _opening_cash: cash, _notes: openingNotes || undefined });
    if (error) return toast.error("Couldn't open shift", { description: error.message });
    toast.success("Shift opened");
    setOpenDlg(false); setOpeningCash(""); setOpeningNotes("");
    refreshAll();
  };

  const doClose = async () => {
    if (!closeDlg) return;
    const cash = Number(actualCash);
    if (isNaN(cash) || cash < 0) return toast.error("Enter a valid actual cash amount");
    const { error } = await supabase.rpc("close_shift", {
      _shift_id: closeDlg.shift.id,
      _actual_cash: cash,
      _closing_notes: closeNotes || undefined,
      _reason: closeReason || undefined,

    });
    if (error) return toast.error("Couldn't close shift", { description: error.message });
    toast.success("Shift closed");
    setCloseDlg(null); setActualCash(""); setCloseNotes(""); setCloseReason("");
    refreshAll();
  };

  const doEmergency = async () => {
    if (!emgDlg) return;
    if (!emgReason.trim()) return toast.error("Emergency reason is required");
    const { error } = await supabase.rpc("emergency_close_shift", {
      _shift_id: emgDlg.shift.id, _reason: emgReason,
    });
    if (error) return toast.error("Couldn't emergency-close", { description: error.message });
    toast.success("Shift emergency-closed");
    setEmgDlg(null); setEmgReason("");
    refreshAll();
  };

  const doApprove = async (shift: ShiftRow) => {
    const { error } = await supabase.rpc("approve_shift", { _shift_id: shift.id });
    if (error) return toast.error("Couldn't approve", { description: error.message });
    toast.success("Shift approved");
    refreshAll();
  };

  const live = liveReportQ.data;
  const rows = listQ.data ?? [];

  const expected = useMemo(() => {
    if (!live) return 0;
    return Number(live?.cash_summary?.expected_cash ?? 0);
  }, [live]);

  return (
    <div className="p-6 max-w-7xl space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Shifts</h1>
          <p className="text-sm text-muted-foreground">
            Open, monitor and close cashier shifts. Print X (running) and Z (final) reports.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
          </Button>
          {!current && (
            <Button size="sm" onClick={() => setOpenDlg(true)} disabled={!enabled}>
              <PlayCircle className="h-4 w-4 mr-1" /> Open shift
            </Button>
          )}
        </div>
      </div>

      {!enabled && (
        <Card className="p-4 bg-muted/40 border-dashed text-sm text-muted-foreground">
          Shift management is disabled. Enable it in <span className="font-medium">Settings → Business Operations</span> to require cashiers to open a shift.
        </Card>
      )}

      {current && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground">Current shift</div>
              <div className="text-lg font-semibold">
                Business date {current.business_date} · Opened {new Date(current.opened_at).toLocaleTimeString()}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setReportDlg({ shift: current, kind: "X" })}>
                <Printer className="h-3.5 w-3.5 mr-1" /> X report
              </Button>
              <Button variant="destructive" size="sm" onClick={() => setEmgDlg({ shift: current })}>
                <AlertOctagon className="h-3.5 w-3.5 mr-1" /> Emergency close
              </Button>
              <Button size="sm" onClick={() => { setCloseDlg({ shift: current }); setActualCash(String(expected.toFixed(2))); }}>
                <StopCircle className="h-4 w-4 mr-1" /> Close shift
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Opening cash" value={fmtMoney(current.opening_cash)} />
            <Stat label="Cash sales" value={fmtMoney(live?.sales?.cash_in ?? 0)} />
            <Stat label="Card sales" value={fmtMoney(live?.sales?.card_in ?? 0)} />
            <Stat label="Receipts" value={String(live?.sales?.receipt_count ?? 0)} />
            <Stat label="Refunds (cash)" value={fmtMoney(live?.returns?.cash_out_refund ?? 0)} />
            <Stat label="Expenses (cash)" value={fmtMoney(live?.expenses?.cash_out_expense ?? 0)} />
            <Stat label="Expected drawer cash" value={fmtMoney(expected)} accent />
            <Stat label="Credit outstanding" value={fmtMoney(live?.sales?.credit_outstanding ?? 0)} />
          </div>
        </Card>
      )}

      <Card>
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-medium">Recent shifts</div>
          <div className="text-xs text-muted-foreground">Last 100</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left p-2">Business date</th>
                <th className="text-left p-2">Opened</th>
                <th className="text-left p-2">Closed</th>
                <th className="text-right p-2">Opening</th>
                <th className="text-right p-2">Expected</th>
                <th className="text-right p-2">Actual</th>
                <th className="text-right p-2">Diff</th>
                <th className="text-left p-2">Status</th>
                <th className="text-right p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-6 text-center text-muted-foreground">No shifts yet.</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2">{r.business_date}</td>
                  <td className="p-2">{new Date(r.opened_at).toLocaleString()}</td>
                  <td className="p-2">{r.closed_at ? new Date(r.closed_at).toLocaleString() : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{fmtMoney(r.opening_cash)}</td>
                  <td className="p-2 text-right tabular-nums">{r.expected_cash != null ? fmtMoney(r.expected_cash) : "—"}</td>
                  <td className="p-2 text-right tabular-nums">{r.actual_cash != null ? fmtMoney(r.actual_cash) : "—"}</td>
                  <td className={`p-2 text-right tabular-nums ${(r.difference ?? 0) < 0 ? "text-red-600" : (r.difference ?? 0) > 0 ? "text-emerald-600" : ""}`}>
                    {r.difference != null ? fmtMoney(r.difference) : "—"}
                  </td>
                  <td className="p-2"><StatusBadge status={r.status} /></td>
                  <td className="p-2 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setReportDlg({ shift: r, kind: r.status === "open" ? "X" : "Z" })}>
                        <Printer className="h-3.5 w-3.5" />
                      </Button>
                      {isAdmin && r.status === "closed" && (
                        <Button size="sm" variant="ghost" onClick={() => doApprove(r)}>
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Open shift dialog */}
      <Dialog open={openDlg} onOpenChange={setOpenDlg}>
        <DialogContent>
          <DialogHeader><DialogTitle>Open shift</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Opening cash in drawer</Label>
              <Input type="number" step="0.01" min={0} value={openingCash} onChange={(e) => setOpeningCash(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={openingNotes} onChange={(e) => setOpeningNotes(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenDlg(false)}>Cancel</Button>
            <Button onClick={doOpen}>Start shift</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close shift dialog */}
      <Dialog open={!!closeDlg} onOpenChange={(v) => !v && setCloseDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Close shift</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="rounded border bg-muted/40 p-3 text-sm">
              <div className="flex justify-between"><span>Expected drawer cash</span><span className="tabular-nums font-medium">{fmtMoney(expected)}</span></div>
            </div>
            <div>
              <Label>Actual cash counted</Label>
              <Input type="number" step="0.01" min={0} value={actualCash} onChange={(e) => setActualCash(e.target.value)} />
              {actualCash !== "" && !isNaN(Number(actualCash)) && (
                <div className="text-xs mt-1 text-muted-foreground">
                  Difference: <span className={Number(actualCash) - expected < 0 ? "text-red-600 font-medium" : Number(actualCash) - expected > 0 ? "text-emerald-600 font-medium" : ""}>
                    {fmtMoney(Number(actualCash) - expected)}
                  </span>
                </div>
              )}
            </div>
            <div>
              <Label>Reason for difference (optional)</Label>
              <Input value={closeReason} onChange={(e) => setCloseReason(e.target.value)} placeholder="e.g. short change, missed till count" />
            </div>
            <div>
              <Label>Closing notes</Label>
              <Textarea rows={2} value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
            </div>
            {settings?.ops_require_manager_approval && !isAdmin && (
              <div className="text-xs rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-800 dark:text-amber-200">
                A manager will need to approve this shift after closing.
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCloseDlg(null)}>Cancel</Button>
            <Button onClick={doClose}>Close & save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Emergency close */}
      <Dialog open={!!emgDlg} onOpenChange={(v) => !v && setEmgDlg(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Emergency close shift</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Use this only if you cannot count the drawer (power failure, system crash, etc.). This is logged.
            </p>
            <div>
              <Label>Reason</Label>
              <Textarea rows={2} value={emgReason} onChange={(e) => setEmgReason(e.target.value)} placeholder="Power failure / system crash / …" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmgDlg(null)}>Cancel</Button>
            <Button variant="destructive" onClick={doEmergency}>Emergency close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* X / Z report */}
      <Dialog open={!!reportDlg} onOpenChange={(v) => !v && setReportDlg(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{reportDlg?.kind} report</DialogTitle>
          </DialogHeader>
          {reportQ.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : reportQ.data ? (
            <ReportView data={reportQ.data} kind={reportDlg!.kind} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReportDlg(null)}>Close</Button>
            <Button onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`rounded border p-3 ${accent ? "bg-primary/5 border-primary/30" : "bg-muted/30"}`}>
      <div className="text-[11px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className="text-lg font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ReportView({ data, kind }: { data: any; kind: "X" | "Z" }) {
  const s = data?.shift ?? {};
  const sales = data?.sales ?? {};
  const rets = data?.returns ?? {};
  const exps = data?.expenses ?? {};
  const cash = data?.cash_summary ?? {};
  const row = (label: string, val: string | number, bold = false) => (
    <div className={`flex justify-between py-0.5 ${bold ? "font-semibold border-t mt-1 pt-1" : ""}`}>
      <span>{label}</span><span className="tabular-nums">{val}</span>
    </div>
  );
  return (
    <div className="text-sm font-mono">
      <div className="text-center mb-2">
        <div className="font-semibold">{kind} REPORT</div>
        <div className="text-xs text-muted-foreground">Business date {s.business_date}</div>
        <div className="text-xs text-muted-foreground">
          Opened {new Date(s.opened_at).toLocaleString()}
          {s.closed_at ? ` · Closed ${new Date(s.closed_at).toLocaleString()}` : " · IN PROGRESS"}
        </div>
      </div>
      <div className="border-t pt-2">
        <div className="uppercase text-xs mb-1">Sales</div>
        {row("Receipts", sales.receipt_count ?? 0)}
        {row("Gross", fmtMoney(sales.gross ?? 0))}
        {row("Discount", fmtMoney(sales.discount ?? 0))}
        {row("Tax", fmtMoney(sales.tax ?? 0))}
        {kind === "Z" && row("Cost", fmtMoney(sales.cost ?? 0))}
        {kind === "Z" && row("Profit", fmtMoney(data.profit ?? 0), true)}
      </div>
      <div className="border-t pt-2 mt-2">
        <div className="uppercase text-xs mb-1">Returns / Expenses</div>
        {row("Returns", `${rets.return_count ?? 0} · ${fmtMoney(rets.return_total ?? 0)}`)}
        {row("Expenses", `${exps.expense_count ?? 0} · ${fmtMoney(exps.expense_total ?? 0)}`)}
      </div>
      <div className="border-t pt-2 mt-2">
        <div className="uppercase text-xs mb-1">Cash summary</div>
        {row("Opening cash", fmtMoney(cash.opening_cash ?? 0))}
        {row("+ Cash sales", fmtMoney(cash.cash_in ?? 0))}
        {row("− Cash refunds", fmtMoney(cash.cash_out_refund ?? 0))}
        {row("− Cash expenses", fmtMoney(cash.cash_out_expense ?? 0))}
        {row("Expected cash", fmtMoney(cash.expected_cash ?? 0), true)}
        {kind === "Z" && s.actual_cash != null && row("Actual cash", fmtMoney(s.actual_cash))}
        {kind === "Z" && s.difference != null && row("Difference", fmtMoney(s.difference), true)}
      </div>
      {(s.opening_notes || s.closing_notes || s.close_reason || s.emergency_reason) && (
        <div className="border-t pt-2 mt-2 text-xs">
          {s.opening_notes && <div><b>Open:</b> {s.opening_notes}</div>}
          {s.closing_notes && <div><b>Close:</b> {s.closing_notes}</div>}
          {s.close_reason && <div><b>Reason:</b> {s.close_reason}</div>}
          {s.emergency_reason && <div className="text-red-600"><b>Emergency:</b> {s.emergency_reason}</div>}
        </div>
      )}
    </div>
  );
}
