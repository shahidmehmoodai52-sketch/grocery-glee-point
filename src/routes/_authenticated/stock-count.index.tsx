import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Plus, ClipboardCheck, ArrowRight, ListChecks, CheckCircle2, Clock, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Table, TableHeader, TableRow, TableHead, TableBody, TableCell,
} from "@/components/ui/table";
import { PageHeader } from "@/components/ui/page-header";
import { StatCard } from "@/components/ui/stat-card";
import { EmptyState } from "@/components/ui/empty-state";
import { TableSkeleton } from "@/components/ui/table-skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { fmtMoney } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/stock-count/")({
  component: StockCountListPage,
});

const STATUS_META: Record<string, { label: string; classes: string }> = {
  draft: { label: "Draft", classes: "bg-muted text-muted-foreground" },
  in_progress: { label: "In Progress", classes: "bg-blue-500/15 text-blue-600 border-blue-500/30" },
  completed: { label: "Approved", classes: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" },
  cancelled: { label: "Cancelled", classes: "bg-red-500/15 text-red-600 border-red-500/30" },
};

function StockCountListPage() {
  const { user } = useAuth();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "$";
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const sessionsQ = useQuery({
    queryKey: ["stock-count-sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("stock_count_sessions" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  const create = async () => {
    if (!name.trim()) return toast.error("Give the count a name");
    setSaving(true);
    const { data, error } = await supabase
      .from("stock_count_sessions" as any)
      .insert({ name: name.trim(), notes: notes.trim() || null, status: "in_progress", started_by: user?.id })
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error(error.message);
    setOpen(false);
    setName(""); setNotes("");
    qc.invalidateQueries({ queryKey: ["stock-count-sessions"] });
    navigate({ to: "/stock-count/$id", params: { id: (data as any).id } });
  };

  const sessions = sessionsQ.data ?? [];
  const completed = sessions.filter((s) => s.status === "completed");
  const lastCompleted = completed[0];

  return (
    <div className="p-6 space-y-4">
      <PageHeader
        title="Stock Count"
        description="Physical audit sessions — compare system stock against actual shelf count."
        icon={<ClipboardCheck className="h-5 w-5" />}
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> New count
          </Button>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <StatCard label="Total sessions" value={String(sessions.length)} icon={ListChecks} tone="primary" />
        <StatCard label="Approved" value={String(completed.length)} icon={CheckCircle2} tone="success" />
        <StatCard
          label="Last count"
          value={lastCompleted ? format(new Date(lastCompleted.completed_at), "PP") : "—"}
          icon={Clock}
          tone="info"
        />
        <StatCard
          label="Last variance value"
          value={lastCompleted?.total_variance_value != null ? fmtMoney(lastCompleted.total_variance_value, sym) : "—"}
          icon={TrendingDown}
          tone="warning"
        />
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Completed</TableHead>
              <TableHead className="text-right">Variance value</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sessionsQ.isLoading && (
              <TableRow><TableCell colSpan={6} className="py-4"><TableSkeleton rows={4} columns={5} /></TableCell></TableRow>
            )}
            {!sessionsQ.isLoading && sessions.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8">
                  <EmptyState
                    icon={ClipboardCheck}
                    title="No stock counts yet"
                    description="Start one to audit your shelves."
                  />
                </TableCell>
              </TableRow>
            )}
            {sessions.map((s) => {
              const meta = STATUS_META[s.status] ?? STATUS_META.draft;
              return (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell><Badge variant="outline" className={meta.classes}>{meta.label}</Badge></TableCell>
                  <TableCell className="text-muted-foreground">{format(new Date(s.started_at), "PPp")}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.completed_at ? format(new Date(s.completed_at), "PPp") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {s.total_variance_value != null ? fmtMoney(s.total_variance_value, sym) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link to="/stock-count/$id" params={{ id: s.id }}>
                      <Button variant="ghost" size="sm">
                        Open <ArrowRight className="h-4 w-4 ml-1" />
                      </Button>
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Start a stock count</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. October end-of-month count" />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Which shelves, who is counting…" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={create} disabled={saving}>{saving ? "Starting…" : "Start counting"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
