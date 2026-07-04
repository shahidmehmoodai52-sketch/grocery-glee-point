import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Store, Loader2, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" && s.next.startsWith("/") && !s.next.startsWith("//") ? s.next : undefined,
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { next } = Route.useSearch();
  const target = next ?? "/pos";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsReset, setNeedsReset] = useState(false);

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
    setNeedsReset(false);
    const cleanEmail = email.trim().toLowerCase();
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/auth?next=${encodeURIComponent(target)}`,
            data: { full_name: fullName },
          },
        });
        if (error) throw error;
        // Auto-confirm is enabled → a session is returned immediately.
        if (data.session) {
          toast.success("Account created. Signing you in…");
          await goToApp();
        } else {
          toast.success("Account created. You can sign in now.");
          setMode("signin");
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
        if (error) throw error;
        await goToApp();
      }
    } catch (err: any) {
      const msg = String(err?.message ?? "Authentication failed");
      if (/already registered|already exists|user_already_exists/i.test(msg)) {
        toast.info("Ye email pehle se registered hai. Sign in kar lein.");
        setMode("signin");
        setPassword("");
      } else if (/invalid login credentials/i.test(msg)) {
        setNeedsReset(true);
        toast.error("Password match nahi ho raha. Reset password use karein ya sahi password daalein.");
      } else {
        toast.error(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleForgot = async () => {
    if (!email) { toast.error("Pehle apni email daalein."); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/reset-password?next=${encodeURIComponent(target)}`,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      setNeedsReset(false);
      toast.success("Reset link email par bhej diya gaya.");
    }
  };

  const handleGoogle = async () => {
    setBusy(true);
    window.sessionStorage.setItem("postAuthNext", target);
    const result = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin });
    if (result.error) {
      toast.error(result.error.message ?? "Google sign-in failed");
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
          <p className="text-sm text-muted-foreground mt-1">Sign in to manage your store</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as any)}>
          <TabsList className="grid grid-cols-2 w-full">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <form onSubmit={handleSubmit} className="space-y-4 mt-6">
            <TabsContent value="signup" className="space-y-4 mt-0">
              <div className="space-y-1.5">
                <Label htmlFor="full_name">Full name</Label>
                <Input id="full_name" value={fullName} onChange={(e) => setFullName(e.target.value)} required={mode === "signup"} />
              </div>
            </TabsContent>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoComplete={mode === "signin" ? "current-password" : "new-password"} />
            </div>
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {mode === "signin" ? "Sign in" : "Create account"}
            </Button>
            {mode === "signin" && needsReset && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground">
                <div className="flex items-start gap-2">
                  <KeyRound className="mt-0.5 h-4 w-4 text-destructive" />
                  <div className="space-y-2">
                    <p>Password ghalat hai ya purana password yaad nahi. Is email ka account already exists ho sakta hai.</p>
                    <Button type="button" size="sm" variant="secondary" onClick={handleForgot} disabled={busy}>
                      Send reset link
                    </Button>
                  </div>
                </div>
              </div>
            )}
            {mode === "signin" && (
              <button
                type="button"
                onClick={handleForgot}
                disabled={busy}
                className="text-xs text-muted-foreground hover:text-foreground w-full text-center mt-1"
              >
                Forgot password?
              </button>
            )}
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
          The first account created becomes the admin.
        </p>
      </Card>
    </div>
  );
}
