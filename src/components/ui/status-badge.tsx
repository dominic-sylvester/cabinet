import type { ComponentProps, ComponentType } from "react";
import { cn } from "@/lib/utils";

export type StatusTone = "neutral" | "running" | "success" | "warning" | "danger";

const tones: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  running: "bg-status-running-bg text-status-running",
  success: "bg-status-success-bg text-status-success",
  warning: "bg-status-warning-bg text-status-warning",
  danger: "bg-status-danger-bg text-status-danger",
};

export function StatusBadge({
  tone = "neutral",
  icon: Icon,
  children,
  className,
  ...props
}: ComponentProps<"span"> & {
  tone?: StatusTone;
  icon?: ComponentType<{ className?: string }>;
}) {
  return (
    <span
      data-slot="status-badge"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-control px-2 py-0.5 text-label font-medium",
        tones[tone],
        className
      )}
      {...props}
    >
      {Icon && <span aria-hidden="true" className="inline-flex"><Icon className="size-3" /></span>}
      {children}
    </span>
  );
}
