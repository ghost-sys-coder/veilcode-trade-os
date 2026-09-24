"use client";

import * as React from "react";
import { ResponsiveContainer, Tooltip } from "recharts";
import type { TooltipContentProps } from "recharts";

import { cn } from "@/lib/utils";

export type ChartConfig = Record<string, {
  label: React.ReactNode;
  color: string;
}>;

const ChartContext = React.createContext<ChartConfig>({});

export function ChartContainer({
  config,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof ResponsiveContainer>["children"];
}) {
  const style = Object.fromEntries(
    Object.entries(config).map(([key, item]) => [`--color-${key}`, item.color]),
  ) as React.CSSProperties;

  return (
    <ChartContext.Provider value={config}>
      <div
        data-slot="chart"
        className={cn(
          "flex aspect-[16/7] min-h-64 w-full justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/60 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border",
          className,
        )}
        style={style}
        {...props}
      >
        <ResponsiveContainer>{children}</ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

export const ChartTooltip = Tooltip;

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
                {valueFormatter
                  ? valueFormatter(rawValue, key)
                  : String(rawValue)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
