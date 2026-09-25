"use client";

import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { chartDate, exactChartValue } from "@/features/analytics/chart-format";
import type { PerformanceChartsProps } from "@/features/analytics/performance-chart-types";

export function CumulativeRChart({ points }: Pick<PerformanceChartsProps, "points">) {
  const data = points.filter((point) => point.cumulativeR !== null).map((point) => ({ ...point, rValue: Number(point.cumulativeR) }));
  const config = { rValue: { label: "Cumulative R", color: "var(--chart-4)" } } satisfies ChartConfig;
  if (data.length < 2) return <p className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Cumulative R needs at least two closed trades with valid actual R.</p>;
  return <ChartContainer config={config} aria-label="Cumulative actual R chart"><ComposedChart data={data} margin={{ left: 4, right: 8, top: 12, bottom: 0 }} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="occurredAt" tickFormatter={chartDate} minTickGap={28} tickLine={false} axisLine={false} /><YAxis tickLine={false} axisLine={false} width={54} tickFormatter={(value) => `${exactChartValue(value, 1)}R`} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => chartDate(String(label))} valueFormatter={(value) => `${exactChartValue(value, 2)}R`} />} /><Line type="monotone" dataKey="rValue" stroke="var(--color-rValue)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} /></ComposedChart></ChartContainer>;
}
