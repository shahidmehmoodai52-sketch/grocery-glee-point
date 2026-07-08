import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock, AlertTriangle, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSettings } from "@/hooks/use-settings";
import { useAuth } from "@/hooks/use-auth";

export function ShiftBanner() {
  const { data: settings } = useSettings();
  const { user } = useAuth();
  const enabled = !!settings?.ops_shift_enabled;

  const { data: shift } = useQuery({
    queryKey: ["current_shift", user?.id],
    enabled: enabled && !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("current_shift");
      if (error) throw error;
      return Array.isArray(data) ? data[0] ?? null : data ?? null;
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  if (!enabled) return null;

  if (!shift) {
    return (
      <div className="no-print flex items-center gap-2 bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-3 py-1.5 text-xs">
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="font-medium">No shift open.</span>
        <span className="text-muted-foreground">Sales will still record, but drawer cash will not balance.</span>
        <Link to="/shifts" className="ml-auto underline underline-offset-2 hover:text-primary">
          Open shift →
        </Link>
      </div>
    );
  }

  const opened = new Date(shift.opened_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return (
    <div className="no-print flex items-center gap-2 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-900 dark:text-emerald-200 px-3 py-1.5 text-xs">
      <CheckCircle2 className="h-3.5 w-3.5" />
      <span className="font-medium">Shift open</span>
      <span className="text-muted-foreground inline-flex items-center gap-1">
        <Clock className="h-3 w-3" /> since {opened} · Business date {shift.business_date}
      </span>
      <Link to="/shifts" className="ml-auto underline underline-offset-2 hover:text-primary">
        Manage →
      </Link>
    </div>
  );
}
