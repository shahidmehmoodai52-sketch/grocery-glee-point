import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, KeyRound, Trash2, Shield, Save, Copy, Store as StoreIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { ALL_PERMS } from "@/hooks/use-permissions";
import {
  getMyShopInfo, listShopStaff, createShopStaff,
  resetShopStaffPassword, setShopStaffPerms, deleteShopStaff,
} from "@/lib/shop-admin.functions";

export const Route = createFileRoute("/_authenticated/shop-admin")({ component: Page });

function Page() {
  const info = useServerFn(getMyShopInfo);
  const { data: shop, isLoading, error, refetch } = useQuery({
    queryKey: ["my-shop-info"],
    queryFn: () => (info as any)(),
    retry: 1,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading shop…</div>;
  }
  if (error) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <h2 className="text-lg font-semibold">Couldn't load shop</h2>
        <p className="text-sm text-muted-foreground break-words">{(error as any)?.message ?? String(error)}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }
  if (!shop) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <h2 className="text-lg font-semibold">No shop found</h2>
        <p className="text-sm text-muted-foreground">Your account isn't linked to a shop yet.</p>
      </div>
    );
  }
  if (!shop.is_owner) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-2">
        <Shield className="h-8 w-8 mx-auto text-muted-foreground" />
        <h2 className="text-lg font-semibold">Owners only</h2>
        <p className="text-sm text-muted-foreground">Only the shop owner can manage staff and settings.</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-md bg-primary/10 text-primary">
          <StoreIcon className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{shop.name}</h1>
          <div className="text-sm text-muted-foreground">
            Status: <Badge variant={shop.status === "active" ? "default" : "secondary"}>{shop.status}</Badge> · Plan: <span className="font-medium">{shop.plan}</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="access">Shop code</TabsTrigger>
          <TabsTrigger value="plan">Subscription</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4">
          <StaffTab shopCode={shop.code} />
        </TabsContent>

        <TabsContent value="access" className="mt-4">
          <ShopCodeCard code={shop.code} />
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <Card className="p-4 space-y-2">
            <div className="text-sm">Current plan: <strong>{shop.plan}</strong></div>
            <div className="text-sm">Status: <strong>{shop.status}</strong></div>
            <p className="text-xs text-muted-foreground">To change your plan or renew, contact the developer.</p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShopCodeCard({ code }: { code: string }) {
  return (
    <Card className="p-4 space-y-3">
      <div>
        <Label>Your shop code</Label>
        <div className="flex gap-2 items-center mt-1">
          <Input readOnly value={code} className="font-mono max-w-xs" />
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(code); toast.success("Copied"); }}>
            <Copy className="h-3.5 w-3.5 mr-1" />Copy
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Cashiers sign in on the login page using <strong>Shop Staff</strong>: shop code + username + password. Share this code with your staff only.
      </p>
    </Card>
  );
}

