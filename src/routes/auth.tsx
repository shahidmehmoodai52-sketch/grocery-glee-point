import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Store, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isBlocked, logSecurityEvent } from "@/lib/security-log";
import { registerShopAccount } from "@/lib/register.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  component: AuthPage,
});

function cleanCode(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}
function cleanUsername(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const target = next ?? "/pos";
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  // Sign-in fields
  const [shopCode, setShopCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Register fields
  const [shopName, setShopName] = useState("");
  const [fullName, setFullName] = useState("");
  const [regUser, setRegUser] = useState("");
  const [regPwd, setRegPwd] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");

  // Legacy email login (for developer / pre-existing accounts)
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacyEmail, setLegacyEmail] = useState("");
  const [legacyPwd, setLegacyPwd] = useState("");

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const goToApp = useCallback(async () => {
    await navigate({ to: target, replace: true });
  }, [navigate, target]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) void goToApp();
    });
  }, [goToApp]);

  const showErr = (msg: string) => { setFormError(msg); toast.error(msg); };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const code = cleanCode(shopCode);
      const user = cleanUsername(username);
      if (!code) { showErr("Enter your shop code."); return; }
      if (!user) { showErr("Enter your username."); return; }
      if (!password) { showErr("Enter your password."); return; }

      const email = `${user}@shop-${code}.local`;
      if (await isBlocked(email)) {
        showErr("Access blocked. Contact your shop owner.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        void logSecurityEvent("failed_login", { severity: "warning", email });
        showErr("Wrong shop code, username or password.");
        return;
      }
      void logSecurityEvent("successful_login", { severity: "info", email });
      await goToApp();
    } catch (err: any) {
      showErr(err?.message ?? "Unexpected error");
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      if (shopName.trim().length < 2) { showErr("Shop name is required."); return; }
      if (!shopPhone.trim() || !shopAddress.trim() || !shopCity.trim()) {
        showErr("Please enter shop phone, address and city."); return;
      }
      const user = cleanUsername(regUser);
      if (user.length < 2) { showErr("Username must be 2+ characters."); return; }
      if (regPwd.length < 6) { showErr("Password must be at least 6 characters."); return; }

      const res = await (registerShopAccount as any)({
        data: {
          shop_name: shopName.trim(),
          username: user,
          password: regPwd,
          full_name: fullName.trim() || undefined,
          phone: shopPhone.trim(),
          address: shopAddress.trim(),
          city: shopCity.trim(),
        },
      });

      // Sign in with the freshly-created internal credentials
      const { error } = await supabase.auth.signInWithPassword({ email: res.email, password: regPwd });
      if (error) {
        toast.success(`Shop registered. Your shop code is "${res.slug}". Please sign in.`);
        setMode("signin");
        setShopCode(res.slug);
        setUsername(user);
        return;
      }
      toast.success(`Shop registered! Your shop code is "${res.slug}". Share it with your staff.`);
      await goToApp();
    } catch (err: any) {
      showErr(err?.message ?? "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const handleLegacy = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    const cleanEmail = legacyEmail.trim().toLowerCase();
    try {
      if (await isBlocked(cleanEmail)) { showErr("Access blocked."); return; }
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password: legacyPwd });
      if (error) {
        void logSecurityEvent("failed_login", { severity: "warning", email: cleanEmail });
        showErr(error.message || "Invalid email or password");
        return;
      }
      void logSecurityEvent("successful_login", { severity: "info", email: cleanEmail });
      await goToApp();
    } catch (err: any) {
      showErr(err?.message ?? "Unexpected error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-secondary to-background flex items-center justify-center p-4">
      <Toaster richColors position="top-right" />
      <Card className="w-full max-w-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground mb-3">
            <Store className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-semibold">Grocery POS</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in or register your shop</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => { setMode(v as "signin" | "signup"); setFormError(null); }}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Register new shop</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="mt-6">
            <form onSubmit={handleSignIn} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="shop_code">Shop code</Label>
                <Input id="shop_code" value={shopCode} onChange={(e) => setShopCode(e.target.value)} placeholder="e.g. ali-store" autoCapitalize="none" required />
                <p className="text-[11px] text-muted-foreground">Owners see their code in Shop admin. Staff: ask your owner.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signin_user">Username</Label>
                <Input id="signin_user" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="e.g. raza" autoCapitalize="none" required autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signin_pwd">Password</Label>
                <Input id="signin_pwd" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
              </div>
              {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="signup" className="mt-6">
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shop details</p>
                <div className="space-y-1.5">
                  <Label htmlFor="shop_name">Shop name</Label>
                  <Input id="shop_name" value={shopName} onChange={(e) => setShopName(e.target.value)} required placeholder="e.g. Ali General Store" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="shop_phone">Phone</Label>
                    <Input id="shop_phone" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} required placeholder="03xx-xxxxxxx" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="shop_city">City</Label>
                    <Input id="shop_city" value={shopCity} onChange={(e) => setShopCity(e.target.value)} required placeholder="Lahore" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shop_address">Address</Label>
                  <Input id="shop_address" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} required placeholder="Shop # / Street / Area" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="full_name">Your full name (optional)</Label>
                <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Owner name" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg_user">Owner username</Label>
                <Input id="reg_user" value={regUser} onChange={(e) => setRegUser(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ""))} placeholder="e.g. ali" required autoCapitalize="none" autoComplete="username" />
                <p className="text-[11px] text-muted-foreground">Lowercase letters, numbers, . _ - only. You will use this to sign in.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg_pwd">Password</Label>
                <Input id="reg_pwd" type="password" value={regPwd} onChange={(e) => setRegPwd(e.target.value)} required minLength={6} autoComplete="new-password" />
                <p className="text-[11px] text-muted-foreground">Minimum 6 characters.</p>
              </div>

              {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create account & register shop
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                New shops start as <strong>pending</strong> until approved by the developer.
              </p>
            </form>
          </TabsContent>
        </Tabs>

        <div className="mt-6 pt-4 border-t text-center">
          {!showLegacy ? (
            <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowLegacy(true)}>
              Legacy sign-in with email
            </button>
          ) : (
            <form onSubmit={handleLegacy} className="space-y-2 text-left">
              <p className="text-xs font-medium text-muted-foreground">For accounts registered with email (developer / older shops).</p>
              <Input type="email" value={legacyEmail} onChange={(e) => setLegacyEmail(e.target.value)} placeholder="Email" required autoComplete="email" />
              <Input type="password" value={legacyPwd} onChange={(e) => setLegacyPwd(e.target.value)} placeholder="Password" required autoComplete="current-password" />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="flex-1" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in with email
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowLegacy(false)}>Hide</Button>
              </div>
            </form>
          )}
        </div>
      </Card>
    </div>
  );
}
