import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string | number;
  detail: string;
  icon: ReactNode;
  emphasis?: "default" | "positive";
}

export function StatCard({ label, value, detail, icon, emphasis = "default" }: StatCardProps) {
  return (
    <Card className="min-h-36">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </span>
      </CardHeader>
      <CardContent className="pt-0">
        <p
          className={cn(
            "font-mono text-[1.75rem] font-semibold leading-none tracking-[-0.045em] tabular-nums",
            emphasis === "positive" && "text-profit",
          )}
        >
          {value}
        </p>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}
