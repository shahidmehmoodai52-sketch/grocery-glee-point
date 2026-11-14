// Admin → Offline licenses: issue a renewal code for a shop's offline
// desktop PC (Tillix POS Offline). The shop reads its Machine ID and shop
// code off the exe's license screen and sends them here (e.g. WhatsApp);
// the code is signed server-side (/api/offline-license/renew).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Copy, KeyRound, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export function OfflineLicensesPanel() {
  const [search, setSearch] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [machineId, setMachineId] = useState("");
  const [expires, setExpires] = useState(inDays(30));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ code: string; shop: string; shopCode: string | null; machineId: string; expiresAt: string } | null>(null);

  const term = search.trim();
  const { data: shops = [] } = useQuery({
    queryKey: ["admin-offline-license-shops", term],
    enabled: term.length > 0,
    queryFn: async () => {
      const q = supabase.from("tenants").select("id, name, shop_code, status").order("name").limit(20);
      const { data, error } = /^\d{1,5}$/.test(term) ? await q.eq("shop_code", term.padStart(3, "0")) : await q.ilike("name", `%${term}%`);
      if (error) throw error;
      return data ?? [];
    },
  });
  const picked = (shops as any[]).find((s) => s.id === tenantId);

  const issue = async () => {
    if (!tenantId) return toast.error("Pick the shop");
    setBusy(true);
    setResult(null);
    try {
      const { data: s } = await supabase.auth.getSession();
      const res = await fetch("/api/offline-license/renew", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${s.session?.access_token ?? ""}` },
        // End of the chosen day, shop's local time.
        body: JSON.stringify({ tenantId, machineId, expiresAt: new Date(`${expires}T23:59:59`).toISOString() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Failed (${res.status})`);
      setResult(body);
      toast.success("Renewal code issued");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not issue the code");
    } finally {
      setBusy(false);
    }
  };

  const message = result
    ? `Tillix POS Offline renewal code for ${result.shop} (Machine ID ${result.machineId}), valid until ${new Date(result.expiresAt).toLocaleDateString()}:\n\n${result.code}\n\nOpen Tillix POS Offline → paste this code → Apply code.`
    : "";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2"><KeyRound className="h-4 w-4" />Offline desktop licenses</CardTitle>
        <CardDescription>
          Issue a renewal code for a shop's Tillix POS Offline PC. Ask the shop for the <b>Machine ID</b> and <b>shop code</b> shown on its license screen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 max-w-xl">
        <div>
          <Label>Shop (name or shop code)</Label>
          <Input value={search} onChange={(e) => { setSearch(e.target.value); setTenantId(""); }} placeholder="e.g. Hafiz or 023" />
          {term && !tenantId && (
            <div className="mt-1 max-h-48 overflow-auto rounded border">
              {(shops as any[]).length === 0 && <div className="px-3 py-2 text-sm text-muted-foreground">No shop found</div>}
              {(shops as any[]).map((s) => (
                <button key={s.id} type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => { setTenantId(s.id); setSearch(s.name); }}>
                  {s.name} <span className="text-muted-foreground">· code {s.shop_code ?? "—"} · {s.status}</span>
                </button>
              ))}
            </div>
          )}
          {picked && <div className="mt-1 text-xs text-muted-foreground">Selected: {picked.name} (code {picked.shop_code ?? "—"})</div>}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Machine ID</Label>
            <Input value={machineId} onChange={(e) => setMachineId(e.target.value.toUpperCase())} placeholder="ABCD-EFGH-JKLM" className="font-mono" />
          </div>
          <div>
            <Label>Valid until</Label>
            <Input type="date" value={expires} min={inDays(1)} onChange={(e) => setExpires(e.target.value)} />
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          {[30, 90, 365].map((d) => (
            <Button key={d} type="button" size="sm" variant="outline" onClick={() => setExpires(inDays(d))}>+{d} days</Button>
          ))}
        </div>
        <Button onClick={issue} disabled={busy || !tenantId || !machineId}>{busy ? "Issuing…" : "Issue renewal code"}</Button>
        {result && (
          <div className="space-y-2">
            <Label>Renewal code — {result.shop}, until {new Date(result.expiresAt).toLocaleDateString()}</Label>
            <textarea readOnly value={result.code} className="w-full h-28 rounded border p-2 font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(result.code); toast.success("Code copied"); }}>
                <Copy className="h-4 w-4 mr-1" />Copy code
              </Button>
              <Button type="button" variant="outline" size="sm" asChild>
                <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4 mr-1" />Send on WhatsApp</a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
