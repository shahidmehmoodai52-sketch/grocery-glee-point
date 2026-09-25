import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, ArrowLeft, ShoppingCart, Pill, Store, Shirt, MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { isBlocked, logSecurityEvent } from "@/lib/security-log";
import { getUserAllowOffline } from "@/lib/offline/session";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
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

/** signInWithPassword() resolves an `{ error }` (it doesn't throw) for a
 *  connection failure just as it does for a genuine wrong password — a
 *  flaky/unstable connection (real incident: a shop's login started
 *  showing "Invalid email or password" during a spell of bad connectivity,
 *  with the same password that worked minutes earlier) must never be
 *  reported to the user as "your credentials are wrong". Same heuristic
 *  used throughout src/lib/offline for the identical distinction. */
function isAuthNetworkError(e: any): boolean {
  if (String((e as any)?.name ?? "") === "AuthRetryableFetchError") return true;
  const msg = String(e?.message ?? e ?? "").toLowerCase();
  if (!msg) return false;
  return /failed to fetch|network(error)?|networkerror|fetch failed|load failed|timeout|timed out|offline|dns|err_(internet|network|name_not_resolved|connection)|socket|aborted|econn|enotfound/.test(
    msg,
  );
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
  const [shopBusinessType, setShopBusinessType] = useState<"grocery" | "pharmacy" | "retail" | "clothing">("grocery");

  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Set once signUp() succeeds but Supabase requires email confirmation
  // before issuing a session — shows the "check your email" screen instead
  // of the registration form.
  const [pendingConfirmEmail, setPendingConfirmEmail] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState(false);
  
  // Track field-specific errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const goToApp = useCallback(async () => {
    await navigate({ to: target, replace: true });
  }, [navigate, target]);

  useEffect(() => {
    (async () => {
      const user = await getUserAllowOffline();
      if (!user) return;

      // A user who just confirmed their email via the link in their inbox
      // lands back here WITH a session but, until now, nothing ever
      // finished registering their shop — signUp() couldn't call
      // register_shop earlier because there was no session yet to attribute
      // it to. If registration details were stashed on signup (see
      // handleFinishRegister) and this user still has no shop, finish it
      // now, transparently, instead of dropping them into an app with no
      // tenant at all.
      try {
        const meta = user.user_metadata as Record<string, unknown> | undefined;
        const pendingName = typeof meta?.pending_shop_name === "string" ? meta.pending_shop_name : "";
        if (pendingName) {
          const { data: tenantId } = await supabase.rpc("current_tenant_id");
          if (!tenantId) {
            const { error: rpcErr } = await supabase.rpc("register_shop" as any, {
              _name: pendingName,
              _phone: (meta?.pending_shop_phone as string) ?? "",
              _address: (meta?.pending_shop_address as string) ?? "",
              _city: (meta?.pending_shop_city as string) ?? "",
              _business_type: (meta?.pending_shop_business_type as string) ?? "grocery",
            } as any);
            if (!rpcErr) {
              toast.success("Email confirmed — your shop is ready! Your 7-day free trial has started.");
              // Best effort: clear the stashed details now that they're applied.
              void supabase.auth.updateUser({
                data: {
                  pending_shop_name: null, pending_shop_phone: null,
                  pending_shop_address: null, pending_shop_city: null, pending_shop_business_type: null,
                },
              });
            }
          }
        }
      } catch {
        // Never block sign-in on this — worst case the user lands in the
        // app without a shop and can retry registration.
      }

      void goToApp();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goToApp]);

  const resendConfirmation = async () => {
    if (!pendingConfirmEmail) return;
    setResendBusy(true);
    const { error } = await supabase.auth.resend({ type: "signup", email: pendingConfirmEmail });
    setResendBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Confirmation email sent again.");
  };

  const showErr = (msg: string) => { 
    setFormError(msg); 
    toast.error(msg); 
  };

  // Clear field errors when user types
  const clearFieldError = (field: string) => {
    setFieldErrors(prev => ({ ...prev, [field]: "" }));
  };

  // ---------- Owner sign-in ----------
  const handleOwnerSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); 
    setFormError(null);
    setFieldErrors({});
    
    const cleanEmail = email.trim().toLowerCase();
    const errors: Record<string, string> = {};
    
    if (!cleanEmail) errors.email = "Email is required";
    if (!password) errors.password = "Password is required";
    
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBusy(false);
      return;
    }
    
    try {
      if (await isBlocked(cleanEmail)) {
        await logSecurityEvent("blocked_attempt", { severity: "warning", email: cleanEmail });
        showErr("Access blocked. Contact support if this is a mistake.");
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) {
        if (isAuthNetworkError(error)) {
          showErr("Could not reach the server — check your internet connection and try again.");
          return;
        }
        void logSecurityEvent("failed_login", { severity: "warning", email: cleanEmail });
        setFieldErrors({ password: "Invalid email or password" });
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
    setBusy(true); 
    setFormError(null);
    setFieldErrors({});
    
    const code = cleanCode(shopCode);
    const user = cleanUsername(staffUser);
    const errors: Record<string, string> = {};
    
    if (!shopCode.trim()) errors.shopCode = "Shop code is required";
    if (!staffUser.trim()) errors.staffUser = "Username is required";
    if (!staffPwd) errors.staffPwd = "Password is required";
    
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBusy(false);
      return;
    }
    
    try {
      const syntheticEmail = `${user}@shop-${code}.local`;
      if (await isBlocked(syntheticEmail)) { 
        showErr("Access blocked. Contact your owner."); 
        return; 
      }
      const { error } = await supabase.auth.signInWithPassword({ email: syntheticEmail, password: staffPwd });
      if (error) {
        if (isAuthNetworkError(error)) {
          showErr("Could not reach the server — check your internet connection and try again.");
          return;
        }
        void logSecurityEvent("failed_login", { severity: "warning", email: syntheticEmail });
        setFieldErrors({
          shopCode: "Invalid credentials",
          staffUser: "Invalid credentials",
          staffPwd: "Invalid credentials"
        });
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

  // ---------- Register ----------
  const handleFinishRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); 
    setFormError(null);
    setFieldErrors({});
    
    const cleanEmail = regEmail.trim().toLowerCase();
    const errors: Record<string, string> = {};
    
    if (!cleanEmail) errors.regEmail = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) errors.regEmail = "Please enter a valid email address";
    
    if (!fullName.trim()) errors.fullName = "Full name is required";
    
    const pwErr = checkStrongPassword(regPwd);
    if (pwErr) errors.regPwd = pwErr;
    
    if (shopName.trim().length < 2) errors.shopName = "Shop name is required";
    if (!shopPhone.trim()) errors.shopPhone = "Phone number is required";
    if (!shopAddress.trim()) errors.shopAddress = "Address is required";
    if (!shopCity.trim()) errors.shopCity = "City is required";
    
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setBusy(false);
      return;
    }

    try {
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: cleanEmail,
        password: regPwd,
        options: {
          emailRedirectTo: `${window.location.origin}/auth`,
          data: {
            full_name: fullName.trim() || undefined,
            // Stashed here (not localStorage) so it survives the round trip
            // even if the confirmation link is opened on a different
            // device/browser than the one used to sign up — the mount
            // effect above reads it back once a session exists and finishes
            // registration then.
            pending_shop_name: shopName.trim(),
            pending_shop_phone: shopPhone.trim(),
            pending_shop_address: shopAddress.trim(),
            pending_shop_city: shopCity.trim(),
            pending_shop_business_type: shopBusinessType,
          },
        },
      });
      if (signUpErr) {
        setFieldErrors({ regEmail: signUpErr.message });
        return;
      }

      if (!signUpData.session) {
        // Confirmation required: signing in now would just fail with a raw
        // "Email not confirmed" error, and register_shop needs a real
        // session to attribute the shop to — neither is possible yet.
        // Registration finishes automatically once they click the emailed
        // link (see the mount effect above), so stop here and tell them.
        setPendingConfirmEmail(cleanEmail);
        return;
      }

      const { error: rpcErr } = await supabase.rpc("register_shop" as any, {
        _name: shopName.trim(),
        _phone: shopPhone.trim(),
        _address: shopAddress.trim(),
        _city: shopCity.trim(),
        _business_type: shopBusinessType,
      } as any);
      if (rpcErr) { 
        showErr(`Shop registration failed: ${rpcErr.message}`); 
        return; 
      }

      toast.success("Shop registered! Your 7-day free trial has started — full access, no approval needed.");
      await goToApp();
    } catch (err: any) {
      showErr(err?.message ?? "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const resetRegister = () => {
    setRegPwd(""); setShopName(""); setShopPhone(""); setShopAddress(""); setShopCity(""); setFullName(""); setRegEmail("");
    setShopBusinessType("grocery");
    setFieldErrors({});
    setPendingConfirmEmail(null);
  };

  // Owner and Staff sign-in share formError/fieldErrors — without clearing
  // them here, an error from one tab stayed visible after switching to the
  // other tab, even though nothing was submitted there.
  const switchSigninAs = (v: "owner" | "staff") => {
    setSigninAs(v);
    setFormError(null);
    setFieldErrors({});
    setForgotOpen(false);
  };

  return (
    <div className="min-h-screen w-full bg-gradient-to-br from-background via-secondary to-background flex items-center justify-center p-4">
      <Toaster richColors position="top-right" />
      <Card className="w-full max-w-md p-8">
        {pendingConfirmEmail ? (
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-950/40">
              <MailCheck className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold">Check your email</h1>
              <p className="text-sm text-muted-foreground">
                We've sent a confirmation link to <strong className="text-foreground">{pendingConfirmEmail}</strong>.
                Click the link to activate your account — your shop and 7-day free trial will be ready as soon as you do.
              </p>
            </div>
            <div className="w-full space-y-2 pt-2">
              <Button variant="outline" className="w-full" onClick={resendConfirmation} disabled={resendBusy}>
                {resendBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Resend email
              </Button>
              <button
                type="button"
                onClick={() => { setPendingConfirmEmail(null); setMode("signin"); }}
                className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 justify-center w-full pt-1"
              >
                <ArrowLeft className="h-3 w-3" /> Back to sign in
              </button>
            </div>
          </div>
        ) : (
        <>
        <div className="flex flex-col items-center text-center mb-6">
          <div className="mb-3 flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white">
            <img
              src="/favicon.png"
              alt="Tillix POS logo"
              className="h-12 w-12 object-cover"
              width={48}
              height={48}
              decoding="async"
              loading="eager"
            />
          </div>
          <h1 className="text-2xl font-semibold">Tillix POS</h1>
          <p className="text-sm text-muted-foreground mt-1">Sign in or register your shop</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => { setMode(v as "signin" | "signup"); setFormError(null); setForgotOpen(false); resetRegister(); }}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Register new shop</TabsTrigger>
          </TabsList>

          {/* ---------- SIGN IN ---------- */}
          <TabsContent value="signin" className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-md bg-muted p-1 text-sm">
              <button type="button" onClick={() => switchSigninAs("owner")}
                className={`py-1.5 rounded ${signinAs === "owner" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Owner</button>
              <button type="button" onClick={() => switchSigninAs("staff")}
                className={`py-1.5 rounded ${signinAs === "staff" ? "bg-background shadow-sm font-medium" : "text-muted-foreground"}`}>Shop staff</button>
            </div>

            {signinAs === "owner" ? (
              !forgotOpen ? (
                <form onSubmit={handleOwnerSignIn} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="email">Email</Label>
                    <Input 
                      id="email" 
                      type="email" 
                      value={email} 
                      onChange={(e) => {
                        setEmail(e.target.value);
                        clearFieldError("email");
                      }} 
                      required 
                      autoComplete="email"
                      className={fieldErrors.email ? "border-red-500 focus:border-red-500" : ""}
                    />
                    {fieldErrors.email && (
                      <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center">
                      <Label htmlFor="password">Password</Label>
                      <button type="button" onClick={() => { setForgotEmail(email); setForgotOpen(true); }} className="text-xs text-primary hover:underline">
                        Forgot password?
                      </button>
                    </div>
                    <Input 
                      id="password" 
                      type="password" 
                      value={password} 
                      onChange={(e) => {
                        setPassword(e.target.value);
                        clearFieldError("password");
                      }} 
                      required 
                      autoComplete="current-password"
                      className={fieldErrors.password ? "border-red-500 focus:border-red-500" : ""}
                    />
                    {fieldErrors.password && (
                      <p className="text-xs text-red-500 mt-1">{fieldErrors.password}</p>
                    )}
                  </div>
                  {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
                  <Button type="submit" className="w-full" disabled={busy}>
                    {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Sign in
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full border-emerald-500/40 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300"
                    onClick={() => { setMode("signup"); setFormError(null); }}
                  >
                    Start 7-day free trial
                  </Button>
                  <p className="text-[11px] text-center text-muted-foreground">
                    No credit card required · Full access for 7 days
                  </p>
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
                  <Input 
                    id="shop_code" 
                    value={shopCode} 
                    onChange={(e) => {
                      setShopCode(e.target.value);
                      clearFieldError("shopCode");
                    }} 
                    placeholder="e.g. ali-store" 
                    autoCapitalize="none" 
                    required
                    className={fieldErrors.shopCode ? "border-red-500 focus:border-red-500" : ""}
                  />
                  {fieldErrors.shopCode && (
                    <p className="text-xs text-red-500 mt-1">{fieldErrors.shopCode}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground">Ask your shop owner for the code.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff_user">Username</Label>
                  <Input 
                    id="staff_user" 
                    value={staffUser} 
                    onChange={(e) => {
                      setStaffUser(e.target.value);
                      clearFieldError("staffUser");
                    }} 
                    placeholder="e.g. raza" 
                    autoCapitalize="none" 
                    required 
                    autoComplete="username"
                    className={fieldErrors.staffUser ? "border-red-500 focus:border-red-500" : ""}
                  />
                  {fieldErrors.staffUser && (
                    <p className="text-xs text-red-500 mt-1">{fieldErrors.staffUser}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="staff_pwd">Password</Label>
                  <Input 
                    id="staff_pwd" 
                    type="password" 
                    value={staffPwd} 
                    onChange={(e) => {
                      setStaffPwd(e.target.value);
                      clearFieldError("staffPwd");
                    }} 
                    required 
                    autoComplete="current-password"
                    className={fieldErrors.staffPwd ? "border-red-500 focus:border-red-500" : ""}
                  />
                  {fieldErrors.staffPwd && (
                    <p className="text-xs text-red-500 mt-1">{fieldErrors.staffPwd}</p>
                  )}
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
            <form onSubmit={handleFinishRegister} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="reg_email">Email</Label>
                <Input 
                  id="reg_email" 
                  type="email" 
                  value={regEmail} 
                  onChange={(e) => {
                    setRegEmail(e.target.value);
                    clearFieldError("regEmail");
                  }} 
                  required 
                  autoComplete="email" 
                  placeholder="you@example.com"
                  className={fieldErrors.regEmail ? "border-red-500 focus:border-red-500" : ""}
                />
                {fieldErrors.regEmail && (
                  <p className="text-xs text-red-500 mt-1">{fieldErrors.regEmail}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Your full name</Label>
                <Input 
                  id="full_name" 
                  value={fullName} 
                  onChange={(e) => {
                    setFullName(e.target.value);
                    clearFieldError("fullName");
                  }} 
                  required
                  className={fieldErrors.fullName ? "border-red-500 focus:border-red-500" : ""}
                />
                {fieldErrors.fullName && (
                  <p className="text-xs text-red-500 mt-1">{fieldErrors.fullName}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reg_pwd">Password</Label>
                <Input 
                  id="reg_pwd" 
                  type="password" 
                  value={regPwd} 
                  onChange={(e) => {
                    setRegPwd(e.target.value);
                    clearFieldError("regPwd");
                  }} 
                  required 
                  minLength={8} 
                  autoComplete="new-password"
                  className={fieldErrors.regPwd ? "border-red-500 focus:border-red-500" : ""}
                />
                <p className="text-[11px] text-muted-foreground">8+ chars with uppercase, lowercase, and a number.</p>
                 {fieldErrors.regPwd && (
                  <p className="text-xs text-red-500 mt-1">{fieldErrors.regPwd}</p>
                )}
              </div>
              <div className="rounded-md border p-3 space-y-3 bg-muted/30">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Shop details</p>
                <div className="space-y-1.5">
                  <Label>Business type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setShopBusinessType("grocery")}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        shopBusinessType === "grocery"
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-input hover:bg-accent"
                      }`}
                    >
                      <ShoppingCart className="h-4 w-4" />
                      Grocery
                    </button>
                    <button
                      type="button"
                      onClick={() => setShopBusinessType("pharmacy")}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        shopBusinessType === "pharmacy"
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-input hover:bg-accent"
                      }`}
                    >
                      <Pill className="h-4 w-4" />
                      Pharmacy
                    </button>
                    <button
                      type="button"
                      onClick={() => setShopBusinessType("retail")}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        shopBusinessType === "retail"
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-input hover:bg-accent"
                      }`}
                    >
                      <Store className="h-4 w-4" />
                      Retail Shop
                    </button>
                    <button
                      type="button"
                      onClick={() => setShopBusinessType("clothing")}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors ${
                        shopBusinessType === "clothing"
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-input hover:bg-accent"
                      }`}
                    >
                      <Shirt className="h-4 w-4" />
                      Clothing
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shop_name">Shop name</Label>
                  <Input 
                    id="shop_name" 
                    value={shopName} 
                    onChange={(e) => {
                      setShopName(e.target.value);
                      clearFieldError("shopName");
                    }} 
                    required 
                    placeholder="e.g. Store Name"
                    className={fieldErrors.shopName ? "border-red-500 focus:border-red-500" : ""}
                  />
                  {fieldErrors.shopName && (
                    <p className="text-xs text-red-500 mt-1">{fieldErrors.shopName}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="shop_phone">Phone</Label>
                    <Input 
                      id="shop_phone" 
                      value={shopPhone} 
                      onChange={(e) => {
                        setShopPhone(e.target.value);
                        clearFieldError("shopPhone");
                      }} 
                      required 
                      placeholder="xxxx-xxxxxxx"
                      className={fieldErrors.shopPhone ? "border-red-500 focus:border-red-500" : ""}
                    />
                    {fieldErrors.shopPhone && (
                      <p className="text-xs text-red-500 mt-1">{fieldErrors.shopPhone}</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="shop_city">City</Label>
                    <Input 
                      id="shop_city" 
                      value={shopCity} 
                      onChange={(e) => {
                        setShopCity(e.target.value);
                        clearFieldError("shopCity");
                      }} 
                      required 
                      placeholder=""
                      className={fieldErrors.shopCity ? "border-red-500 focus:border-red-500" : ""}
                    />
                    {fieldErrors.shopCity && (
                      <p className="text-xs text-red-500 mt-1">{fieldErrors.shopCity}</p>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="shop_address">Address</Label>
                  <Input 
                    id="shop_address" 
                    value={shopAddress} 
                    onChange={(e) => {
                      setShopAddress(e.target.value);
                      clearFieldError("shopAddress");
                    }} 
                    required 
                    placeholder="Shop # / Street / Area"
                    className={fieldErrors.shopAddress ? "border-red-500 focus:border-red-500" : ""}
                  />
                  {fieldErrors.shopAddress && (
                    <p className="text-xs text-red-500 mt-1">{fieldErrors.shopAddress}</p>
                  )}
                </div>
              </div>
              {formError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{formError}</div>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create account & register shop
              </Button>
              <p className="text-[11px] text-muted-foreground text-center">
                Your shop gets instant, full access — no approval needed.
              </p>
            </form>
          </TabsContent>
        </Tabs>
        </>
        )}
      </Card>
    </div>
  );
}