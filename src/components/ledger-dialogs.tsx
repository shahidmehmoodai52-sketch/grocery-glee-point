import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { Trash2, CalendarIcon } from "lucide-react";
import { format } from "date-fns";

export type Party = "customer" | "supplier" | "expense_person";
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

function DateTimeField({ label, value, onChange }: { label?: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const datePart = value ? value.slice(0, 10) : "";
  const timePart = value ? value.slice(11, 16) : "00:00";
  const selected = datePart ? new Date(`${datePart}T00:00:00`) : undefined;
  return (
    <div>
      <Label>{label ?? t('ledger.date_time', 'Date & time')}</Label>
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn("flex-1 justify-start text-left font-normal", !datePart && "text-muted-foreground")}
            >
              <CalendarIcon className="h-4 w-4 mr-2" />
              {selected ? format(selected, "PPP") : <span>{t('ledger.pick_a_date', 'Pick a date')}</span>}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar
              mode="single"
              selected={selected}
              onSelect={(d) => {
                if (!d) return;
                const pad = (n: number) => String(n).padStart(2, "0");
                onChange(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${timePart || "00:00"}`);
              }}
              initialFocus
              className={cn("p-3 pointer-events-auto")}
            />
          </PopoverContent>
        </Popover>
        <Input
          type="time"
          className="w-[110px]"
          value={timePart}
          onChange={(e) => onChange(`${datePart || toLocalInputValue(new Date().toISOString()).slice(0, 10)}T${e.target.value || "00:00"}`)}
        />
      </div>
    </div>
  );
}

const PAYMENT_SOURCE_PRESETS = ["Cash in hand", "Bank", "EasyPaisa", "JazzCash", "Card"];

function guessAccountType(name: string) {
  const s = name.toLowerCase();
  if (s.includes("bank")) return "bank";
  if (s.includes("card")) return "card";
  if (s.includes("easy") || s.includes("jazz") || s.includes("wallet")) return "mobile_wallet";
  return "cash";
}

function useCashAccounts() {
  return useQuery({
    queryKey: ["cash-accounts", "payment-dialog"],
    queryFn: async () =>
      (await supabase
        .from("cash_accounts")
        .select("id,name,type,is_active")
        .eq("is_active", true)
        .order("sort_order")
        .order("name")).data ?? [],
  });
}

export interface EditingPayment {
  id: string;
  amount: number;
  method: string;
  note: string;
  created_at: string;
  direction?: "in" | "out" | null;
}

/** Also doubles as the editor: pass `editing` (an existing party_payments
 *  row) to pre-fill every field from it and save via update_party_payment
 *  instead of record_payment. This is deliberate — editing a payment should
 *  open the exact same form it was created in, not a separate dialog, so
 *  the two can never drift out of sync (direction, account-preset creation,
 *  etc. only had to be built once). */
export function AddPaymentDialog({
  open, onOpenChange, party, partyId, party_name, defaultAmount = 0, editing, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  party: Party; partyId: string; party_name?: string;
  defaultAmount?: number; editing?: EditingPayment | null; onDone?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEditing = !!editing;
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  // Only meaningful for customers: a supplier/staff payment is unambiguously
  // "you paid them". A customer payment could be either direction (money
  // they gave you, or cash you gave/paid out on their behalf) — this was
  // previously impossible to express here, silently posting every customer
  // entry as "received" even when it was actually a cash-out.
  const [direction, setDirection] = useState<"in" | "out">("in");
  const cashAccountsQ = useCashAccounts();
  const cashAccounts = cashAccountsQ.data ?? [];
  const sourceOptions = [
    ...cashAccounts.map((a: any) => ({ id: a.id as string, name: a.name as string, preset: false })),
    ...PAYMENT_SOURCE_PRESETS
      .filter((p) => !cashAccounts.some((a: any) => a.name.toLowerCase() === p.toLowerCase()))
      .map((p) => ({ id: `preset:${p}`, name: p, preset: true })),
  ];
  const defaultSource = sourceOptions.find((a) => a.name.toLowerCase() === "cash in hand")
    ?? sourceOptions.find((a) => a.name.toLowerCase() === "cash")
    ?? sourceOptions[0];

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setAmount(Number(editing.amount));
      setMethod(editing.method || "cash");
      setAccountId(cashAccounts.find((a: any) => a.name.toLowerCase() === (editing.method || "").toLowerCase())?.id ?? "");
      setNote(editing.note || "");
      setWhen(toLocalInputValue(editing.created_at));
      setDirection(editing.direction === "out" ? "out" : "in");
    } else {
      setAmount(defaultAmount);
      setMethod(defaultSource?.name ?? "Cash in hand");
      setAccountId(defaultSource?.id ?? "");
      setNote("");
      setWhen(toLocalInputValue(new Date().toISOString()));
      setDirection("in");
    }
  }, [open, editing?.id, defaultAmount, cashAccounts.length]);

  const resolveAccount = async () => {
    const selected = sourceOptions.find((a) => a.id === accountId)
      ?? sourceOptions.find((a) => a.name.toLowerCase() === method.toLowerCase())
      ?? defaultSource;
    if (!selected) return { id: null as string | null, name: method || "cash" };
    if (!selected.preset) return { id: selected.id, name: selected.name };
    const { data, error } = await supabase
      .from("cash_accounts")
      .insert({ name: selected.name, type: guessAccountType(selected.name), opening_balance: 0, is_active: true })
      .select("id,name")
      .single();
    if (error) throw error;
    return { id: data.id as string, name: data.name as string };
  };

  const save = async () => {
    if (!amount || amount <= 0) return toast.error(t('ledger.amount_positive', 'Amount must be positive'));
    setSaving(true);
    let error: any = null;
    try {
      const effectiveDirection = party === "customer" ? direction : undefined;
      if (editing) {
        // Only resolve/override the account if the user actually touched the
        // field — an empty accountId here means "leave it as it already is",
        // and update_party_payment already preserves the existing linked
        // account when _account_id is omitted.
        const account = accountId ? await resolveAccount() : null;
        const upd = await supabase.rpc("update_party_payment", {
          _id: editing.id, _amount: amount, _method: account?.name ?? editing.method, _note: note || "",
          _created_at: when ? new Date(when).toISOString() : editing.created_at,
          _account_id: account?.id ?? undefined,
          _direction: effectiveDirection,
        } as any);
        error = upd.error;
      } else {
        const account = await resolveAccount();
        const res = await supabase.rpc("record_payment", {
          p_party_type: party, p_party_id: partyId, p_amount: amount, p_method: account.name, p_note: note || "", p_account_id: account.id ?? undefined,
          p_direction: effectiveDirection,
        } as any);
        error = res.error;
        if (!error && when && res.data) {
          const chosen = new Date(when);
          const nowIso = new Date();
          if (Math.abs(chosen.getTime() - nowIso.getTime()) > 60_000) {
            const upd = await supabase.rpc("update_party_payment", {
              _id: res.data as string, _amount: amount, _method: account.name, _note: note || "",
              _created_at: chosen.toISOString(), _account_id: account.id ?? undefined,
              _direction: effectiveDirection,
            } as any);
            error = upd.error;
          }
        }
      }
    } catch (e: any) {
      error = e;
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(isEditing ? t('ledger.payment_updated', 'Payment updated') : t('ledger.payment_recorded', 'Payment recorded'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  const remove = async () => {
    if (!editing) return;
    if (!confirm(t('ledger.delete_confirm_payment', 'Delete this payment? Balance will be reversed.'))) return;
    setSaving(true);
    const { error } = await supabase.rpc("delete_party_payment", { _id: editing.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('ledger.payment_deleted', 'Payment deleted'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  const titleKey = isEditing
    ? (party === "customer" && direction === "out" ? "ledger.edit_cash_given" : "ledger.edit_payment")
    : (party === "customer" && direction === "out" ? "ledger.give_cash" : "ledger.add_payment");
  const titleForKey = isEditing
    ? (party === "customer" && direction === "out" ? "ledger.edit_cash_given_for" : "ledger.edit_payment_for")
    : (party === "customer" && direction === "out" ? "ledger.give_cash_for" : "ledger.add_payment_for");
  const titleDefault = isEditing
    ? (party === "customer" && direction === "out" ? "Edit cash given" : "Edit payment")
    : (party === "customer" && direction === "out" ? "Give cash" : "Add payment");
  const titleForDefault = isEditing
    ? (party === "customer" && direction === "out" ? "Edit cash given — {{name}}" : "Edit payment — {{name}}")
    : (party === "customer" && direction === "out" ? "Give cash — {{name}}" : "Add payment — {{name}}");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {party_name ? t(titleForKey, titleForDefault, { name: party_name }) : t(titleKey, titleDefault)}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          {party === "customer" && (
            <div>
              <Label>{t('ledger.direction_label', 'This payment is')}</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "in" | "out")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">{t('ledger.direction_in', 'Money received from customer')}</SelectItem>
                  <SelectItem value="out">{t('ledger.direction_out', 'Cash paid to customer')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          <DateTimeField value={when} onChange={setWhen} />
          <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div>
            <Label>{party === "customer" ? (direction === "out" ? t('ledger.pay_from', 'Pay from') : t('ledger.receive_in', 'Receive in')) : t('ledger.pay_from', 'Pay from')}</Label>
            <Select
              value={accountId}
              onValueChange={(value) => {
                setAccountId(value);
                const selected = sourceOptions.find((a) => a.id === value);
                if (selected) setMethod(selected.name);
              }}
            >
              <SelectTrigger><SelectValue placeholder={isEditing && !accountId ? method : t('ledger.choose_source_placeholder', 'Choose Cash, Bank, EasyPaisa…')} /></SelectTrigger>
              <SelectContent>
                {sourceOptions.map((a) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground mt-1">
              {t('ledger.account_updated_note', 'This account is updated in Cash Flow and reports.')}
            </p>
          </div>
          <div><Label>{t('common.note', 'Note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter className={isEditing ? "justify-between sm:justify-between" : undefined}>
          {isEditing && (
            <Button variant="destructive" onClick={remove} disabled={saving}><Trash2 className="h-4 w-4 mr-1" />{t('common.delete', 'Delete')}</Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Waives part of what a party owes — settles the ledger like a payment, but
 *  no cash actually moves (no cash account, no cash_transactions row) and
 *  it's tracked separately (method='discount') so reports can treat it
 *  correctly: a customer discount is a cost (subtracted from profit), while
 *  a supplier discount is money saved (added to profit) — same mechanism,
 *  opposite direction, decided by `party`. */
/** Also doubles as the editor — same reasoning as AddPaymentDialog above:
 *  pass `editing` to pre-fill from an existing discount row and save via
 *  update_party_payment instead of record_payment. */
export function AddDiscountDialog({
  open, onOpenChange, party, partyId, party_name, defaultAmount = 0, editing, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  party: Party; partyId: string; party_name?: string;
  defaultAmount?: number; editing?: EditingPayment | null; onDone?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isEditing = !!editing;
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setAmount(Number(editing.amount));
      setNote(editing.note || "");
      setWhen(toLocalInputValue(editing.created_at));
    } else {
      setAmount(defaultAmount);
      setNote("");
      setWhen(toLocalInputValue(new Date().toISOString()));
    }
  }, [open, editing?.id, defaultAmount]);

  const save = async () => {
    if (!amount || amount <= 0) return toast.error(t('ledger.amount_positive', 'Amount must be positive'));
    setSaving(true);
    let error: any = null;
    try {
      if (editing) {
        const upd = await supabase.rpc("update_party_payment", {
          _id: editing.id, _amount: amount, _method: "discount", _note: note || "",
          _created_at: when ? new Date(when).toISOString() : editing.created_at,
        });
        error = upd.error;
      } else {
        const res = await supabase.rpc("record_payment", {
          p_party_type: party, p_party_id: partyId, p_amount: amount, p_method: "discount", p_note: note || "",
        });
        error = res.error;
        if (!error && when && res.data) {
          const chosen = new Date(when);
          const nowIso = new Date();
          if (Math.abs(chosen.getTime() - nowIso.getTime()) > 60_000) {
            const upd = await supabase.rpc("update_party_payment", {
              _id: res.data as string, _amount: amount, _method: "discount", _note: note || "",
              _created_at: chosen.toISOString(),
            });
            error = upd.error;
          }
        }
      }
    } catch (e: any) {
      error = e;
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(isEditing ? t('ledger.discount_updated', 'Discount updated') : t('ledger.discount_recorded', 'Discount recorded'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  const remove = async () => {
    if (!editing) return;
    if (!confirm(t('ledger.delete_confirm_discount', 'Delete this discount? Balance will be reversed.'))) return;
    setSaving(true);
    const { error } = await supabase.rpc("delete_party_payment", { _id: editing.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('ledger.discount_deleted', 'Discount deleted'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing
              ? (party_name ? t('ledger.edit_discount_for', 'Edit discount — {{name}}', { name: party_name }) : t('ledger.edit_discount', 'Edit discount'))
              : (party_name ? t('ledger.add_discount_for', 'Add discount — {{name}}', { name: party_name }) : t('ledger.add_discount', 'Add discount'))}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <DateTimeField value={when} onChange={setWhen} />
          <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div><Label>{t('common.note', 'Note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ledger.discount_placeholder', 'e.g. Rounded off / goodwill discount')} /></div>
          <p className="text-[11px] text-muted-foreground">
            {party === "supplier"
              ? t('ledger.discount_note_supplier', 'No cash moves — this reduces what we owe the supplier and is added to profit in Reports & Dashboard. Nothing changes in Cash Flow.')
              : t('ledger.discount_note', 'No cash moves — this reduces what the customer owes and comes off profit in Reports & Dashboard. Nothing changes in Cash Flow.')}
          </p>
        </div>
        <DialogFooter className={isEditing ? "justify-between sm:justify-between" : undefined}>
          {isEditing && (
            <Button variant="destructive" onClick={remove} disabled={saving}><Trash2 className="h-4 w-4 mr-1" />{t('common.delete', 'Delete')}</Button>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
            <Button onClick={save} disabled={saving}>{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</Button>
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
  const { t } = useTranslation();
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
    toast.success(t('ledger.entry_updated', 'Entry updated'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  const entityLabels: Record<string, string> = {
    sale: t('ledger.entity_sale', 'Sale'), purchase: t('ledger.entity_purchase', 'Purchase'),
    sale_return: t('ledger.entity_sale_return', 'Sale return'), purchase_return: t('ledger.entity_purchase_return', 'Purchase return'),
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t('ledger.edit_entry_title', 'Edit {{entity}} · {{ref}}', { entity: entity ? entityLabels[entity] : "", ref: entry?.ref })}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <DateTimeField value={when} onChange={setWhen} />
          <div><Label>{t('common.note', 'Note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">
            {t('ledger.amount_derived_note', 'Amount is derived from items and cannot be changed here. Delete or re-create the transaction to change amounts.')}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
