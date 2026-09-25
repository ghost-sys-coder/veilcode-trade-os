"use client";

import * as React from "react";
import { ResponsiveContainer } from "recharts";

import { ChartContext, type ChartConfig } from "@/components/ui/chart-context";
import { cn } from "@/lib/utils";

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
