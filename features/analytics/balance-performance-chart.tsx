"use client";

import { CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { chartDate, exactChartValue } from "@/features/analytics/chart-format";
import type { PerformanceChartsProps } from "@/features/analytics/performance-chart-types";

export function BalancePerformanceChart({ points, currencyCode, currencyPrecision }: PerformanceChartsProps) {
  const data = points.map((point) => ({ ...point, balanceValue: Number(point.balance), pnlValue: Number(point.cumulativePnl) }));
  const config = {
    balanceValue: { label: "Balance", color: "var(--chart-1)" },
    pnlValue: { label: "Cumulative PnL", color: "var(--chart-2)" },
  } satisfies ChartConfig;
  if (data.length < 2) return <p className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">No realized balance movement in this selection.</p>;
  return <ChartContainer config={config} aria-label={`${currencyCode} balance and cumulative realized PnL chart`}><ComposedChart data={data} margin={{ left: 4, right: 8, top: 12, bottom: 0 }} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="occurredAt" tickFormatter={chartDate} minTickGap={28} tickLine={false} axisLine={false} /><YAxis yAxisId="balance" tickLine={false} axisLine={false} width={72} tickFormatter={(value) => exactChartValue(value, 0)} /><YAxis yAxisId="pnl" orientation="right" tickLine={false} axisLine={false} width={64} tickFormatter={(value) => exactChartValue(value, 0)} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => chartDate(String(label))} valueFormatter={(value) => `${currencyCode} ${exactChartValue(value, currencyPrecision)}`} />} /><Line yAxisId="balance" type="monotone" dataKey="balanceValue" stroke="var(--color-balanceValue)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} /><Line yAxisId="pnl" type="monotone" dataKey="pnlValue" stroke="var(--color-pnlValue)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} /></ComposedChart></ChartContainer>;
}
