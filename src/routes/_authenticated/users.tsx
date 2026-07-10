import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { UserPlus, KeyRound, Trash2, Shield, Save } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { ALL_PERMS } from "@/hooks/use-permissions";
import { listStaff, createStaff, resetStaffPassword, setStaffPermissions, deleteStaff } from "@/lib/users.functions";

export const Route = createFileRoute("/_authenticated/users")({ component: Page });

function Page() {
  const qc = useQueryClient();
  const list = useServerFn(listStaff);
  const create = useServerFn(createStaff);
  const reset = useServerFn(resetStaffPassword);
  const del = useServerFn(deleteStaff);

  const { data: users = [], isLoading } = useQuery({ queryKey: ["staff"], queryFn: () => (list as any)() });

  const refresh = () => qc.invalidateQueries({ queryKey: ["staff"] });

  const [newOpen, setNewOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [pwd, setPwd] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">("cashier");
  const [perms, setPermsState] = useState<string[]>([]);
  const togglePerm = (k: string) => setPermsState((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const createMut = useMutation({
    mutationFn: () => create({ data: { email, password: pwd, role, perms } }),
    onSuccess: () => { toast.success("Staff created"); setNewOpen(false); setEmail(""); setPwd(""); setPermsState([]); setRole("cashier"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Shield className="h-6 w-6" /> Staff & access</h1>
          <p className="text-sm text-muted-foreground">Owner controls who signs in, with their own password, and exactly which sections each cashier can open.</p>
        </div>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild><Button><UserPlus className="h-4 w-4 mr-2" />Add staff</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Create staff account</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="cashier@store.com" /></div>
              <div><Label>Password</Label><Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder="min 6 chars" /></div>
              <div>
                <Label>Role</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" variant={role === "cashier" ? "default" : "outline"} size="sm" onClick={() => setRole("cashier")}>Cashier / Staff</Button>
                  <Button type="button" variant={role === "admin" ? "default" : "outline"} size="sm" onClick={() => setRole("admin")}>Owner (Admin)</Button>
                </div>
              </div>
              {role === "cashier" && (() => {
                const selectable = ALL_PERMS.filter((p) => p.key !== "sales");
                const allOn = selectable.every((p) => perms.includes(p.key));
                const toggleAll = () => setPermsState(allOn ? [] : selectable.map((p) => p.key));
                return (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-sm">Allowed sections (POS & Sales always allowed)</Label>
                      <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
                        {allOn ? "Clear all" : "Access all"}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2 p-3 rounded border max-h-64 overflow-auto">
                      {selectable.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => togglePerm(p.key)} />
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
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending}>{createMut.isPending ? "Creating…" : "Create"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Email</TableHead><TableHead>Role</TableHead><TableHead>Allowed sections</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">Loading…</TableCell></TableRow>}
            {users.map((u: any) => <UserRow key={u.id} u={u} reset={reset} del={del} refresh={refresh} />)}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function UserRow({ u, reset, del, refresh }: any) {
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">(u.role);
  const [perms, setPerms] = useState<string[]>(u.perms);
  const setPermsFn = useServerFn(setStaffPermissions);

  const saveMut = useMutation({
    mutationFn: () => setPermsFn({ data: { user_id: u.id, role, perms } }),
    onSuccess: () => { toast.success("Access updated"); setEditOpen(false); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const resetMut = useMutation({
    mutationFn: () => reset({ data: { user_id: u.id, password: newPwd } }),
    onSuccess: () => { toast.success("Password reset"); setResetOpen(false); setNewPwd(""); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { user_id: u.id } }),
    onSuccess: () => { toast.success("Removed"); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const toggle = (k: string) => setPerms((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  return (
    <TableRow>
      <TableCell className="font-medium">{u.email}</TableCell>
      <TableCell><Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge></TableCell>
      <TableCell className="max-w-md">
        {u.role === "admin" ? <span className="text-xs text-muted-foreground">Full access</span> : (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">pos</Badge>
            <Badge variant="outline" className="text-[10px]">sales</Badge>
            {u.perms.map((p: string) => <Badge key={p} variant="outline" className="text-[10px]">{p}</Badge>)}
            {u.perms.length === 0 && <span className="text-xs text-muted-foreground">No extras</span>}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right space-x-1">
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild><Button size="sm" variant="outline"><Shield className="h-3.5 w-3.5 mr-1" />Access</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Edit access — {u.email}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Role</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" variant={role === "cashier" ? "default" : "outline"} size="sm" onClick={() => setRole("cashier")}>Cashier</Button>
                  <Button type="button" variant={role === "admin" ? "default" : "outline"} size="sm" onClick={() => setRole("admin")}>Admin</Button>
                </div>
              </div>
              {role === "cashier" && (
                <div className="grid grid-cols-2 gap-2 p-3 rounded border max-h-64 overflow-auto">
                  {ALL_PERMS.filter((p) => p.key !== "sales").map((p) => (
                    <label key={p.key} className="flex items-center gap-2 text-sm">
                      <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              )}
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
            <DialogHeader><DialogTitle>Set new password</DialogTitle></DialogHeader>
            <Input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder="min 6 chars" />
            <DialogFooter>
              <Button variant="outline" onClick={() => setResetOpen(false)}>Cancel</Button>
              <Button onClick={() => resetMut.mutate()} disabled={resetMut.isPending || newPwd.length < 6}>Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Button size="sm" variant="destructive" onClick={() => { if (confirm(`Delete ${u.email}?`)) delMut.mutate(); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}
