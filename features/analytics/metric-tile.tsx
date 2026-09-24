import type { ReactNode } from "react";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface MetricTileProps {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: "default" | "profit" | "loss";
}

export function MetricTile({ label, value, detail, tone = "default" }: MetricTileProps) {
  return (
    <Card className="relative min-h-32 overflow-hidden p-5">
      <span className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/55 to-transparent" />
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-3 font-mono text-2xl font-semibold tracking-[-0.045em] tabular-nums",
        tone === "profit" && "text-profit",
        tone === "loss" && "text-loss",
      )}>{value}</p>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">{detail}</p>
    </Card>
  );
}
