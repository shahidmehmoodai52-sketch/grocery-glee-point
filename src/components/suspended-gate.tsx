import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertOctagon, LogOut, Store, Loader2, Clock, ShoppingCart, Pill } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSuperAdmin } from "@/hooks/use-super-admin";
import { useOfflineStatus } from "@/lib/offline/status";
import { clearOfflineDataOnLogout } from "@/lib/offline/device";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function SuspendedGate({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();
  const { online } = useOfflineStatus();

  const { data: status, refetch } = useQuery({
    queryKey: ["my-tenant-status", user?.id],
    enabled: !!user?.id && online,
    staleTime: 30_000,
    queryFn: async () => {
      const call = () => supabase.rpc("my_tenant_status");

      let { data, error } = await call();
      if (error) {
        // A stale/about-to-expire access token is a known cause of a spurious
        // failure here (same class of bug already fixed for the sale-save path
        // in __root.tsx) — refresh once and retry before giving up, so a shop
        // owner with a perfectly real shop is never dropped into "Register
        // your shop" just because their token needed a refresh.
        await supabase.auth.refreshSession().catch(() => {});
        ({ data, error } = await call());
        if (error) throw error;
      }

      // A clean `null` result (no error) right after login can also be a
      // transient race, not proof the user has no shop: the client's auth
      // session can resolve in React state slightly before the Supabase
      // client actually has a token attached to outgoing requests (common
      // right after a Google OAuth redirect), or the tenant_members row can
      // still be mid-provisioning. This is the exact same race already
      // handled for realtime tenant resolution in use-realtime-sync.ts
      // (fetchTenantIdWithRetry) — mirrored here with a shorter budget since
      // this is a foreground gate, not a background subscription setup.
      for (const delayMs of [800, 1500, 3000]) {
        if (data !== null) break;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        ({ data, error } = await call());
        if (error) break; // a real error surfaces as-is below, not silently as "no tenant"
      }

      if (error) throw error;
      return (data as string | null) ?? null;
    },
  });

  // Super-admins always pass through so they can un-suspend from the panel.
  if (isSuperAdmin) return <>{children}</>;

  // Staff sign in with a synthetic username@shop-<slug>.local address (see
  // internalEmail() in shop-admin.server.ts) — they never register a shop of
  // their own. If one of these lands with no tenant membership (e.g. an
  // owner's "add staff" request that created the login but failed to link it
  // to the shop before this fix), showing the "Register your shop" form would
  // let them create an unrelated phantom shop instead of surfacing the real
  // problem.
  const isStaffLogin = !!user?.email && /@shop-.+\.local$/i.test(user.email);

  // Signed in but has NO shop yet (e.g. Google sign-up path) → force shop setup.
  if (online && user && status === null) {
    if (isStaffLogin) return <StaffAccountBlocked />;
    return <ShopSetup onDone={() => refetch()} />;
  }

  if (status === "suspended" || status === "archived" || status === "expired") {
    const isExpired = status === "expired";
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            {isExpired ? <Clock className="h-6 w-6" /> : <AlertOctagon className="h-6 w-6" />}
          </div>
          <h1 className="mt-4 text-xl font-semibold">
            {isExpired ? t('suspended_gate.subscription_expired_title', 'Subscription expired') : t('suspended_gate.shop_suspended_title', 'Shop suspended')}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isExpired
              ? t('suspended_gate.expired_body', 'Your shop\'s subscription has expired. Please contact the tillix.co support (info@tillix.co · +923096431377) to renew your plan and restore access.')
              : t('suspended_gate.suspended_body', 'Your shop has been {{status}} by the platform administrator. Please contact support to restore access.', {
                  status: status === "archived" ? t('suspended_gate.status_archived', 'archived') : t('suspended_gate.status_suspended', 'suspended'),
                })}
          </p>
          <Button
            className="mt-6"
            variant="outline"
            onClick={async () => {
              await clearOfflineDataOnLogout();
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> {t('suspended_gate.sign_out', 'Sign out')}
          </Button>
        </div>
      </div>
    );
  }

  // Pending shops: allow into the app with limited access. Banner is rendered
  // inside the authenticated layout header (see PendingBanner) so it sits
  // beside the sidebar instead of being covered by the fixed sidebar panel.
  if (status === "pending") {
    return <>{children}</>;
  }


  return <>{children}</>;
}

function StaffAccountBlocked() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive/5 p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <AlertOctagon className="h-6 w-6" />
        </div>
        <h1 className="mt-4 text-xl font-semibold">{t('suspended_gate.account_not_linked_title', 'Account not linked to a shop')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('suspended_gate.account_not_linked_body', "This staff login isn't linked to a shop yet. Please ask your shop owner to remove this staff account and add it again from Staff Management.")}
        </p>
        <Button
          className="mt-6"
          variant="outline"
          onClick={async () => {
            await clearOfflineDataOnLogout();
            await supabase.auth.signOut();
            window.location.href = "/auth";
          }}
        >
          <LogOut className="mr-2 h-4 w-4" /> {t('suspended_gate.sign_out', 'Sign out')}
        </Button>
      </div>
    </div>
  );
}

