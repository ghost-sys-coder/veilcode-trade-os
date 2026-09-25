"use client";

import * as React from "react";
import type { TooltipContentProps } from "recharts";

import { ChartContext } from "@/components/ui/chart-context";

export function ChartTooltipContent({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}: Partial<TooltipContentProps<number | string, string>> & {
  valueFormatter?: (value: number | string, name: string) => React.ReactNode;
}) {
  const config = React.useContext(ChartContext);
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-40 rounded-lg border border-border/80 bg-popover px-3 py-2 text-xs shadow-xl">
      <p className="mb-2 font-medium text-popover-foreground">
        {labelFormatter ? labelFormatter(label, payload) : String(label ?? "")}
      </p>
      <div className="space-y-1.5">
        {payload.map((item) => {
          const key = String(item.dataKey ?? item.name ?? "value");
          const itemConfig = config[key];
          const rawValue: string | number = typeof item.value === "number" || typeof item.value === "string"
            ? item.value
            : Array.isArray(item.value) ? item.value.join(" – ") : "";
          return (
            <div key={key} className="flex items-center justify-between gap-5">
              <span className="flex items-center gap-2 text-muted-foreground">
                <span className="size-2 rounded-sm" style={{ backgroundColor: item.color ?? itemConfig?.color }} />
                {itemConfig?.label ?? item.name ?? key}
              </span>
              <span className="font-mono font-semibold tabular-nums text-popover-foreground">
                {valueFormatter ? valueFormatter(rawValue, key) : String(rawValue)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
