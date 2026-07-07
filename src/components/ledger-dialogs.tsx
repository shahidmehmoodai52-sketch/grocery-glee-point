import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Trash2 } from "lucide-react";

export type Party = "customer" | "supplier";
export type LedgerEntity = "sale" | "purchase" | "sale_return" | "purchase_return" | "payment";

const tableFor: Record<Exclude<LedgerEntity, "payment">, string> = {
  sale: "sales",
  purchase: "purchases",
  sale_return: "sale_returns",
  purchase_return: "purchase_returns",
};

function toLocalInputValue(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AddPaymentDialog({
  open, onOpenChange, party, partyId, party_name, defaultAmount = 0, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  party: Party; partyId: string; party_name?: string;
  defaultAmount?: number; onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setAmount(defaultAmount); setMethod("cash"); setNote(""); } }, [open, defaultAmount]);

  const save = async () => {
    if (!amount || amount <= 0) return toast.error("Amount must be positive");
    setSaving(true);
    const { error } = await supabase.rpc("record_payment", {
      p_party_type: party, p_party_id: partyId, p_amount: amount, p_method: method, p_note: note || "",
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Payment recorded");
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Add payment{party_name ? ` — ${party_name}` : ""}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Amount</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div><Label>Method</Label><Input value={method} onChange={(e) => setMethod(e.target.value)} /></div>
          <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditPaymentDialog({
  open, onOpenChange, payment, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  payment: { id: string; amount: number; method: string; note: string; created_at: string } | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (payment) {
      setAmount(Number(payment.amount));
      setMethod(payment.method || "cash");
      setNote(payment.note || "");
      setWhen(toLocalInputValue(payment.created_at));
    }
  }, [payment]);

  const save = async () => {
    if (!payment) return;
    if (!amount || amount <= 0) return toast.error("Amount must be positive");
    setSaving(true);
    const { error } = await supabase.rpc("update_party_payment", {
      _id: payment.id, _amount: amount, _method: method, _note: note || "",
      _created_at: when ? new Date(when).toISOString() : payment.created_at,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Payment updated");
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  const remove = async () => {
    if (!payment) return;
    if (!confirm("Delete this payment? Balance will be reversed.")) return;
    setSaving(true);
    const { error } = await supabase.rpc("delete_party_payment", { _id: payment.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Payment deleted");
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit payment</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Date & time</Label><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
          <div><Label>Amount</Label><Input type="number" step="0.01" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div><Label>Method</Label><Input value={method} onChange={(e) => setMethod(e.target.value)} /></div>
          <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="destructive" onClick={remove} disabled={saving}><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditEntryDialog({
  open, onOpenChange, entity, entry, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  entity: Exclude<LedgerEntity, "payment"> | null;
  entry: { id: string; ref: string; note: string; created_at: string } | null;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (entry) { setNote(entry.note || ""); setWhen(toLocalInputValue(entry.created_at)); }
  }, [entry]);

  const save = async () => {
    if (!entry || !entity) return;
    setSaving(true);
    const table = tableFor[entity];
    const { error } = await supabase.from(table as any).update({
      note: note || null,
      created_at: when ? new Date(when).toISOString() : entry.created_at,
    }).eq("id", entry.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Entry updated");
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Edit {entity?.replace("_"," ")} · {entry?.ref}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div><Label>Date & time</Label><Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></div>
          <div><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">
            Amount is derived from items and cannot be changed here. Delete or re-create the transaction to change amounts.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
