import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Receipt, sampleInvoice } from "@/components/receipt";
import { OfflineModeCard } from "@/components/offline-mode-card";
import { setDefaultCurrencySymbol } from "@/lib/format";
import { CurrencySelect } from "@/components/currency-select";
import { LanguageSelect } from "@/components/language-select/language-select";



export const Route = createFileRoute("/_authenticated/settings")({ component: Page });

const FIELDS = [
  "store_name", "currency", "currency_symbol", "tax_rate", "address", "phone",
  "logo_url", "tax_id", "receipt_header", "receipt_footer", "paper_width",
  "show_logo", "show_tax_id", "show_address", "show_phone", "show_tax_lines", "show_cashier",
  "payment_qr_url", "payment_qr_label", "show_payment_qr",
  "undo_window_minutes",
  "stock_count_scan_mode",
  "expiring_soon_days",
  "critical_days",
  "ops_shift_enabled", "ops_business_day_start_hour", "ops_require_manager_approval",
  "ops_allow_multiple_shifts", "ops_cash_drawer_enabled", "ops_safe_drop_enabled",
  "ops_paid_in_out_enabled", "ops_shift_notes_enabled", "ops_pending_tasks_enabled",
  "ops_receipt_reprint_enabled",
  "pos_print_prompt_enabled", "pos_print_prompt_default",
] as const;




