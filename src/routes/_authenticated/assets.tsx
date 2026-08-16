import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Box, Wallet, Layers, Package, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { usePermissions } from "@/hooks/use-permissions";
import { fmtMoney, fmtQty } from "@/lib/format";
import { roundToTillixQty } from "@/lib/quantity-rounding";

export const Route = createFileRoute("/_authenticated/assets")({
  component: Page,
  head: () => ({
    meta: [
      { title: "Shop Assets — Tillix POS" },
      { name: "description", content: "Track fixed assets like shelves, AC, fridge, and solar. See your shop's total worth at one click." },
    ],
  }),
});

type Category = { id: string; name: string; icon?: string | null; notes?: string | null };
type Asset = {
  id: string;
  category_id: string | null;
  name: string;
  brand: string | null;
  model_number: string | null;
  serial_number: string | null;
  quantity: number;
  purchase_date: string | null;
  purchase_price: number;
  current_value: number;
  condition: string;
  location: string | null;
  warranty_expiry: string | null;
  supplier: string | null;
  image_url: string | null;
  notes: string | null;
  asset_categories?: { name: string } | null;
};

const CONDITIONS = ["new", "good", "fair", "needs-repair", "retired"] as const;

const emptyAsset = {
  category_id: "",
  name: "",
  brand: "",
  model_number: "",
  serial_number: "",
  quantity: 1,
  purchase_date: "",
  purchase_price: 0,
  current_value: 0,
  condition: "good",
  location: "",
  warranty_expiry: "",
  supplier: "",
  image_url: "",
  notes: "",
};

