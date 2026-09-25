"use client";

import { Area, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { chartDate, exactChartValue } from "@/features/analytics/chart-format";
import type { PerformanceChartsProps } from "@/features/analytics/performance-chart-types";

export function DrawdownChart({ points, currencyCode, currencyPrecision }: PerformanceChartsProps) {
  const data = points.filter((point) => point.drawdownAmount !== null).map((point) => ({ ...point, amountValue: Number(point.drawdownAmount), percentageValue: point.drawdownPercentage === null ? null : Number(point.drawdownPercentage) }));
  const config = {
    amountValue: { label: "Drawdown amount", color: "var(--loss)" },
    percentageValue: { label: "Drawdown percentage", color: "var(--chart-3)" },
  } satisfies ChartConfig;
  if (data.length < 2) {
    const classificationBlocked = points.length > 0 && points.every((point) => point.drawdownAmount === null);
    return <p className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">{classificationBlocked ? "No authoritative drawdown series is available until adjustment classification is complete." : "Drawdown needs at least one realized balance movement."}</p>;
  }
  return <ChartContainer config={config} aria-label={`${currencyCode} realized balance drawdown chart`}><ComposedChart data={data} margin={{ left: 4, right: 8, top: 12, bottom: 0 }} accessibilityLayer><CartesianGrid vertical={false} /><XAxis dataKey="occurredAt" tickFormatter={chartDate} minTickGap={28} tickLine={false} axisLine={false} /><YAxis yAxisId="amount" tickLine={false} axisLine={false} width={64} tickFormatter={(value) => exactChartValue(value, 0)} /><YAxis yAxisId="percentage" orientation="right" tickLine={false} axisLine={false} width={56} tickFormatter={(value) => `${exactChartValue(value, 1)}%`} /><ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => chartDate(String(label))} valueFormatter={(value, name) => name === "percentageValue" ? `${exactChartValue(value, 2)}%` : `${currencyCode} ${exactChartValue(value, currencyPrecision)}`} />} /><Area yAxisId="amount" type="monotone" dataKey="amountValue" stroke="var(--color-amountValue)" fill="var(--color-amountValue)" fillOpacity={0.16} strokeWidth={2} /><Line yAxisId="percentage" type="monotone" dataKey="percentageValue" stroke="var(--color-percentageValue)" strokeWidth={1.75} dot={false} /></ComposedChart></ChartContainer>;
}
