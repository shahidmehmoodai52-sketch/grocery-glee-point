import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
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
import { NeedsInternetBanner } from "@/components/needs-internet-banner";

export const Route = createFileRoute("/_authenticated/shop-admin")({ component: Page });

function Page() {
  const { t } = useTranslation();
  const info = useServerFn(getMyShopInfo);
  const { data: shop, isLoading, error, refetch } = useQuery({
    queryKey: ["my-shop-info"],
    queryFn: () => (info as any)(),
    retry: 1,
  });

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">{t('shop_admin.loading_shop', 'Loading shop…')}</div>;
  }
  if (error) {
    return (
      <div className="p-6 max-w-lg space-y-3">
      <NeedsInternetBanner section={t('shop_admin.page_title', 'Shop admin')} />
        <h2 className="text-lg font-semibold">{t('shop_admin.couldnt_load', "Couldn't load shop")}</h2>
        <p className="text-sm text-muted-foreground break-words">{(error as any)?.message ?? String(error)}</p>
        <Button size="sm" variant="outline" onClick={() => refetch()}>{t('shop_admin.retry', 'Retry')}</Button>
      </div>
    );
  }
  if (!shop) {
    return (
      <div className="p-6 max-w-lg space-y-3">
        <h2 className="text-lg font-semibold">{t('shop_admin.no_shop_found', 'No shop found')}</h2>
        <p className="text-sm text-muted-foreground">{t('shop_admin.no_shop_desc', "Your account isn't linked to a shop yet.")}</p>
      </div>
    );
  }
  if (!shop.is_owner) {
    return (
      <div className="p-8 max-w-lg mx-auto text-center space-y-2">
        <Shield className="h-8 w-8 mx-auto text-muted-foreground" />
        <h2 className="text-lg font-semibold">{t('shop_admin.owners_only', 'Owners only')}</h2>
        <p className="text-sm text-muted-foreground">{t('shop_admin.owners_only_desc', 'Only the shop owner can manage staff and settings.')}</p>
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
            {t('shop_admin.status_label', 'Status:')} <Badge variant={shop.status === "active" ? "default" : "secondary"}>{shop.status}</Badge> · {t('shop_admin.plan_label', 'Plan:')} <span className="font-medium">{shop.plan}</span>
          </div>
        </div>
      </div>

      <Tabs defaultValue="staff">
        <TabsList>
          <TabsTrigger value="staff">{t('shop_admin.tab_staff', 'Staff')}</TabsTrigger>
          <TabsTrigger value="access">{t('shop_admin.tab_shop_code', 'Shop code')}</TabsTrigger>
          <TabsTrigger value="plan">{t('shop_admin.tab_subscription', 'Subscription')}</TabsTrigger>
        </TabsList>

        <TabsContent value="staff" className="mt-4">
          <StaffTab shopCode={shop.code} />
        </TabsContent>

        <TabsContent value="access" className="mt-4">
          <ShopCodeCard code={shop.code} />
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <Card className="p-4 space-y-2">
            <div className="text-sm">{t('shop_admin.current_plan_label', 'Current plan:')} <strong>{shop.plan}</strong></div>
            <div className="text-sm">{t('shop_admin.status_label', 'Status:')} <strong>{shop.status}</strong></div>
            <p className="text-xs text-muted-foreground">{t('shop_admin.to_change_plan', 'To change your plan or renew, contact the developer.')}</p>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ShopCodeCard({ code }: { code: string }) {
  const { t } = useTranslation();
  return (
    <Card className="p-4 space-y-3">
      <div>
        <Label>{t('shop_admin.your_shop_code', 'Your shop code')}</Label>
        <div className="flex gap-2 items-center mt-1">
          <Input readOnly value={code} className="font-mono max-w-xs" />
          <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(code); toast.success(t('shop_admin.toast_copied', 'Copied')); }}>
            <Copy className="h-3.5 w-3.5 mr-1" />{t('shop_admin.copy', 'Copy')}
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('shop_admin.shop_code_desc_prefix', 'Cashiers sign in on the login page using ')}<strong>{t('shop_admin.shop_code_desc_bold', 'Shop Staff')}</strong>{t('shop_admin.shop_code_desc_suffix', ': shop code + username + password. Share this code with your staff only.')}
      </p>
    </Card>
  );
}