function Page() {
  const qc = useQueryClient();
  const { data: settings } = useSettings();
  const sym = settings?.currency_symbol ?? "Rs";
  const { isAdmin } = usePermissions();

  const [assetOpen, setAssetOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...emptyAsset });

  const [catOpen, setCatOpen] = useState(false);
  const [cat, setCat] = useState({ name: "", icon: "", notes: "" });

  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState<string>("all");

  const catsQ = useQuery<Category[]>({
    queryKey: ["asset_categories"],
    queryFn: async () => (await supabase.from("asset_categories").select("*").order("name")).data ?? [],
  });

  const assetsQ = useQuery<Asset[]>({
    queryKey: ["assets"],
    queryFn: async () =>
      (await supabase
        .from("assets")
        .select("*, asset_categories(name)")
        .order("created_at", { ascending: false })).data as any ?? [],
  });

  // Stock worth (from products) so shop's total worth can be shown at one click.
  const stockQ = useQuery<{ worth: number; count: number }>({
    queryKey: ["assets-stock-worth"],
    queryFn: async () => {
      const { data } = await supabase
        .from("products")
        .select("stock,cost_price,sell_price,is_active")
        .eq("is_active", true);
      const rows = (data ?? []) as any[];
      const worth = rows.reduce(
        (s, r) => s + Number(r.stock ?? 0) * Number(r.cost_price ?? r.sell_price ?? 0),
        0,
      );
      return { worth, count: rows.length };
    },
  });

  const filtered = useMemo(() => {
    const rows = assetsQ.data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filterCat !== "all" && r.category_id !== filterCat) return false;
      if (!q) return true;
      return (
        r.name?.toLowerCase().includes(q) ||
        r.brand?.toLowerCase().includes(q) ||
        r.model_number?.toLowerCase().includes(q) ||
        r.serial_number?.toLowerCase().includes(q) ||
        r.location?.toLowerCase().includes(q)
      );
    });
  }, [assetsQ.data, search, filterCat]);

  const totals = useMemo(() => {
    const rows = assetsQ.data ?? [];
    const purchase = rows.reduce((s, r) => s + Number(r.purchase_price) * Number(r.quantity || 1), 0);
    const current = rows.reduce((s, r) => s + Number(r.current_value) * Number(r.quantity || 1), 0);
    const count = rows.reduce((s, r) => s + Number(r.quantity || 1), 0);
    return { purchase, current, count, entries: rows.length };
  }, [assetsQ.data]);

  const shopWorth = totals.current + (stockQ.data?.worth ?? 0);

  const openNew = () => {
    setEditingId(null);
    setForm({ ...emptyAsset });
    setAssetOpen(true);
  };
  const openEdit = (a: Asset) => {
    setEditingId(a.id);
    setForm({
      category_id: a.category_id ?? "",
      name: a.name,
      brand: a.brand ?? "",
      model_number: a.model_number ?? "",
      serial_number: a.serial_number ?? "",
      quantity: a.quantity,
      purchase_date: a.purchase_date ?? "",
      purchase_price: a.purchase_price,
      current_value: a.current_value,
      condition: a.condition,
      location: a.location ?? "",
      warranty_expiry: a.warranty_expiry ?? "",
      supplier: a.supplier ?? "",
      image_url: a.image_url ?? "",
      notes: a.notes ?? "",
    });
    setAssetOpen(true);
  };

  const saveAsset = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    const payload: any = {
      ...form,
      category_id: form.category_id || null,
      purchase_date: form.purchase_date || null,
      warranty_expiry: form.warranty_expiry || null,
      quantity: Number(form.quantity) || 1,
      purchase_price: Number(form.purchase_price) || 0,
      current_value: Number(form.current_value) || Number(form.purchase_price) || 0,
    };
    let err;
    if (editingId) {
      const { error } = await supabase.from("assets").update(payload).eq("id", editingId);
      err = error;
    } else {
      const { error } = await supabase.from("assets").insert(payload);
      err = error;
    }
    if (err) { toast.error(err.message); return; }
    toast.success(editingId ? "Asset updated" : "Asset added");
    setAssetOpen(false);
    qc.invalidateQueries({ queryKey: ["assets"] });
  };

  const removeAsset = async (id: string) => {
    if (!confirm("Delete this asset?")) return;
    const { error } = await supabase.from("assets").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["assets"] });
  };

  const saveCategory = async () => {
    if (!cat.name.trim()) { toast.error("Category name required"); return; }
    const { error } = await supabase.from("asset_categories").insert({
      name: cat.name.trim(),
      icon: cat.icon || null,
      notes: cat.notes || null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Category added");
    setCat({ name: "", icon: "", notes: "" });
    setCatOpen(false);
    qc.invalidateQueries({ queryKey: ["asset_categories"] });
  };

  const removeCategory = async (id: string) => {
    if (!confirm("Delete this category? Assets will remain but become uncategorised.")) return;
    const { error } = await supabase.from("asset_categories").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    qc.invalidateQueries({ queryKey: ["asset_categories"] });
    qc.invalidateQueries({ queryKey: ["assets"] });
  };

  // Aggregation by category (for the summary tab)
  const byCategory = useMemo(() => {
    const map = new Map<string, { name: string; count: number; worth: number }>();
    for (const a of assetsQ.data ?? []) {
      const key = a.category_id ?? "__uncat";
      const name = a.asset_categories?.name ?? "Uncategorised";
      const cur = map.get(key) ?? { name, count: 0, worth: 0 };
      cur.count += Number(a.quantity || 1);
      cur.worth += Number(a.current_value) * Number(a.quantity || 1);
      map.set(key, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.worth - a.worth);
  }, [assetsQ.data]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Shop Assets</h1>
          <p className="text-sm text-muted-foreground">
            Track shelves, AC, fridge, solar and every fixed item that makes up your shop's worth.
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCatOpen(true)}>
              <Layers className="h-4 w-4 mr-2" /> New category
            </Button>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4 mr-2" /> New asset
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Box} label="Total assets" value={String(totals.count)} sub={`${totals.entries} entries`} />
        <Stat icon={Wallet} label="Asset worth (current)" value={fmtMoney(totals.current, sym)} sub={`Bought at ${fmtMoney(totals.purchase, sym)}`} />
        <Stat icon={Package} label="Stock worth" value={fmtMoney(stockQ.data?.worth ?? 0, sym)} sub={`${stockQ.data?.count ?? 0} products`} />
        <Stat icon={Wallet} label="Shop worth (total)" value={fmtMoney(shopWorth, sym)} sub="Assets + stock" tone="accent" />
      </div>

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">All assets</TabsTrigger>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="summary">By category</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          <Card className="p-3">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="h-4 w-4 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-8"
                  placeholder="Search name, brand, model, serial, location…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterCat} onValueChange={setFilterCat}>
                <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All categories</SelectItem>
                  {(catsQ.data ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Model / Serial</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Purchase</TableHead>
                    <TableHead className="text-right">Current value</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead className="w-24"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                        No assets yet. Click "New asset" to add your first item.
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="font-medium">{a.name}</div>
                        {a.brand && <div className="text-xs text-muted-foreground">{a.brand}</div>}
                      </TableCell>
                      <TableCell>
                        {a.asset_categories?.name
                          ? <Badge variant="secondary">{a.asset_categories.name}</Badge>
                          : <span className="text-xs text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">{a.model_number || "—"}</div>
                        {a.serial_number && <div className="text-xs text-muted-foreground">SN: {a.serial_number}</div>}
                      </TableCell>
                      <TableCell className="text-right">{Number(a.quantity)}</TableCell>
                      <TableCell className="text-right">{fmtMoney(Number(a.purchase_price) * Number(a.quantity || 1), sym)}</TableCell>
                      <TableCell className="text-right font-medium">{fmtMoney(Number(a.current_value) * Number(a.quantity || 1), sym)}</TableCell>
                      <TableCell><Badge variant="outline">{a.condition}</Badge></TableCell>
                      <TableCell className="text-sm">{a.location || "—"}</TableCell>
                      <TableCell>
                        {isAdmin && (
                          <div className="flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => openEdit(a)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button size="icon" variant="ghost" onClick={() => removeAsset(a.id)}>
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="categories">
          <Card className="p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(catsQ.data ?? []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                      No categories yet. Add "Fridge", "AC", "Shelves", "Solar" etc.
                    </TableCell>
                  </TableRow>
                )}
                {(catsQ.data ?? []).map((c) => {
                  const count = (assetsQ.data ?? []).filter((a) => a.category_id === c.id).length;
                  return (
                    <TableRow key={c.id}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.notes || "—"}</TableCell>
                      <TableCell className="text-right">{count}</TableCell>
                      <TableCell>
                        {isAdmin && (
                          <Button size="icon" variant="ghost" onClick={() => removeCategory(c.id)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="summary">
          <Card className="p-3">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-right">Current worth</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byCategory.length === 0 && (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">Nothing to summarise yet.</TableCell></TableRow>
                )}
                {byCategory.map((r) => (
                  <TableRow key={r.name}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.count}</TableCell>
                    <TableCell className="text-right">{fmtMoney(r.worth, sym)}</TableCell>
                  </TableRow>
                ))}
                {byCategory.length > 0 && (
                  <TableRow>
                    <TableCell className="font-semibold">Total</TableCell>
                    <TableCell className="text-right font-semibold">{totals.count}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtMoney(totals.current, sym)}</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Asset dialog */}
      <Dialog open={assetOpen} onOpenChange={setAssetOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit asset" : "New asset"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Name *">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Front display fridge" />
            </Field>
            <Field label="Category">
              <Select value={form.category_id || "__none"} onValueChange={(v) => setForm({ ...form, category_id: v === "__none" ? "" : v })}>
                <SelectTrigger><SelectValue placeholder="Uncategorised" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Uncategorised</SelectItem>
                  {(catsQ.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Brand"><Input value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
            <Field label="Model number"><Input value={form.model_number} onChange={(e) => setForm({ ...form, model_number: e.target.value })} /></Field>
            <Field label="Serial number"><Input value={form.serial_number} onChange={(e) => setForm({ ...form, serial_number: e.target.value })} /></Field>
            <Field label="Quantity"><Input type="number" min={1} value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></Field>
            <Field label="Purchase price (per unit)"><Input type="number" min={0} step="0.01" value={form.purchase_price} onChange={(e) => setForm({ ...form, purchase_price: e.target.value })} /></Field>
            <Field label="Current value (per unit)"><Input type="number" min={0} step="0.01" value={form.current_value} onChange={(e) => setForm({ ...form, current_value: e.target.value })} placeholder="Defaults to purchase price" /></Field>
            <Field label="Purchase date"><Input type="date" value={form.purchase_date} onChange={(e) => setForm({ ...form, purchase_date: e.target.value })} /></Field>
            <Field label="Warranty expiry"><Input type="date" value={form.warranty_expiry} onChange={(e) => setForm({ ...form, warranty_expiry: e.target.value })} /></Field>
            <Field label="Condition">
              <Select value={form.condition} onValueChange={(v) => setForm({ ...form, condition: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONDITIONS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Location"><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="e.g. Storefront" /></Field>
            <Field label="Supplier"><Input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} /></Field>
            <Field label="Image URL"><Input value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} /></Field>
            <div className="md:col-span-2">
              <Label className="text-xs">Notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssetOpen(false)}>Cancel</Button>
            <Button onClick={saveAsset}>{editingId ? "Update" : "Save asset"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Category dialog */}
      <Dialog open={catOpen} onOpenChange={setCatOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New asset category</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Field label="Name *"><Input value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} placeholder="Fridge, AC, Shelves, Solar…" /></Field>
            <Field label="Notes"><Input value={cat.notes} onChange={(e) => setCat({ ...cat, notes: e.target.value })} /></Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCatOpen(false)}>Cancel</Button>
            <Button onClick={saveCategory}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub?: string; tone?: "accent" }) {
  return (
    <Card className={`p-4 ${tone === "accent" ? "border-primary/50 bg-primary/5" : ""}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
