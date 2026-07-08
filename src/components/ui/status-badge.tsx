import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type StatusTone =
  | "success" | "warning" | "danger" | "info" | "neutral" | "primary";

const toneClass: Record<StatusTone, string> = {
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/15 text-warning-foreground ring-warning/30",
  danger: "bg-destructive/10 text-destructive ring-destructive/20",
  info: "bg-info/10 text-info ring-info/20",
  primary: "bg-primary/10 text-primary ring-primary/20",
  neutral: "bg-muted text-muted-foreground ring-border",
};

// Semantic status → tone mapping. Extend freely; anything unknown falls back to neutral.
const statusMap: Record<string, StatusTone> = {
  healthy: "success", completed: "success", paid: "success", approved: "success", active: "success",
  low: "warning", pending: "warning", draft: "warning", partial: "warning",
  critical: "danger", cancelled: "danger", rejected: "danger", failed: "danger", overdue: "danger",
  credit: "info", processing: "info", open: "info",
};

interface StatusBadgeProps {
  status?: string;
  tone?: StatusTone;
  children?: ReactNode;
  className?: string;
}

export function StatusBadge({ status, tone, children, className }: StatusBadgeProps) {
  const resolved: StatusTone =
    tone ?? (status ? statusMap[status.toLowerCase()] ?? "neutral" : "neutral");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize ring-1 ring-inset",
        toneClass[resolved],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full",
        resolved === "success" && "bg-success",
        resolved === "warning" && "bg-warning",
        resolved === "danger" && "bg-destructive",
        resolved === "info" && "bg-info",
        resolved === "primary" && "bg-primary",
        resolved === "neutral" && "bg-muted-foreground",
      )} />
      {children ?? status}
    </span>
  );
}
