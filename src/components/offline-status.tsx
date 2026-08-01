// Compact online/offline/sync badge — mount in the top bar or sidebar footer.
import { Wifi, WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useOfflineStatus } from "@/lib/offline/status";
import { runSync } from "@/lib/offline/sync";
import { cn } from "@/lib/utils";

export function OfflineStatusBadge({ className }: { className?: string }) {
  const s = useOfflineStatus();
  if (!s.enabled) return null;

  const label = !s.online
    ? `Offline Mode${s.pending ? ` · ${s.pending} pending` : ""}`
    : s.phase === "syncing"
      ? s.progressTotal
        ? `Syncing ${s.progressDone ?? 0}/${s.progressTotal}…`
        : "Syncing…"
      : s.phase === "error"
        ? "Sync error"
        : s.pending
          ? `${s.pending} pending`
          : "Synced";

  const Icon = !s.online ? WifiOff
    : s.phase === "syncing" ? RefreshCw
    : s.phase === "error" ? AlertTriangle
    : s.pending ? Wifi
    : CheckCircle2;

  const tone = !s.online ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
    : s.phase === "error" ? "bg-destructive/15 text-destructive border-destructive/30"
    : s.pending ? "bg-blue-500/15 text-blue-600 border-blue-500/30"
    : "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Badge variant="outline" className={cn("gap-1 font-normal", tone)} title={s.error ?? undefined}>
        <Icon className={cn("h-3 w-3", s.phase === "syncing" && "animate-spin")} />
        {label}
      </Badge>
      {s.online && s.phase !== "syncing" && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          onClick={() => void runSync()}
          title="Sync now"
        >
          Sync
        </Button>
      )}
    </div>
  );
}