function StaffTab({ shopCode }: { shopCode: string }) {
  const { t } = useTranslation();
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
      toast.success(t('shop_admin.toast_cashier_created', 'Cashier created'));
      setNewOpen(false); setUsername(""); setPwd(""); setPerms([]); setRole("cashier");
      refresh();
    },
    onError: (e: any) => toast.error(e?.message ?? t('shop_admin.toast_failed', 'Failed')),
  });

  const permLabel = (key: string) => t(`users.perm_${key.replace(/-/g, "_")}`, ALL_PERMS.find((p) => p.key === key)?.label ?? key);

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-sm text-muted-foreground">
          {t('shop_admin.staff_intro_prefix', 'Your staff sign in with ')}<strong>{t('shop_admin.staff_intro_bold', 'username + password')}</strong>{t('shop_admin.staff_intro_mid', ' (no email needed). Share your shop code ')}<span className="font-mono">{shopCode}</span>{t('shop_admin.staff_intro_suffix', ' so they can find your shop on the login page.')}
        </p>
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger asChild><Button><UserPlus className="h-4 w-4 mr-2" />{t('shop_admin.add_staff_btn', 'Add staff')}</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{t('shop_admin.add_staff_dialog_title', 'Add staff account')}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>{t('shop_admin.username_label', 'Username')}</Label>
                <Input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} placeholder={t('shop_admin.username_placeholder', 'e.g. raza')} />
                <p className="text-[11px] text-muted-foreground mt-1">{t('shop_admin.username_hint', 'Lowercase letters, numbers, . _ - only')}</p>
              </div>
              <div>
                <Label>{t('common.password', 'Password')}</Label>
                <Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} placeholder={t('shop_admin.password_placeholder', '8+ chars, Aa and 1')} />
              </div>
              <div>
                <Label>{t('shop_admin.role_label', 'Role')}</Label>
                <div className="flex gap-2 mt-1">
                  <Button type="button" size="sm" variant={role === "cashier" ? "default" : "outline"} onClick={() => setRole("cashier")}>{t('shop_admin.cashier_role', 'Cashier')}</Button>
                  <Button type="button" size="sm" variant={role === "admin" ? "default" : "outline"} onClick={() => setRole("admin")}>{t('shop_admin.admin_role_full', 'Admin (full access)')}</Button>
                </div>
              </div>
              {role === "cashier" && (() => {
                const selectable = ALL_PERMS.filter((p) => p.key !== "sales");
                const allOn = selectable.every((p) => perms.includes(p.key));
                return (
                  <div>
                    <div className="flex justify-between items-center">
                      <Label className="text-sm">{t('shop_admin.allowed_sections_hint', 'Allowed sections (POS & Sales always allowed)')}</Label>
                      <Button type="button" size="sm" variant="outline" onClick={() => setPerms(allOn ? [] : selectable.map((p) => p.key))}>
                        {allOn ? t('shop_admin.clear_all', 'Clear all') : t('shop_admin.access_all', 'Access all')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 p-3 rounded border max-h-64 overflow-auto mt-2">
                      {selectable.map((p) => (
                        <label key={p.key} className="flex items-center gap-2 text-sm">
                          <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                          {permLabel(p.key)}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setNewOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
              <Button onClick={() => createMut.mutate()} disabled={createMut.isPending || !username || pwd.length < 8}>
                {createMut.isPending ? t('shop_admin.creating', 'Creating…') : t('shop_admin.create', 'Create')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-3">
        <Table>
          <TableHeader><TableRow>
            <TableHead>{t('shop_admin.th_username', 'Username')}</TableHead><TableHead>{t('shop_admin.th_role', 'Role')}</TableHead><TableHead>{t('shop_admin.th_allowed_sections', 'Allowed sections')}</TableHead><TableHead className="text-right">{t('customers.th_actions', 'Actions')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">{t('shop_admin.loading', 'Loading…')}</TableCell></TableRow>}
            {users.map((u: any) => <StaffRow key={u.id} u={u} reset={reset} del={del} refresh={refresh} permLabel={permLabel} />)}
            {!isLoading && users.length === 0 && (
              <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">{t('shop_admin.no_staff_yet', 'No staff yet. Click "Add staff" to create your first cashier.')}</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function StaffRow({ u, reset, del, refresh, permLabel }: any) {
  const { t } = useTranslation();
  const setPermsFn = useServerFn(setShopStaffPerms);
  const [editOpen, setEditOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPwd, setNewPwd] = useState("");
  const [role, setRole] = useState<"admin" | "cashier">(u.role === "admin" ? "admin" : "cashier");
  const [perms, setPerms] = useState<string[]>(u.perms);
  const toggle = (k: string) => setPerms((p) => p.includes(k) ? p.filter((x) => x !== k) : [...p, k]);

  const saveMut = useMutation({
    mutationFn: () => setPermsFn({ data: { user_id: u.id, role, perms } }),
    onSuccess: () => { toast.success(t('shop_admin.toast_access_updated', 'Access updated')); setEditOpen(false); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? t('shop_admin.toast_failed', 'Failed')),
  });
  const resetMut = useMutation({
    mutationFn: () => reset({ data: { user_id: u.id, password: newPwd } }),
    onSuccess: () => { toast.success(t('shop_admin.toast_password_updated', 'Password updated')); setResetOpen(false); setNewPwd(""); },
    onError: (e: any) => toast.error(e?.message ?? t('shop_admin.toast_failed', 'Failed')),
  });
  const delMut = useMutation({
    mutationFn: () => del({ data: { user_id: u.id } }),
    onSuccess: () => { toast.success(t('shop_admin.toast_removed', 'Removed')); refresh(); },
    onError: (e: any) => toast.error(e?.message ?? t('shop_admin.toast_failed', 'Failed')),
  });

  return (
    <TableRow>
      <TableCell className="font-medium">
        {u.username}
        {u.is_owner && <Badge variant="outline" className="ml-2 text-[10px]">{t('shop_admin.you_owner_badge', 'You (owner)')}</Badge>}
      </TableCell>
      <TableCell><Badge variant={u.role === "admin" || u.role === "super_admin" ? "default" : "secondary"}>{String(t(`shop_admin.role_value_${u.role}`, u.role))}</Badge></TableCell>
      <TableCell className="max-w-md">
        {u.role !== "cashier" ? <span className="text-xs text-muted-foreground">{t('shop_admin.full_access', 'Full access')}</span> : (
          <div className="flex flex-wrap gap-1">
            <Badge variant="outline" className="text-[10px]">{t('shop_admin.badge_pos', 'pos')}</Badge>
            <Badge variant="outline" className="text-[10px]">{t('shop_admin.badge_sales', 'sales')}</Badge>
            {u.perms.map((p: string) => <Badge key={p} variant="outline" className="text-[10px]">{permLabel(p)}</Badge>)}
            {u.perms.length === 0 && <span className="text-xs text-muted-foreground">{t('shop_admin.no_extras', 'No extras')}</span>}
          </div>
        )}
      </TableCell>
      <TableCell className="text-right space-x-1">
        {!u.is_owner && (
          <>
            <Dialog open={editOpen} onOpenChange={setEditOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><Shield className="h-3.5 w-3.5 mr-1" />{t('shop_admin.access_btn', 'Access')}</Button></DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{t('shop_admin.edit_access_title', 'Edit access — {{username}}', { username: u.username })}</DialogTitle></DialogHeader>
                <div className="space-y-3">
                  <div>
                    <Label>{t('shop_admin.role_label', 'Role')}</Label>
                    <div className="flex gap-2 mt-1">
                      <Button type="button" size="sm" variant={role === "cashier" ? "default" : "outline"} onClick={() => setRole("cashier")}>{t('shop_admin.cashier_role', 'Cashier')}</Button>
                      <Button type="button" size="sm" variant={role === "admin" ? "default" : "outline"} onClick={() => setRole("admin")}>{t('shop_admin.admin_role', 'Admin')}</Button>
                    </div>
                  </div>
                  {role === "cashier" && (() => {
                    const selectable = ALL_PERMS.filter((p) => p.key !== "sales");
                    const allOn = selectable.every((p) => perms.includes(p.key));
                    return (
                      <div>
                        <div className="flex justify-between items-center">
                          <Label className="text-sm">{t('shop_admin.allowed_sections', 'Allowed sections')}</Label>
                          <Button type="button" size="sm" variant="outline" onClick={() => setPerms(allOn ? [] : selectable.map((p) => p.key))}>
                            {allOn ? t('shop_admin.clear_all', 'Clear all') : t('shop_admin.access_all', 'Access all')}
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 p-3 rounded border max-h-64 overflow-auto mt-2">
                          {selectable.map((p) => (
                            <label key={p.key} className="flex items-center gap-2 text-sm">
                              <Checkbox checked={perms.includes(p.key)} onCheckedChange={() => toggle(p.key)} />
                              {permLabel(p.key)}
                            </label>
                          ))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setEditOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
                  <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}><Save className="h-4 w-4 mr-1" />{t('common.save', 'Save')}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Dialog open={resetOpen} onOpenChange={setResetOpen}>
              <DialogTrigger asChild><Button size="sm" variant="outline"><KeyRound className="h-3.5 w-3.5 mr-1" />{t('shop_admin.password_btn', 'Password')}</Button></DialogTrigger>
              <DialogContent className="max-w-sm">
                <DialogHeader><DialogTitle>{t('shop_admin.set_new_password_title', 'Set new password for {{username}}', { username: u.username })}</DialogTitle></DialogHeader>
                <Input value={newPwd} onChange={(e) => setNewPwd(e.target.value)} placeholder={t('shop_admin.password_placeholder', '8+ chars, Aa and 1')} />
                <DialogFooter>
                  <Button variant="outline" onClick={() => setResetOpen(false)}>{t('common.cancel', 'Cancel')}</Button>
                  <Button onClick={() => resetMut.mutate()} disabled={resetMut.isPending || newPwd.length < 8}>{t('assets.update_btn', 'Update')}</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button size="sm" variant="destructive" onClick={() => { if (confirm(t('shop_admin.remove_confirm', 'Remove {{username}}?', { username: u.username }))) delMut.mutate(); }}>
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </TableCell>
    </TableRow>
  );
}