function ShopSetup({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [businessType, setBusinessType] = useState<"grocery" | "pharmacy">("grocery");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { toast.error(t('suspended_gate.toast_shop_name_required', 'Shop name is required.')); return; }
    if (!phone.trim() || !address.trim() || !city.trim()) {
      toast.error(t('suspended_gate.toast_enter_phone_address_city', 'Please enter phone, address and city.')); return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("register_shop" as any, {
      _name: name.trim(),
      _phone: phone.trim(),
      _address: address.trim(),
      _city: city.trim(),
      _business_type: businessType,
    } as any);
    setBusy(false);
    if (error) { toast.error(error.message ?? t('suspended_gate.toast_could_not_register', 'Could not register shop.')); return; }
    toast.success(t('suspended_gate.toast_shop_registered', 'Shop registered! Your 7-day free trial has started.'));
    onDone();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-lg border bg-card p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
            <Store className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">{t('suspended_gate.register_shop_title', 'Register your shop')}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t('suspended_gate.register_shop_intro', "Please enter shop details to continue. You'll get full access right away with a 7-day free trial.")}
          </p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label>{t('suspended_gate.business_type_label', 'Business type')}</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setBusinessType("grocery")}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                  businessType === "grocery" ? "border-primary bg-primary/10 text-primary font-medium" : "border-input hover:bg-accent"
                }`}
              >
                <ShoppingCart className="h-4 w-4" /> {t('suspended_gate.business_type_grocery', 'Grocery')}
              </button>
              <button
                type="button"
                onClick={() => setBusinessType("pharmacy")}
                className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                  businessType === "pharmacy" ? "border-primary bg-primary/10 text-primary font-medium" : "border-input hover:bg-accent"
                }`}
              >
                <Pill className="h-4 w-4" /> {t('suspended_gate.business_type_pharmacy', 'Pharmacy')}
              </button>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s_name">{t('suspended_gate.shop_name_label', 'Shop name')}</Label>
            <Input id="s_name" value={name} onChange={(e) => setName(e.target.value)} required placeholder={t('suspended_gate.shop_name_placeholder', 'e.g. Ali General Store')} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s_phone">{t('suspended_gate.phone_label', 'Phone')}</Label>
              <Input id="s_phone" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="03xx-xxxxxxx" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s_city">{t('suspended_gate.city_label', 'City')}</Label>
              <Input id="s_city" value={city} onChange={(e) => setCity(e.target.value)} required placeholder="Lahore" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s_addr">{t('suspended_gate.address_label', 'Address')}</Label>
            <Input id="s_addr" value={address} onChange={(e) => setAddress(e.target.value)} required placeholder={t('suspended_gate.address_placeholder', 'Shop # / Street / Area')} />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} {t('suspended_gate.register_shop_button', 'Register shop')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={async () => {
              await clearOfflineDataOnLogout();
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> {t('suspended_gate.sign_out', 'Sign out')}
          </Button>
        </form>
      </div>
    </div>
  );
}
