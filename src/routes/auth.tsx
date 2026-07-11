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
import { lovable } from "@/integrations/lovable";
import { isBlocked, logSecurityEvent } from "@/lib/security-log";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  component: AuthPage,
});

function checkStrongPassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Add at least one UPPERCASE letter.";
  if (!/[a-z]/.test(pw)) return "Add at least one lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Add at least one number.";
  return null;
}

function cleanCode(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
}
function cleanUsername(s: string) {
  return s.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

async function ensureShopRegistered(shop: { name: string; phone: string; address: string; city: string }) {
  const { error } = await supabase.rpc("register_shop" as any, {
    _name: shop.name,
    _phone: shop.phone || null,
    _address: shop.address || null,
    _city: shop.city || null,
  } as any);
  if (error) throw error;
}

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const target = next ?? "/pos";
  const [audience, setAudience] = useState<"staff" | "owner">("staff");
  const [ownerMode, setOwnerMode] = useState<"signin" | "signup">("signin");

  // Owner fields
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");

  // Staff fields
  const [shopCode, setShopCode] = useState("");
  const [staffUser, setStaffUser] = useState("");
  const [staffPwd, setStaffPwd] = useState("");

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const goToApp = useCallback(async () => {
    await navigate({ to: target, replace: true });
  }, [navigate, target]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      const savedNext = window.sessionStorage.getItem("postAuthNext");
      if (savedNext?.startsWith("/") && !savedNext.startsWith("//")) {
        window.sessionStorage.removeItem("postAuthNext");
        void navigate({ to: savedNext, replace: true });
        return;
      }
      void goToApp();
    });
  }, [goToApp, navigate]);

  const showErr = (msg: string) => { setFormError(msg); toast.error(msg); };

  const handleStaffSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const code = cleanCode(shopCode);
      const user = cleanUsername(staffUser);
      if (!code) { showErr("Enter your shop code (ask your owner)."); return; }
      if (!user) { showErr("Enter your username."); return; }
      if (!staffPwd) { showErr("Enter your password."); return; }
      const syntheticEmail = `${user}@shop-${code}.local`;
      if (await isBlocked(syntheticEmail)) {
        showErr("Access blocked. Contact your owner.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: syntheticEmail, password: staffPwd });
      if (error) {
        void logSecurityEvent("failed_login", { severity: "warning", email: syntheticEmail });
        showErr("Wrong shop code, username or password.");
        return;
      }
      void logSecurityEvent("successful_login", { severity: "info", email: syntheticEmail });
      await goToApp();
    } catch (err: any) {
      showErr(err?.message ?? "Unexpected error");
    } finally {
      setBusy(false);
    }
  };

  const handleOwnerSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (await isBlocked(cleanEmail)) {
        await logSecurityEvent("blocked_attempt", { severity: "warning", email: cleanEmail });
        showErr("Access blocked. Contact support if this is a mistake.");
        return;
      }
      if (ownerMode === "signup") {
        const pwErr = checkStrongPassword(password);
        if (pwErr) { showErr(pwErr); return; }
        if (shopName.trim().length < 2) { showErr("Shop name is required."); return; }
        if (!shopPhone.trim() || !shopAddress.trim() || !shopCity.trim()) {
          showErr("Please enter shop phone, address and city."); return;
        }
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail, password,
          options: { data: { full_name: fullName } },
        });
        if (error) {
          if (/already registered|already exists|user_already_exists/i.test(error.message)) {
            toast.info("Account already exists. Please sign in.");
            setOwnerMode("signin"); setPassword("");
          } else {
            void logSecurityEvent("signup_error", { severity: "info", email: cleanEmail, metadata: { message: error.message } });
            showErr(`Signup failed: ${error.message}`);
          }
          return;
        }
        if (data.session) {
          try {
            await ensureShopRegistered({
              name: shopName.trim(), phone: shopPhone.trim(),
              address: shopAddress.trim(), city: shopCity.trim(),
            });
            toast.success("Shop registered. Awaiting admin approval — you have limited access until approved.");
          } catch (err: any) {
            showErr(`Shop registration failed: ${err?.message ?? "unknown error"}`); return;
          }
          await goToApp();
        } else {
          window.sessionStorage.setItem("pendingShopDetails", JSON.stringify({
            name: shopName.trim(), phone: shopPhone.trim(),
            address: shopAddress.trim(), city: shopCity.trim(),
          }));
          toast.success("Account created. Sign in to finish shop registration.");
          setOwnerMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) {
          void logSecurityEvent("failed_login", { severity: "warning", email: cleanEmail });
          showErr(error.message || "Invalid email or password");
          return;
        }
        void logSecurityEvent("successful_login", { severity: "info", email: cleanEmail });
        try {
          const raw = window.sessionStorage.getItem("pendingShopDetails");
          if (raw) {
            await ensureShopRegistered(JSON.parse(raw));
            window.sessionStorage.removeItem("pendingShopDetails");
          }
        } catch (err) { console.error("[signin] pending shop registration error:", err); }
        await goToApp();
      }
    } catch (err: any) {
      showErr(err?.message ?? "Unexpected error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail) { toast.error("Please enter your email first."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password?next=${encodeURIComponent(target)}`,
    });
    setBusy(false);
    if (error) toast.error("Could not send reset link. Please try again.");
    else toast.success("Password reset link sent to your email.");
  };

  const handleGoogle = async () => {
    setBusy(true);
    window.sessionStorage.setItem("postAuthNext", target);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) { toast.error("Google sign-in failed"); setBusy(false); return; }
    if (result.redirected) return;
    await goToApp();
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
          <p className="text-sm text-muted-foreground mt-1">Sign in to your shop</p>
        </div>

        <Tabs value={audience} onValueChange={(v) => { setAudience(v as "staff" | "owner"); setFormError(null); }}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="staff">Shop Staff</TabsTrigger>
            <TabsTrigger value="owner">Owner / Developer</TabsTrigger>
          </TabsList>

          <TabsContent value="staff" className="mt-6">
            <form onSubmit={handleStaffSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="shop_code">Shop code</Label>
                <Input id="shop_code" value={shopCode} onChange={(e) => setShopCode(e.target.value)} placeholder="e.g. ali-store" autoCapitalize="none" required />
                <p className="text-[11px] text-muted-foreground">Ask your owner for the shop code.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff_user">Username</Label>
                <Input id="staff_user" value={staffUser} onChange={(e) => setStaffUser(e.target.value)} placeholder="e.g. raza" autoCapitalize="none" required autoComplete="username" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="staff_pwd">Password</Label>
                <Input id="staff_pwd" type="password" value={staffPwd} onChange={(e) => setStaffPwd(e.target.value)} required autoComplete="current-password" />
              </div>
              {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in
              </Button>
            </form>
          </TabsContent>

          <TabsContent value="owner" className="mt-6">
            <Tabs value={ownerMode} onValueChange={(v) => setOwnerMode(v as "signin" | "signup")}>
              <TabsList className="grid grid-cols-2 w-full">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Register new shop</TabsTrigger>
              </TabsList>

              <form onSubmit={handleOwnerSubmit} className="space-y-4 mt-6">
                <TabsContent value="signup" className="space-y-4 mt-0">
                  <div className="space-y-1.5">
                    <Label htmlFor="full_name">Your full name</Label>
                    <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required={ownerMode === "signup"} />
                  </div>
                  <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shop details (required)</p>
                    <div className="space-y-1.5">
                      <Label htmlFor="shop_name">Shop name</Label>
                      <Input id="shop_name" value={shopName} onChange={(e) => setShopName(e.target.value)} required={ownerMode === "signup"} placeholder="e.g. Ali General Store" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="shop_phone">Phone</Label>
                        <Input id="shop_phone" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} required={ownerMode === "signup"} placeholder="03xx-xxxxxxx" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="shop_city">City</Label>
                        <Input id="shop_city" value={shopCity} onChange={(e) => setShopCity(e.target.value)} required={ownerMode === "signup"} placeholder="Lahore" />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="shop_address">Address</Label>
                      <Input id="shop_address" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} required={ownerMode === "signup"} placeholder="Shop # / Street / Area" />
                    </div>
                  </div>
                </TabsContent>
                <div className="space-y-1.5">
                  <Label htmlFor="email">Email</Label>
                  <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    {ownerMode === "signin" && (
                      <button type="button" onClick={handleForgot} disabled={busy} className="text-xs text-muted-foreground hover:text-foreground">
                        Forgot password?
                      </button>
                    )}
                  </div>
                  <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={ownerMode === "signup" ? 8 : 6} autoComplete={ownerMode === "signin" ? "current-password" : "new-password"} />
                  {ownerMode === "signup" && (
                    <p className="text-[11px] text-muted-foreground">Use 8+ chars with an uppercase letter, a lowercase letter, and a number.</p>
                  )}
                </div>
                {formError && (
                  <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive whitespace-pre-wrap">
                    <strong className="font-semibold">Error:</strong> {formError}
                  </div>
                )}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {ownerMode === "signin" ? "Sign in" : "Create account & register shop"}
                </Button>
              </form>
            </Tabs>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or</span>
              </div>
            </div>

            <Button variant="outline" className="w-full" onClick={handleGoogle} disabled={busy}>
              Continue with Google
            </Button>
          </TabsContent>
        </Tabs>

        <p className="text-xs text-muted-foreground text-center mt-6">
          Staff: use your shop code + username. Owners: use email. New shops start as <strong>pending</strong>.
        </p>
      </Card>
    </div>
  );
}
