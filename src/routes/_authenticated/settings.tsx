import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/settings")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["store_settings"],
    queryFn: async () => (await supabase.from("store_settings").select("*").eq("id", 1).maybeSingle()).data,
  });
  const [form, setForm] = useState<any>({
    store_name: "", currency: "USD", currency_symbol: "$", tax_rate: 0, address: "", phone: "",
  });
  useEffect(() => { if (data) setForm(data); }, [data]);

  const save = async () => {
    const { error } = await supabase.from("store_settings").update({
      store_name: form.store_name, currency: form.currency, currency_symbol: form.currency_symbol,
      tax_rate: form.tax_rate, address: form.address, phone: form.phone,
    }).eq("id", 1);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["store_settings"] });
  };

  return (
    <div className="p-6 max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Store settings</h1>
        <p className="text-sm text-muted-foreground">Configure currency, tax and store info shown on invoices.</p>
      </div>

      <Card className="p-5 space-y-4">
        <div><Label>Store name</Label><Input value={form.store_name ?? ""} onChange={(e) => setForm({ ...form, store_name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Currency code</Label><Input value={form.currency ?? ""} onChange={(e) => setForm({ ...form, currency: e.target.value })} placeholder="USD / PKR / EUR…" /></div>
          <div><Label>Currency symbol</Label><Input value={form.currency_symbol ?? ""} onChange={(e) => setForm({ ...form, currency_symbol: e.target.value })} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Default tax rate (%)</Label><Input type="number" step="0.01" value={form.tax_rate ?? 0} onChange={(e) => setForm({ ...form, tax_rate: Number(e.target.value) })} /></div>
          <div><Label>Phone</Label><Input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
        </div>
        <div><Label>Address</Label><Input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>

        <Button onClick={save}><Save className="h-4 w-4 mr-2" />Save</Button>
      </Card>
    </div>
  );
}