function Page() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["store_settings"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_store_settings");
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
  });
  const [form, setForm] = useState<any>({
    store_name: "", currency: "PKR", currency_symbol: "Rs", tax_rate: 0,
    address: "", phone: "", logo_url: "", tax_id: "",
    receipt_header: "", receipt_footer: "Thank you for shopping with us!",
    paper_width: "80mm",
    show_logo: true, show_tax_id: true, show_address: true,
    show_phone: true, show_tax_lines: true, show_cashier: true,
    payment_qr_url: "", payment_qr_label: "", show_payment_qr: true,
    undo_window_minutes: 5,
    stock_count_scan_mode: "prompt",
    expiring_soon_days: 30,
    critical_days: 7,
  });

  useEffect(() => { if (data) setForm({ ...form, ...data }); /* eslint-disable-next-line */ }, [data]);

  const set = (patch: any) => setForm((f: any) => ({ ...f, ...patch }));

  const save = async () => {
    if (!data?.id) return toast.error(t('settings.not_ready', 'Store settings not ready — please refresh.'));
    const payload: any = {};
    for (const k of FIELDS) payload[k] = form[k];
    // RLS ensures we can only update our own tenant's row; scope by id for safety.
    const { data: saved, error } = await supabase
      .from("store_settings")
      .update(payload)
      .eq("id", data.id)
      .select("*")
      .maybeSingle();
    if (error) return toast.error(t('settings.save_failed', "Couldn't save settings. Please try again."), { description: error.message });
    if (!saved) return toast.error(t('settings.not_saved', 'Settings were not saved. Please refresh and try again.'));
    setForm((f: any) => ({ ...f, ...saved }));
    setDefaultCurrencySymbol(saved.currency_symbol ?? "Rs");
    toast.success(t('settings.settings_saved', 'Settings saved'));
    await qc.invalidateQueries({ queryKey: ["store_settings"] });
  };

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{t('settings.title', 'Store & receipt settings')}</h1>
        <p className="text-sm text-muted-foreground">{t('settings.subtitle', 'Configure store info, taxes and the printed receipt layout.')}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <div className="font-medium">{t('settings.store_heading', 'Store')}</div>
            <div><Label>{t('settings.store_name_label', 'Store name')}</Label><Input value={form.store_name ?? ""} onChange={(e) => set({ store_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('common.currency', 'Currency')}</Label>
                <CurrencySelect
                  value={form.currency ?? "PKR"}
                  onChange={(code, symbol) => {
                    set({ currency: code, currency_symbol: symbol });
                  }}
                />
                <div className="text-xs text-muted-foreground mt-1">{t('settings.currencies_hint', 'Search from all world currencies.')}</div>
              </div>
              <div>
                <Label>{t('settings.currency_symbol_label', 'Currency symbol')}</Label>
                <Input
                  value={form.currency_symbol ?? ""}
                  onChange={(e) => set({ currency_symbol: e.target.value })}
                  placeholder={t('settings.currency_symbol_placeholder', 'e.g. Rs, $, €, ₨')}
                />
                <div className="text-xs text-muted-foreground mt-1">
                  {t('settings.currency_symbol_hint', 'Auto-filled from the currency you pick — edit if you want a different symbol.')}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('settings.default_tax_rate_label', 'Default tax rate (%)')}</Label><Input type="number" step="0.01" value={form.tax_rate ?? 0} onChange={(e) => set({ tax_rate: Number(e.target.value) })} /></div>
              <div><Label>{t('settings.tax_id_label', 'Tax ID / VAT #')}</Label><Input value={form.tax_id ?? ""} onChange={(e) => set({ tax_id: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>{t('common.phone', 'Phone')}</Label><Input value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></div>
              <div><Label>{t('common.address', 'Address')}</Label><Input value={form.address ?? ""} onChange={(e) => set({ address: e.target.value })} /></div>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <div className="font-medium">{t('settings.pos_behaviour_heading', 'POS behaviour')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.pos_behaviour_hint', 'Controls how long a cashier can undo a just-completed sale (Ctrl+Z / F10).')}</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('settings.undo_window_label', 'Undo window (minutes)')}</Label>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={form.undo_window_minutes ?? 5}
                  onChange={(e) => set({ undo_window_minutes: Math.max(1, Number(e.target.value) || 5) })}
                />
              </div>
              <div>
                <Label>{t('settings.scan_mode_label', 'Stock count scan mode')}</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.stock_count_scan_mode ?? "prompt"}
                  onChange={(e) => set({ stock_count_scan_mode: e.target.value })}
                >
                  <option value="prompt">{t('settings.scan_mode_prompt', 'Prompt for quantity after each scan')}</option>
                  <option value="increment">{t('settings.scan_mode_increment', 'Increment by +1 on every scan')}</option>
                </select>
                <div className="text-xs text-muted-foreground mt-1">
                  {t('settings.scan_mode_hint', 'Prompt is safer; increment is faster when counting one unit at a time.')}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('settings.expiring_soon_label', 'Expiring soon (days)')}</Label>
                <Input
                  type="number" min={1} max={365} step={1}
                  value={form.expiring_soon_days ?? 30}
                  onChange={(e) => set({ expiring_soon_days: Math.max(1, Number(e.target.value) || 30) })}
                />
                <div className="text-xs text-muted-foreground mt-1">{t('settings.expiring_soon_hint', 'Batches within this many days are flagged "Expiring soon".')}</div>
              </div>
              <div>
                <Label>{t('settings.critical_days_label', 'Critical (days)')}</Label>
                <Input
                  type="number" min={1} max={365} step={1}
                  value={form.critical_days ?? 7}
                  onChange={(e) => set({ critical_days: Math.max(1, Number(e.target.value) || 7) })}
                />
                <div className="text-xs text-muted-foreground mt-1">{t('settings.critical_days_hint', 'Batches within this many days show a critical alert.')}</div>
              </div>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <div className="font-medium">{t('settings.language_heading', 'Application Language')}</div>
              <div className="text-xs text-muted-foreground">{t('settings.language_hint', 'Select the primary language for the software interface.')}</div>
            </div>
            <div className="max-w-[200px]">
              <LanguageSelect className="w-full justify-start border" />
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <div className="font-medium">{t('settings.ops_heading', 'Business Operations')}</div>
              <div className="text-xs text-muted-foreground">
                {t('settings.ops_hint', 'Optional shift management, cash drawer and daily operations. When Shift Management is off, POS behaves exactly like today with zero extra queries.')}
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {([
                ["ops_shift_enabled", "ops_shift_enabled_label", "ops_shift_enabled_hint", "Enable shift management", "Cashiers can open/close shifts, run X/Z reports."],
                ["ops_require_manager_approval", "ops_manager_approval_label", "ops_manager_approval_hint", "Require manager approval on close", "Cashier close is 'closed'; admin must approve."],
                ["ops_allow_multiple_shifts", "ops_multi_shift_label", "ops_multi_shift_hint", "Allow multiple concurrent shifts per cashier", "Otherwise one open shift per cashier at a time."],
                ["ops_cash_drawer_enabled", "ops_cash_drawer_label", "ops_cash_drawer_hint", "Cash drawer tracking (Phase 2)", "Track expected vs actual drawer cash."],
                ["ops_safe_drop_enabled", "ops_safe_drop_label", "ops_safe_drop_hint", "Safe drop (Phase 2)", "Record cash removed from drawer."],
                ["ops_paid_in_out_enabled", "ops_paid_in_out_label", "ops_paid_in_out_hint", "Paid in / Paid out (Phase 2)", "Non-sale drawer movements."],
                ["ops_shift_notes_enabled", "ops_shift_notes_label", "ops_shift_notes_hint", "Shift notes (Phase 2)", "Cashier can log operational notes."],
                ["ops_pending_tasks_enabled", "ops_pending_tasks_label", "ops_pending_tasks_hint", "Pending tasks (Phase 2)", "Operational tasks visible until completed."],
                ["ops_receipt_reprint_enabled", "ops_reprint_audit_label", "ops_reprint_audit_hint", "Receipt reprint audit (Phase 2)", "Log every receipt reprint."],
              ] as const).map(([k, labelKey, hintKey, labelFallback, hintFallback]) => (
                <label key={k} className="flex items-start justify-between gap-3 rounded border p-2 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{t(`settings.${labelKey}`, labelFallback)}</div>
                    <div className="text-xs text-muted-foreground">{t(`settings.${hintKey}`, hintFallback)}</div>
                  </div>
                  <Switch checked={!!form[k]} onCheckedChange={(v) => set({ [k]: v })} />
                </label>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <Label>{t('settings.business_day_start_label', 'Business day starts at')}</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={String(form.ops_business_day_start_hour ?? 0)}
                  onChange={(e) => set({ ops_business_day_start_hour: Number(e.target.value) })}
                >
                  <option value="0">12:00 AM (midnight)</option>
                  <option value="1">1:00 AM</option>
                  <option value="2">2:00 AM</option>
                  <option value="3">3:00 AM</option>
                  <option value="4">4:00 AM</option>
                  <option value="5">5:00 AM</option>
                  <option value="6">6:00 AM</option>
                </select>
                <div className="text-xs text-muted-foreground mt-1">{t('settings.business_day_start_hint', 'Sales after midnight but before this hour count for the previous business day.')}</div>
              </div>
            </div>
          </Card>




          <Card className="p-5 space-y-4">
            <div className="font-medium">{t('settings.receipt_layout_heading', 'Receipt layout')}</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{t('settings.paper_width_label', 'Paper width')}</Label>
                <Select value={form.paper_width ?? "80mm"} onValueChange={(v) => set({ paper_width: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58mm">{t('settings.paper_58mm', '58 mm (thermal)')}</SelectItem>
                    <SelectItem value="80mm">{t('settings.paper_80mm', '80 mm (thermal)')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t('settings.logo_url_label', 'Logo URL')}</Label>
                <Input value={form.logo_url ?? ""} onChange={(e) => set({ logo_url: e.target.value })} placeholder={t('settings.logo_url_placeholder', 'https://…/logo.png')} />
              </div>
            </div>
            <div>
              <Label>{t('settings.header_text_label', 'Header text')}</Label>
              <Textarea rows={2} value={form.receipt_header ?? ""} onChange={(e) => set({ receipt_header: e.target.value })} placeholder={t('settings.header_text_placeholder', 'Optional text under store info')} />
            </div>
            <div>
              <Label>{t('settings.footer_text_label', 'Footer text')}</Label>
              <Textarea rows={2} value={form.receipt_footer ?? ""} onChange={(e) => set({ receipt_footer: e.target.value })} placeholder={t('settings.footer_text_placeholder', 'Return policy, thank-you note, etc.')} />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                ["show_logo", "show_logo"],
                ["show_address", "show_address"],
                ["show_phone", "show_phone"],
                ["show_tax_id", "show_tax_id"],
                ["show_tax_lines", "show_tax_lines"],
                ["show_cashier", "show_cashier"],
              ].map(([k, labelKey]) => (
                <label key={k} className="flex items-center justify-between rounded border p-2 text-sm">
                  <span>{t(`settings.${labelKey}`, labelKey)}</span>
                  <Switch checked={!!form[k]} onCheckedChange={(v) => set({ [k]: v })} />
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <div className="font-medium">{t('settings.print_prompt_heading', 'Post-sale print prompt')}</div>
              <div className="text-xs text-muted-foreground">
                {t('settings.print_prompt_hint', 'After completing a sale, ask the cashier whether to print the receipt. Pressing Enter picks the default below.')}
              </div>
            </div>
            <label className="flex items-center justify-between rounded border p-2 text-sm">
              <span>{t('settings.print_prompt_switch_label', 'Show Yes/No print prompt after each sale')}</span>
              <Switch
                checked={form.pos_print_prompt_enabled !== false}
                onCheckedChange={(v) => set({ pos_print_prompt_enabled: v })}
              />
            </label>
            <div>
              <Label>{t('settings.default_action_label', 'Default action (Enter key)')}</Label>
              <Select
                value={form.pos_print_prompt_default ?? "yes"}
                onValueChange={(v) => set({ pos_print_prompt_default: v })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="yes">{t('settings.print_yes', 'Yes — print receipt')}</SelectItem>
                  <SelectItem value="no">{t('settings.print_no', 'No — skip printing')}</SelectItem>
                </SelectContent>
              </Select>
              <div className="text-xs text-muted-foreground mt-1">
                {t('settings.default_action_hint', 'When the prompt is off, this default runs automatically after every sale.')}
              </div>
            </div>
          </Card>


          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{t('settings.qr_heading', 'Payment QR code')}</div>
                <div className="text-xs text-muted-foreground">{t('settings.qr_hint', 'Prints on receipt so customers can scan & pay (bank / EasyPaisa / JazzCash etc.)')}</div>
              </div>
              <Switch checked={!!form.show_payment_qr} onCheckedChange={(v) => set({ show_payment_qr: v })} />
            </div>
            <div>
              <Label>{t('settings.qr_url_label', 'QR image URL')}</Label>
              <Input
                value={form.payment_qr_url ?? ""}
                onChange={(e) => set({ payment_qr_url: e.target.value })}
                placeholder={t('settings.qr_url_placeholder', 'https://…/my-bank-qr.png')}
              />
              <p className="text-xs text-muted-foreground mt-1">{t('settings.qr_upload_hint', 'Upload your QR image anywhere public (or use the Backend storage) and paste the link here.')}</p>
            </div>
            <div>
              <Label>{t('settings.qr_label_label', 'Label / account details')}</Label>
              <Textarea
                rows={2}
                value={form.payment_qr_label ?? ""}
                onChange={(e) => set({ payment_qr_label: e.target.value })}
                placeholder={t('settings.qr_label_placeholder', 'e.g. Meezan Bank · Ali Traders · 1234-5678-9012')}
              />
            </div>
            {form.payment_qr_url && (
              <div className="flex items-center gap-3 rounded border bg-muted/30 p-2">
                <img src={form.payment_qr_url} alt="QR preview" className="h-20 w-20 object-contain bg-white p-1 rounded" />
                <div className="text-xs text-muted-foreground whitespace-pre-line">{form.payment_qr_label || t('settings.qr_preview_fallback', 'Preview')}</div>
              </div>
            )}
          </Card>

          <OfflineModeCard />

          <Button onClick={save}><Save className="h-4 w-4 mr-2" />{t('settings.save_settings', 'Save settings')}</Button>
        </div>


        <div className="space-y-2">
          <div className="text-sm font-medium">{t('settings.live_preview_label', 'Live receipt preview')}</div>
          <div className="rounded-lg border bg-muted/30 p-4 overflow-auto">
            <Receipt invoice={sampleInvoice} settings={form} />
          </div>
          <p className="text-xs text-muted-foreground">{t('settings.live_preview_hint', 'Preview uses sample data. Changes appear instantly; click Save to apply.')}</p>
        </div>
      </div>
    </div>
  );
}
