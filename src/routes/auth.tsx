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

// Strong-password rule: 8+ chars, at least 1 uppercase, 1 lowercase, 1 digit.
function checkStrongPassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Add at least one UPPERCASE letter.";
  if (!/[a-z]/.test(pw)) return "Add at least one lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Add at least one number.";
  return null;
}

async function ensureShopRegistered(shop: {
  name: string;
  phone: string;
  address: string;
  city: string;
}) {
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
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");
  const [busy, setBusy] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const cleanEmail = email.trim().toLowerCase();
    try {
      // Firewall check: is this IP or email blocked?
      if (await isBlocked(cleanEmail)) {
        await logSecurityEvent("blocked_attempt", { severity: "warning", email: cleanEmail });
        toast.error("Access blocked. Contact support if this is a mistake.");
        return;
      }
      if (mode === "signup") {
        // Strong password enforced on signup.
        const pwErr = checkStrongPassword(password);
        if (pwErr) { toast.error(pwErr); return; }
        // Shop details mandatory on signup.
        if (shopName.trim().length < 2) { toast.error("Shop name is required."); return; }
        if (!shopPhone.trim() || !shopAddress.trim() || !shopCity.trim()) {
          toast.error("Please enter shop phone, address and city.");
          return;
        }

        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: { data: { full_name: fullName } },
        });
        if (error) {
          if (/already registered|already exists|user_already_exists/i.test(error.message)) {
            toast.info("Account already exists. Please sign in.");
            setMode("signin");
            setPassword("");
          } else {
            void logSecurityEvent("signup_error", { severity: "info", email: cleanEmail, metadata: { message: error.message } });
            toast.error("Could not create account. Please try again.");
          }
          return;
        }
        // If email-confirmation is off we now have a session — register shop right away.
        if (data.session) {
          try {
            await ensureShopRegistered({
              name: shopName.trim(),
              phone: shopPhone.trim(),
              address: shopAddress.trim(),
              city: shopCity.trim(),
            });
            toast.success("Shop registered. Awaiting admin approval — you have limited access until approved.");
          } catch (err: any) {
            toast.error(err?.message ?? "Could not register shop. Please contact support.");
          }
          await goToApp();
        } else {
          // Stash shop details so we can register the shop after email confirmation / first sign-in.
          window.sessionStorage.setItem(
            "pendingShopDetails",
            JSON.stringify({
              name: shopName.trim(),
              phone: shopPhone.trim(),
              address: shopAddress.trim(),
              city: shopCity.trim(),
            }),
          );
          toast.success("Account created. Sign in to finish shop registration.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) {
          void logSecurityEvent("failed_login", { severity: "warning", email: cleanEmail });
          toast.error("Invalid username or password");
          return;
        }
        void logSecurityEvent("successful_login", { severity: "info", email: cleanEmail });
        // If we stashed pending shop details during signup, register now.
        try {
          const raw = window.sessionStorage.getItem("pendingShopDetails");
          if (raw) {
            const shop = JSON.parse(raw);
            await ensureShopRegistered(shop);
            window.sessionStorage.removeItem("pendingShopDetails");
          }
        } catch { /* non-fatal */ }
        await goToApp();
      }
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
    if (result.error) {
      toast.error("Google sign-in failed");
      setBusy(false);
      return;
    }
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
          <p className="text-sm text-muted-foreground mt-1">Create an account & register your shop</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <TabsContent value="signup" className="space-y-4 mt-0">
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Your full name</Label>
                <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required={mode === "signup"} />
              </div>
              <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shop details (required)</p>
                <div className="space-y-1.5">
                  <Label htmlFor="shop_name">Shop name</Label>
                  <Input id="shop_name" value={shopName} onChange={(e) => setShopName(e.target.value)} required={mode === "signup"} placeholder="e.g. Ali General Store" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="shop_phone">Phone</Label>
                    <Input id="shop_phone" value={shopPhone} onChange={(e) => setShopPhone(e.target.value)} required={mode === "signup"} placeholder="03xx-xxxxxxx" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="shop_city">City</Label>
                    <Input id="shop_city" value={shopCity} onChange={(e) => setShopCity(e.target.value)} required={mode === "signup"} placeholder="Lahore" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shop_address">Address</Label>
                  <Input id="shop_address" value={shopAddress} onChange={(e) => setShopAddress(e.target.value)} required={mode === "signup"} placeholder="Shop # / Street / Area" />
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
                {mode === "signin" && (
                  <button
                    type="button"
                    onClick={handleForgot}
                    disabled={busy}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "signup" ? 8 : 6} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
              {mode === "signup" && (
                <p className="text-[11px] text-muted-foreground">Use 8+ chars with an uppercase letter, a lowercase letter, and a number.</p>
              )}
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account & register shop"}
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

        <p className="text-xs text-muted-foreground text-center mt-6">
          New shops start as <strong>pending</strong>. You'll have limited access until the developer approves your shop.
        </p>
      </Card>
    </div>
  );
}
