import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
] as const;


function Page() {
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
    store_name: "", currency: "USD", currency_symbol: "$", tax_rate: 0,
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
    if (!data?.id) return toast.error("Store settings not ready — please refresh.");
    const payload: any = {};
    for (const k of FIELDS) payload[k] = form[k];
    // RLS ensures we can only update our own tenant's row; scope by id for safety.
    const { error } = await supabase.from("store_settings").update(payload).eq("id", data.id);
    if (error) return toast.error("Couldn't save settings. Please try again.", { description: error.message });
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["store_settings"] });
  };

  return (
    <div className="p-6 max-w-6xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Store & receipt settings</h1>
        <p className="text-sm text-muted-foreground">Configure store info, taxes and the printed receipt layout.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4">
        <div className="space-y-4">
          <Card className="p-5 space-y-4">
            <div className="font-medium">Store</div>
            <div><Label>Store name</Label><Input value={form.store_name ?? ""} onChange={(e) => set({ store_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Currency code</Label><Input value={form.currency ?? ""} onChange={(e) => set({ currency: e.target.value })} placeholder="USD / PKR / EUR…" /></div>
              <div><Label>Currency symbol</Label><Input value={form.currency_symbol ?? ""} onChange={(e) => set({ currency_symbol: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Default tax rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate ?? 0} onChange={(e) => set({ tax_rate: Number(e.target.value) })} /></div>
              <div><Label>Tax ID / VAT #</Label><Input value={form.tax_id ?? ""} onChange={(e) => set({ tax_id: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} /></div>
              <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => set({ address: e.target.value })} /></div>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div>
              <div className="font-medium">POS behaviour</div>
              <div className="text-xs text-muted-foreground">Controls how long a cashier can undo a just-completed sale (Ctrl+Z / F10).</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Undo window (minutes)</Label>
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
                <Label>Stock count scan mode</Label>
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.stock_count_scan_mode ?? "prompt"}
                  onChange={(e) => set({ stock_count_scan_mode: e.target.value })}
                >
                  <option value="prompt">Prompt for quantity after each scan</option>
                  <option value="increment">Increment by +1 on every scan</option>
                </select>
                <div className="text-xs text-muted-foreground mt-1">
                  Prompt is safer; increment is faster when counting one unit at a time.
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Expiring soon (days)</Label>
                <Input
                  type="number" min={1} max={365} step={1}
                  value={form.expiring_soon_days ?? 30}
                  onChange={(e) => set({ expiring_soon_days: Math.max(1, Number(e.target.value) || 30) })}
                />
                <div className="text-xs text-muted-foreground mt-1">Batches within this many days are flagged "Expiring soon".</div>
              </div>
              <div>
                <Label>Critical (days)</Label>
                <Input
                  type="number" min={1} max={365} step={1}
                  value={form.critical_days ?? 7}
                  onChange={(e) => set({ critical_days: Math.max(1, Number(e.target.value) || 7) })}
                />
                <div className="text-xs text-muted-foreground mt-1">Batches within this many days show a critical alert.</div>
              </div>
            </div>
          </Card>


          <Card className="p-5 space-y-4">
            <div className="font-medium">Receipt layout</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Paper width</Label>
                <Select value={form.paper_width ?? "80mm"} onValueChange={(v) => set({ paper_width: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="58mm">58 mm (thermal)</SelectItem>
                    <SelectItem value="80mm">80 mm (thermal)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Logo URL</Label>
                <Input value={form.logo_url ?? ""} onChange={(e) => set({ logo_url: e.target.value })} placeholder="https://…/logo.png" />
              </div>
            </div>
            <div>
              <Label>Header text</Label>
              <Textarea rows={2} value={form.receipt_header ?? ""} onChange={(e) => set({ receipt_header: e.target.value })} placeholder="Optional text under store info" />
            </div>
            <div>
              <Label>Footer text</Label>
              <Textarea rows={2} value={form.receipt_footer ?? ""} onChange={(e) => set({ receipt_footer: e.target.value })} placeholder="Return policy, thank-you note, etc." />
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2">
              {[
                ["show_logo", "Show logo"],
                ["show_address", "Show address"],
                ["show_phone", "Show phone"],
                ["show_tax_id", "Show tax ID"],
                ["show_tax_lines", "Show tax lines"],
                ["show_cashier", "Show cashier"],
              ].map(([k, label]) => (
                <label key={k} className="flex items-center justify-between rounded border p-2 text-sm">
                  <span>{label}</span>
                  <Switch checked={!!form[k]} onCheckedChange={(v) => set({ [k]: v })} />
                </label>
              ))}
            </div>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">Payment QR code</div>
                <div className="text-xs text-muted-foreground">Prints on receipt so customers can scan & pay (bank / EasyPaisa / JazzCash etc.)</div>
              </div>
              <Switch checked={!!form.show_payment_qr} onCheckedChange={(v) => set({ show_payment_qr: v })} />
            </div>
            <div>
              <Label>QR image URL</Label>
              <Input
                value={form.payment_qr_url ?? ""}
                onChange={(e) => set({ payment_qr_url: e.target.value })}
                placeholder="https://…/my-bank-qr.png"
              />
              <p className="text-xs text-muted-foreground mt-1">Upload your QR image anywhere public (or use the Backend storage) and paste the link here.</p>
            </div>
            <div>
              <Label>Label / account details</Label>
              <Textarea
                rows={2}
                value={form.payment_qr_label ?? ""}
                onChange={(e) => set({ payment_qr_label: e.target.value })}
                placeholder="e.g. Meezan Bank · Ali Traders · 1234-5678-9012"
              />
            </div>
            {form.payment_qr_url && (
              <div className="flex items-center gap-3 rounded border bg-muted/30 p-2">
                <img src={form.payment_qr_url} alt="QR preview" className="h-20 w-20 object-contain bg-white p-1 rounded" />
                <div className="text-xs text-muted-foreground whitespace-pre-line">{form.payment_qr_label || "Preview"}</div>
              </div>
            )}
          </Card>

          <Button onClick={save}><Save className="h-4 w-4 mr-2" />Save settings</Button>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Live receipt preview</div>
          <div className="rounded-lg border bg-muted/30 p-4 overflow-auto">
            <Receipt invoice={sampleInvoice} settings={form} />
          </div>
          <p className="text-xs text-muted-foreground">Preview uses sample data. Changes appear instantly; click Save to apply.</p>
        </div>
      </div>
    </div>
  );
}
