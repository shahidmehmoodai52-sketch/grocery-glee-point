import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AlertOctagon, LogOut, Store, Loader2, Clock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useSuperAdmin } from "@/hooks/use-super-admin";
import { useOfflineStatus } from "@/lib/offline/status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export function SuspendedGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();
  const { online } = useOfflineStatus();

  const { data: status, refetch } = useQuery({
    queryKey: ["my-tenant-status", user?.id],
    enabled: !!user?.id && online,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_tenant_status");
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });

  // Super-admins always pass through so they can un-suspend from the panel.
  if (isSuperAdmin) return <>{children}</>;

  // Signed in but has NO shop yet (e.g. Google sign-up path) → force shop setup.
  if (online && user && status === null) {
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
            {isExpired ? "Subscription expired" : "Shop suspended"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {isExpired
              ? "Your shop's subscription has expired. Please contact the developer (Shahid Mehmood · 0304-4604659) to renew your plan and restore access."
              : `Your shop has been ${status === "archived" ? "archived" : "suspended"} by the platform administrator. Please contact support to restore access.`}
          </p>
          <Button
            className="mt-6"
            variant="outline"
            onClick={async () => {
              await supabase.auth.signOut();
              window.location.href = "/auth";
            }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
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

function ShopSetup({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) { toast.error("Shop name is required."); return; }
    if (!phone.trim() || !address.trim() || !city.trim()) {
      toast.error("Please enter phone, address and city."); return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("register_shop" as any, {
      _name: name.trim(),
      _phone: phone.trim(),
      _address: address.trim(),
      _city: city.trim(),
    } as any);
    setBusy(false);
    if (error) { toast.error(error.message ?? "Could not register shop."); return; }
    toast.success("Shop registered. Awaiting admin approval.");
    onDone();
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-lg border bg-card p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
            <Store className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold">Register your shop</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Please enter shop details to continue. Access is limited until the developer approves your shop.
          </p>
        </div>
        <form className="space-y-4" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="s_name">Shop name</Label>
            <Input id="s_name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="e.g. Ali General Store" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="s_phone">Phone</Label>
              <Input id="s_phone" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="03xx-xxxxxxx" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="s_city">City</Label>
              <Input id="s_city" value={city} onChange={(e) => setCity(e.target.value)} required placeholder="Lahore" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="s_addr">Address</Label>
            <Input id="s_addr" value={address} onChange={(e) => setAddress(e.target.value)} required placeholder="Shop # / Street / Area" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Register shop
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={async () => { await supabase.auth.signOut(); window.location.href = "/auth"; }}
          >
            <LogOut className="mr-2 h-4 w-4" /> Sign out
          </Button>
        </form>
      </div>
    </div>
  );
}
