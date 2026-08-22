import type { ComponentType, ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Tone = "default" | "primary" | "success" | "warning" | "danger" | "info";

const toneStyles: Record<Tone, { bg: string; text: string }> = {
  default: { bg: "bg-muted", text: "text-muted-foreground" },
  primary: { bg: "bg-primary/10", text: "text-primary" },
  success: { bg: "bg-success/10", text: "text-success" },
  warning: { bg: "bg-warning/15", text: "text-warning-foreground" },
  danger: { bg: "bg-destructive/10", text: "text-destructive" },
  info: { bg: "bg-info/10", text: "text-info" },
};

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  tone?: Tone;
  delta?: number;
  sub?: string;
  className?: string;
  onClick?: () => void;
}

export function StatCard({
  label, value, icon: Icon, tone = "default", delta, sub, className, onClick,
}: StatCardProps) {
  const t = toneStyles[tone];
  return (
    <Card 
      className={cn(
        "p-5 transition-shadow hover:shadow-md", 
        onClick && "cursor-pointer hover:border-primary/50",
        className
      )}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        {Icon && (
          <span className={cn("grid h-8 w-8 place-items-center rounded-md", t.bg, t.text)}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="mt-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
        {value}
      </div>
      {(sub || delta !== undefined) && (
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          {sub && <span className="truncate">{sub}</span>}
          {delta !== undefined && delta !== 0 && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-medium",
                delta >= 0 ? "text-success" : "text-destructive",
              )}
            >
              {delta >= 0 ? (
                <ArrowUpRight className="h-3 w-3" />
              ) : (
                <ArrowDownRight className="h-3 w-3" />
              )}
              {Math.abs(delta).toFixed(1)}%
            </span>
          )}
        </div>
      )}
    </Card>
  );
}