function StaffTab({ shopCode }: { shopCode: string }) {
  const qc = useQueryClient();
  const list = useServerFn(listShopStaff);
  const create = useServerFn(createShopStaff);
  const reset = useServerFn(resetShopStaffPassword);
  const del = useServerFn(deleteShopStaff);

  const { data: users = [], isLoading } = useQuery({ queryKey: ["shop-staff"], queryFn: () => (list as any)() });
  const refresh = () => qc.invalidateQueries({ queryKey: ["shop-staff"] });

  const [newOpen, setNewOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [pwd, setPwd] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");
  const [perms, setPerms] = useState<string[]>([]);
  const toggle = (k: string) => setPerms((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const createMut = useMutation({
    mutationFn: () => create({ data: { username, password: pwd, role, perms } }),
    onSuccess: () => {
      toast.success("Cashier created");
      setNewOpen(false); setUsername(""); setPwd(""); setPerms([]); setRole("cashier");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          Your staff sign in with <strong>username + password</strong> (no email needed).
          Share your shop code <span className="font-mono">{shopCode}</span> so they can find your shop on the login page.
        </p>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild><Button><UserPlus className="h-4 w-4 mr-2" />Add staff</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add staff account</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Username</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} placeholder="e.g. raza" />
                <p className="text-[11px] text-muted-foreground mt-1">Lowercase letters, numbers, . _ - only</p>
              </div>
              <div>
                <Label>Password</Label>
                <Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="min 6 chars" />
              </div>
              <div>
                <Label>Role</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" size="sm" variant={role === "cashier" ? "default" : "outline"} onClick={() => setRole("cashier")}>Cashier</Button>
                  <Button type="button" size="sm" variant={role === "admin" ? "default" : "outline"} onClick={() => setRole("admin")}>Admin (full access)</Button>
                </div>
              </div>
              {role === "cashier" && (() => {
                const selectable = ALL_PERMS.filter((p) => p.key !== "sales");
                const allOn = selectable.every((p) => perms.includes(p.key));
                return (
                  <div>
                    <div className="flex justify-between items-center">
                      <Label className="text-sm">Allowed sections (POS & Sales always allowed)</Label>
                      <Button type="button" size="sm" variant="outline" onClick={() => setPerms(allOn ? [] : selectable.map((p) => p.key))}>
                        {allOn ? "Clear all" : "Access all"}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3 rounded border max-h-64 overflow-auto mt-2">
                      {selectable.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                          {p.label}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !username || pwd.length < 6}>
                {createMut.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Username</TableHead><TableHead>Role</TableHead><TableHead>Allowed sections</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Loading…</TableCell></TableRow>}
            {users.map((u: any) => <StaffRow key={u.id} u={u} reset={reset} del={del} refresh={refresh} />)}
            {!isLoading && users.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">No staff yet. Click "Add staff" to create your first cashier.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StaffRow({ u, reset, del, refresh }: any) {
  const setPermsFn = useServerFn(setShopStaffPerms);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">(u.role === "admin" ? "admin" : "cashier");
  const [perms, setPerms] = useState<string[]>(u.perms);
  const toggle = (k: string) => setPerms((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const saveMut = useMutation({
    mutationFn: () => setPermsFn({ data: { user_id: u.id, role, perms } }),
    onSuccess: () => { toast.success("Access updated"); setEditOpen(false); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const resetMut = useMutation({
    mutationFn: () => reset({ data: { user_id: u.id, password: newPwd } }),
    onSuccess: () => { toast.success("Password updated"); setResetOpen(false); setNewPwd(""); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { user_id: u.id } }),
    onSuccess: () => { toast.success("Removed"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <TableRow>
      <TableCell className="font-medium">
        {u.username}
        {u.is_owner && <Badge variant="outline" className="ml-2 text-[10px]">You (owner)</Badge>}
      </TableCell>
      <TableCell><Badge variant={u.role === "admin" || u.role === "super_admin" ? "default" : "secondary"}>{u.role}</Badge></TableCell>
      <TableCell className="max-w-md">
        {u.role !== "cashier" ? <span className="text-xs text-muted-foreground">Full access</span> : (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">pos</Badge>
            <Badge variant="outline" className="text-[10px]">sales</Badge>
            {u.perms.map((p: string) => <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>)}
            {u.perms.length === 0 && <span className="text-xs text-muted-foreground">No extras</span>}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right space-x-1">
        {!u.is_owner && (
          <>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Shield className="h-3.5 w-3.5 mr-1" />Access</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>Edit access — {u.username}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>Role</Label>
                    <div className="flex gap-2 mt-1">
                      <Button type="button" size="sm" variant={role === "cashier" ? "default" : "outline"} onClick={() => setRole("cashier")}>Cashier</Button>
                      <Button type="button" size="sm" variant={role === "admin" ? "default" : "outline"} onClick={() => setRole("admin")}>Admin</Button>
                    </div>
                  </div>
                  {role === "cashier" && (() => {
                    const selectable = ALL_PERMS.filter((p) => p.key !== "sales");
                    const allOn = selectable.every((p) => perms.includes(p.key));
                    return (
                      <div>
                        <div className="flex justify-between items-center">
                          <Label className="text-sm">Allowed sections</Label>
                          <Button type="button" size="sm" variant="outline" onClick={() => setPerms(allOn ? [] : selectable.map((p) => p.key))}>
                            {allOn ? "Clear all" : "Access all"}
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 p-3 rounded border max-h-64 overflow-auto mt-2">
                          {selectable.map((p) => (
                            <label key={p.key} className="flex items-center gap-2 text-sm">
                              <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                              {p.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button>
                  <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}><Save className="h-4 w-4 mr-1" />Save</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={resetOpen} onOpenChange={setResetOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><KeyRound className="h-3.5 w-3.5 mr-1" />Password</Button></DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>Set new password for {u.username}</DialogTitle></DialogHeader>
                <Input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="min 6 chars" />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
                  <Button onClick={() => resetMut.mutate()} disabled={resetMut.isPending || newPwd.length < 6}>Update</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Remove ${u.username}?`)) delMut.mutate(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}
