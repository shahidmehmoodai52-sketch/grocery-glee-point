import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Store, Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isBlocked, logSecurityEvent } from "@/lib/security-log";

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
function checkStrongPassword(pw: string): string | null {
  if (pw.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Z]/.test(pw)) return "Add at least one UPPERCASE letter.";
  if (!/[a-z]/.test(pw)) return "Add at least one lowercase letter.";
  if (!/[0-9]/.test(pw)) return "Add at least one number.";
  return null;
}



function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const target = next ?? "/pos";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [signinAs, setSigninAs] = useState<"owner" | "staff">("owner");

  // Owner sign-in
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  // Staff sign-in
  const [shopCode, setShopCode] = useState("");
  const [staffUser, setStaffUser] = useState("");
  const [staffPwd, setStaffPwd] = useState("");

  // Register
  const [regEmail, setRegEmail] = useState("");
  const [regPwd, setRegPwd] = useState("");
  const [fullName, setFullName] = useState("");
  const [shopName, setShopName] = useState("");
  const [shopPhone, setShopPhone] = useState("");
  const [shopAddress, setShopAddress] = useState("");
  const [shopCity, setShopCity] = useState("");

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const goToApp = useCallback(async () => {
    await navigate({ to: target, replace: true });
  }, [navigate, target]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      // Only auto-forward if we're not in the middle of a signup flow
      if (data.session && regStep !== "details") void goToApp();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToApp]);

  const showErr = (msg: string) => { setFormError(msg); toast.error(msg); };

  // ---------- Owner sign-in ----------
  const handleOwnerSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (await isBlocked(cleanEmail)) {
        await logSecurityEvent("blocked_attempt", { severity: "warning", email: cleanEmail });
        showErr("Access blocked. Contact support if this is a mistake.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
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

  const handleForgot = async () => {
    const cleanEmail = (forgotEmail || email).trim().toLowerCase();
    if (!cleanEmail) { toast.error("Enter your email first."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
      redirectTo: `${window.location.origin}/reset-password?next=${encodeURIComponent(target)}`,
    });
    setBusy(false);
    if (error) toast.error("Could not send reset link. Please try again.");
    else { toast.success("Password reset link sent to your email."); setForgotOpen(false); }
  };

  // ---------- Staff sign-in ----------
  const handleStaffSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const code = cleanCode(shopCode);
      const user = cleanUsername(staffUser);
      if (!code) { showErr("Enter your shop code."); return; }
      if (!user) { showErr("Enter your username."); return; }
      if (!staffPwd) { showErr("Enter your password."); return; }
      const syntheticEmail = `${user}@shop-${code}.local`;
      if (await isBlocked(syntheticEmail)) { showErr("Access blocked. Contact your owner."); return; }
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

  // ---------- Register: step 1 send OTP ----------
  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    const cleanEmail = regEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      showErr("Please enter a valid email address."); setBusy(false); return;
    }
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth` },
      });
      if (error) { showErr(error.message); return; }
      toast.success("Verification code sent. Check your inbox (and spam).");
      setRegStep("otp");
    } catch (err: any) {
      showErr(err?.message ?? "Could not send code");
    } finally {
      setBusy(false);
    }
  };

  // ---------- Register: step 2 verify OTP ----------
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    const cleanEmail = regEmail.trim().toLowerCase();
    const code = otp.trim();
    if (code.length < 6) { showErr("Enter the 6-digit code from your email."); setBusy(false); return; }
    try {
      const { error } = await supabase.auth.verifyOtp({ email: cleanEmail, token: code, type: "email" });
      if (error) { showErr("Invalid or expired code. Try again."); return; }
      toast.success("Email verified. Now set your password and shop details.");
      setRegStep("details");
    } catch (err: any) {
      showErr(err?.message ?? "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  const handleResendOtp = async () => {
    const cleanEmail = regEmail.trim().toLowerCase();
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: { shouldCreateUser: true, emailRedirectTo: `${window.location.origin}/auth` },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("New code sent.");
  };

  // ---------- Register: step 3 finish (password + shop) ----------
  const handleFinishRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setFormError(null);
    try {
      const pwErr = checkStrongPassword(regPwd);
      if (pwErr) { showErr(pwErr); return; }
      if (shopName.trim().length < 2) { showErr("Shop name is required."); return; }
      if (!shopPhone.trim() || !shopAddress.trim() || !shopCity.trim()) {
        showErr("Please enter shop phone, address and city."); return;
      }

      // Set the password on the freshly-verified account
      const { error: pwdErr } = await supabase.auth.updateUser({
        password: regPwd,
        data: { full_name: fullName.trim() || undefined },
      });
      if (pwdErr) { showErr(`Could not save password: ${pwdErr.message}`); return; }

      // Register the shop for this user
      const { error: rpcErr } = await supabase.rpc("register_shop" as any, {
        _name: shopName.trim(),
        _phone: shopPhone.trim(),
        _address: shopAddress.trim(),
        _city: shopCity.trim(),
      } as any);
      if (rpcErr) { showErr(`Shop registration failed: ${rpcErr.message}`); return; }

      toast.success("Shop registered! Awaiting admin approval — limited access until approved.");
      await goToApp();
    } catch (err: any) {
      showErr(err?.message ?? "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const resetRegister = () => {
    setRegStep("email"); setOtp(""); setRegPwd("");
    setShopName(""); setShopPhone(""); setShopAddress(""); setShopCity(""); setFullName("");
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

        <Tabs value={mode} onValueChange={(v) => { setMode(v as "signin" | "signup"); setFormError(null); resetRegister(); }}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Register new shop</TabsTrigger>
          </TabsList>

          {/* ---------- SIGN IN ---------- */}
          <TabsContent value="signin" className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
              <button type="button" onClick={() => setSigninAs("owner")}
                className={`py-1.5 rounded ${signinAs === "owner" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Owner</button>
              <button type="button" onClick={() => setSigninAs("staff")}
                className={`py-1.5 rounded ${signinAs === "staff" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Shop staff</button>
            </div>

            {signinAs === "owner" ? (
              !forgotOpen ? (
                <form onSubmit={handleOwnerSignIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="password">Password</Label>
                      <button type="button" onClick={() => { setForgotEmail(email); setForgotOpen(true); }} className="text-xs text-primary hover:underline">
                        Forgot password?
                      </button>
                    </div>
                    <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
                  </div>
                  {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in
                  </Button>
                </form>
              ) : (
                <div className="space-y-3">
                  <button type="button" onClick={() => setForgotOpen(false)} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                    <ArrowLeft className="h-3 w-3" /> Back to sign in
                  </button>
                  <div className="space-y-1.5">
                    <Label>Reset your password</Label>
                    <p className="text-xs text-muted-foreground">Enter your account email — we'll send you a reset link.</p>
                    <Input type="email" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="you@example.com" />
                  </div>
                  <Button className="w-full" onClick={handleForgot} disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send reset link
                  </Button>
                </div>
              )
            ) : (
              <form onSubmit={handleStaffSignIn} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="shop_code">Shop code</Label>
                  <Input id="shop_code" value={shopCode} onChange={(e) => setShopCode(e.target.value)} placeholder="e.g. ali-store" autoCapitalize="none" required />
                  <p className="text-[11px] text-muted-foreground">Ask your shop owner for the code.</p>
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
            )}
          </TabsContent>

          {/* ---------- REGISTER ---------- */}
          <TabsContent value="signup" className="mt-6">
            {regStep === "email" && (
              <form onSubmit={handleSendOtp} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reg_email">Your email (Gmail works best)</Label>
                  <Input id="reg_email" type="email" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} required autoComplete="email" placeholder="you@gmail.com" />
                  <p className="text-[11px] text-muted-foreground">We'll email a 6-digit code to verify you own this address.</p>
                </div>
                {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Send verification code
                </Button>
              </form>
            )}

            {regStep === "otp" && (
              <form onSubmit={handleVerifyOtp} className="space-y-4">
                <button type="button" onClick={() => setRegStep("email")} className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
                  <ArrowLeft className="h-3 w-3" /> Change email
                </button>
                <div className="space-y-1.5">
                  <Label>Enter the 6-digit code sent to</Label>
                  <p className="text-sm font-medium">{regEmail}</p>
                  <Input inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} className="text-center text-lg tracking-widest font-mono" placeholder="123456" required />
                </div>
                {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
                <Button type="submit" className="w-full" disabled={busy || otp.length < 6}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Verify code
                </Button>
                <button type="button" onClick={handleResendOtp} disabled={busy} className="text-xs text-primary hover:underline w-full text-center">
                  Didn't get it? Resend code
                </button>
              </form>
            )}

            {regStep === "details" && (
              <form onSubmit={handleFinishRegister} className="space-y-4">
                <div className="rounded-md bg-primary/10 text-primary p-2 text-xs text-center">
                  ✓ {regEmail} verified
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="full_name">Your full name</Label>
                  <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg_pwd">Set a password</Label>
                  <Input id="reg_pwd" type="password" value={regPwd} onChange={(e) => setRegPwd(e.target.value)} required minLength={8} autoComplete="new-password" />
                  <p className="text-[11px] text-muted-foreground">8+ chars with uppercase, lowercase, and a number.</p>
                </div>
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
                {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create account & register shop
                </Button>
                <p className="text-[11px] text-muted-foreground text-center">
                  New shops start as <strong>pending</strong> until approved by the developer.
                </p>
              </form>
            )}
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
