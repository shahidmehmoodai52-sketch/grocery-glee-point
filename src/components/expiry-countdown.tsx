import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertTriangle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useOfflineStatus } from "@/lib/offline/status";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const DISMISS_KEY = "tillix.expiry_countdown_dismissed_on"; // YYYY-MM-DD:<days>

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ExpiryCountdown() {
  const { user } = useAuth();
  const { online } = useOfflineStatus();
  const [open, setOpen] = useState(false);

  const { data: expiresAt } = useQuery({
    queryKey: ["my-tenant-expires-at", user?.id],
    enabled: !!user?.id && online,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_tenant_expires_at" as any);
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });

  const daysLeft = useMemo(() => {
    if (!expiresAt) return null;
    const exp = new Date(expiresAt).getTime();
    if (isNaN(exp)) return null;
    const diffMs = exp - Date.now();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  }, [expiresAt]);

  useEffect(() => {
    if (daysLeft == null) return;
    if (daysLeft > 10 || daysLeft < 0) return;
    try {
      const key = `${todayKey()}:${daysLeft}`;
      const last = window.localStorage.getItem(DISMISS_KEY);
      if (last === key) return;
    } catch { /* ignore */ }
    setOpen(true);
  }, [daysLeft]);

  const dismiss = () => {
    try { window.localStorage.setItem(DISMISS_KEY, `${todayKey()}:${daysLeft}`); } catch {}
    setOpen(false);
  };

  if (daysLeft == null || daysLeft > 10 || daysLeft < 0) return null;

  const urgent = daysLeft <= 3;
  const dayWord = daysLeft === 1 ? "day" : "days";

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full ${urgent ? "bg-destructive/10 text-destructive" : "bg-amber-500/10 text-amber-600"}`}>
            {urgent ? <AlertTriangle className="h-7 w-7" /> : <Clock className="h-7 w-7" />}
          </div>
          <DialogTitle className="text-center text-lg">
            Subscription expiring soon
          </DialogTitle>
          <DialogDescription className="text-center">
            <span className={`block text-4xl font-bold tabular-nums my-2 ${urgent ? "text-destructive" : "text-foreground"}`}>
              {daysLeft === 0 ? "Today" : `${daysLeft} ${dayWord}`}
            </span>
            <span className="text-sm">
              {daysLeft === 0
                ? "Your shop subscription expires today."
                : `Only ${daysLeft} ${dayWord} left until your shop subscription expires.`}
              {" "}Renew now to avoid interruption.
            </span>
            <span className="mt-3 block rounded-md bg-muted px-3 py-2 text-xs">
              Contact: <strong>info@tillix.co</strong> · +923096431377
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="sm:justify-center">
          <Button onClick={dismiss} className="w-full sm:w-auto">
            Remind me tomorrow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
