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

export function AddPaymentDialog({
  open, onOpenChange, party, partyId, party_name, defaultAmount = 0, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  party: Party; partyId: string; party_name?: string;
  defaultAmount?: number; onDone?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(defaultAmount);
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
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
    if (open) {
      setAmount(defaultAmount);
      setMethod(defaultSource?.name ?? "Cash in hand");
      setAccountId(defaultSource?.id ?? "");
      setNote("");
      setWhen(toLocalInputValue(new Date().toISOString()));
    }
  }, [open, defaultAmount, cashAccounts.length]);

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
      const account = await resolveAccount();
      const res = await supabase.rpc("record_payment", {
        p_party_type: party, p_party_id: partyId, p_amount: amount, p_method: account.name, p_note: note || "", p_account_id: account.id ?? undefined,
      });
      error = res.error;
      if (!error && when && res.data) {
        const chosen = new Date(when);
        const nowIso = new Date();
        if (Math.abs(chosen.getTime() - nowIso.getTime()) > 60_000) {
          const upd = await supabase.rpc("update_party_payment", {
            _id: res.data as string, _amount: amount, _method: account.name, _note: note || "",
            _created_at: chosen.toISOString(), _account_id: account.id ?? undefined,
          });
          error = upd.error;
        }
      }
    } catch (e: any) {
      error = e;
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('ledger.payment_recorded', 'Payment recorded'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{party_name ? t('ledger.add_payment_for', 'Add payment — {{name}}', { name: party_name }) : t('ledger.add_payment', 'Add payment')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <DateTimeField value={when} onChange={setWhen} />
          <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div>
            <Label>{party === "customer" ? t('ledger.receive_in', 'Receive in') : t('ledger.pay_from', 'Pay from')}</Label>
            <Select
              value={accountId}
              onValueChange={(value) => {
                setAccountId(value);
                const selected = sourceOptions.find((a) => a.id === value);
                if (selected) setMethod(selected.name);
              }}
            >
              <SelectTrigger><SelectValue placeholder={t('ledger.choose_source_placeholder', 'Choose Cash, Bank, EasyPaisa…')} /></SelectTrigger>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel', 'Cancel')}</Button>
          <Button onClick={save} disabled={saving}>{saving ? t('common.saving', 'Saving…') : t('common.save', 'Save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Waives part of what a customer owes — settles the ledger like a payment,
 *  but no cash actually comes in (no cash account, no cash_transactions
 *  row) and it's tracked separately so it can be subtracted from profit. */
export function AddDiscountDialog({
  open, onOpenChange, partyId, party_name, defaultAmount = 0, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  partyId: string; party_name?: string;
  defaultAmount?: number; onDone?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(defaultAmount);
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setAmount(defaultAmount);
      setNote("");
      setWhen(toLocalInputValue(new Date().toISOString()));
    }
  }, [open, defaultAmount]);

  const save = async () => {
    if (!amount || amount <= 0) return toast.error(t('ledger.amount_positive', 'Amount must be positive'));
    setSaving(true);
    let error: any = null;
    try {
      const res = await supabase.rpc("record_payment", {
        p_party_type: "customer", p_party_id: partyId, p_amount: amount, p_method: "discount", p_note: note || "",
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
    } catch (e: any) {
      error = e;
    }
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(t('ledger.discount_recorded', 'Discount recorded'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{party_name ? t('ledger.add_discount_for', 'Add discount — {{name}}', { name: party_name }) : t('ledger.add_discount', 'Add discount')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <DateTimeField value={when} onChange={setWhen} />
          <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          <div><Label>{t('common.note', 'Note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ledger.discount_placeholder', 'e.g. Rounded off / goodwill discount')} /></div>
          <p className="text-[11px] text-muted-foreground">
            {t('ledger.discount_note', 'No cash moves — this reduces what the customer owes and comes off profit in Reports & Dashboard. Nothing changes in Cash Flow.')}
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

export function EditPaymentDialog({
  open, onOpenChange, payment, onDone,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  payment: { id: string; amount: number; method: string; note: string; created_at: string } | null;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState("cash");
  const [accountId, setAccountId] = useState("");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState("");
  const [saving, setSaving] = useState(false);
  const cashAccountsQ = useCashAccounts();
  const cashAccounts = cashAccountsQ.data ?? [];
  const isDiscount = payment?.method === "discount";
  useEffect(() => {
    if (payment) {
      setAmount(Number(payment.amount));
      setMethod(payment.method || "cash");
      setAccountId("");
      setNote(payment.note || "");
      setWhen(toLocalInputValue(payment.created_at));
    }
  }, [payment]);

  const save = async () => {
    if (!payment) return;
    if (!amount || amount <= 0) return toast.error(t('ledger.amount_positive', 'Amount must be positive'));
    setSaving(true);
    const selected = cashAccounts.find((a: any) => a.id === accountId);
    const { error } = await supabase.rpc("update_party_payment", {
      _id: payment.id, _amount: amount, _method: isDiscount ? "discount" : (selected?.name ?? method), _note: note || "",
      _created_at: when ? new Date(when).toISOString() : payment.created_at,
      _account_id: isDiscount ? undefined : (accountId || undefined),
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(isDiscount ? t('ledger.discount_updated', 'Discount updated') : t('ledger.payment_updated', 'Payment updated'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  const remove = async () => {
    if (!payment) return;
    if (!confirm(isDiscount ? t('ledger.delete_confirm_discount', 'Delete this discount? Balance will be reversed.') : t('ledger.delete_confirm_payment', 'Delete this payment? Balance will be reversed.'))) return;
    setSaving(true);
    const { error } = await supabase.rpc("delete_party_payment", { _id: payment.id });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(isDiscount ? t('ledger.discount_deleted', 'Discount deleted') : t('ledger.payment_deleted', 'Payment deleted'));
    onOpenChange(false);
    qc.invalidateQueries();
    onDone?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{isDiscount ? t('ledger.edit_discount', 'Edit discount') : t('ledger.edit_payment', 'Edit payment')}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <DateTimeField value={when} onChange={setWhen} />
          <div><Label>{t('common.amount', 'Amount')}</Label><Input type="number" step="0.01" value={amount || ""} onChange={(e) => setAmount(Number(e.target.value))} /></div>
          {isDiscount ? (
            <p className="text-[11px] text-muted-foreground">
              {t('ledger.no_cash_account_note', 'No cash account — this is a discount, not a received payment.')}
            </p>
          ) : (
          <div>
            <Label>{t('ledger.payment_source', 'Payment source')}</Label>
            <Select
              value={accountId}
              onValueChange={(value) => {
                setAccountId(value);
                const selected = cashAccounts.find((a: any) => a.id === value);
                if (selected) setMethod(selected.name);
              }}
            >
              <SelectTrigger><SelectValue placeholder={method || t('ledger.keep_current_source', 'Keep current source')} /></SelectTrigger>
              <SelectContent>
                {cashAccounts.map((a: any) => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          )}
          <div><Label>{t('common.note', 'Note')}</Label><Input value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="destructive" onClick={remove} disabled={saving}><Trash2 className="h-4 w-4 mr-1" />{t('common.delete', 'Delete')}</Button>
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
