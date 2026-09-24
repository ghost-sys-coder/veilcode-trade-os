"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
} from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { AccountCurvePoint } from "@/domain/analytics/performance";

interface PerformanceChartsProps {
  points: AccountCurvePoint[];
  currencyCode: string;
  currencyPrecision: number;
}

function chartDate(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "2-digit" }).format(new Date(value));
}

function exact(value: number | string, precision: number): string {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(precision) : String(value);
}

export function BalancePerformanceChart({ points, currencyCode, currencyPrecision }: PerformanceChartsProps) {
  const data = points.map((point) => ({
    ...point,
    balanceValue: Number(point.balance),
    pnlValue: Number(point.cumulativePnl),
  }));
  const config = {
    balanceValue: { label: "Balance", color: "var(--chart-1)" },
    pnlValue: { label: "Cumulative PnL", color: "var(--chart-2)" },
  } satisfies ChartConfig;

  if (data.length < 2) {
    return <p className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">No realized balance movement in this selection.</p>;
  }

  return (
    <ChartContainer config={config} aria-label={`${currencyCode} balance and cumulative realized PnL chart`}>
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 12, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="occurredAt" tickFormatter={chartDate} minTickGap={28} tickLine={false} axisLine={false} />
        <YAxis yAxisId="balance" tickLine={false} axisLine={false} width={72} tickFormatter={(value) => exact(value, 0)} />
        <YAxis yAxisId="pnl" orientation="right" tickLine={false} axisLine={false} width={64} tickFormatter={(value) => exact(value, 0)} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => chartDate(String(label))} valueFormatter={(value) => `${currencyCode} ${exact(value, currencyPrecision)}`} />} />
        <Line yAxisId="balance" type="monotone" dataKey="balanceValue" stroke="var(--color-balanceValue)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
        <Line yAxisId="pnl" type="monotone" dataKey="pnlValue" stroke="var(--color-pnlValue)" strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ChartContainer>
  );
}

export function CumulativeRChart({ points }: Pick<PerformanceChartsProps, "points">) {
  const data = points
    .filter((point) => point.cumulativeR !== null)
    .map((point) => ({ ...point, rValue: Number(point.cumulativeR) }));
  const config = { rValue: { label: "Cumulative R", color: "var(--chart-4)" } } satisfies ChartConfig;
  if (data.length < 2) {
    return <p className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">Cumulative R needs at least two closed trades with valid actual R.</p>;
  }
  return (
    <ChartContainer config={config} aria-label="Cumulative actual R chart">
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 12, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="occurredAt" tickFormatter={chartDate} minTickGap={28} tickLine={false} axisLine={false} />
        <YAxis tickLine={false} axisLine={false} width={54} tickFormatter={(value) => `${exact(value, 1)}R`} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => chartDate(String(label))} valueFormatter={(value) => `${exact(value, 2)}R`} />} />
        <Line type="monotone" dataKey="rValue" stroke="var(--color-rValue)" strokeWidth={2.25} dot={false} activeDot={{ r: 4 }} />
      </ComposedChart>
    </ChartContainer>
  );
}

export function DrawdownChart({ points, currencyCode, currencyPrecision }: PerformanceChartsProps) {
  const data = points
    .filter((point) => point.drawdownAmount !== null)
    .map((point) => ({
      ...point,
      amountValue: Number(point.drawdownAmount),
      percentageValue: point.drawdownPercentage === null ? null : Number(point.drawdownPercentage),
    }));
  const config = {
    amountValue: { label: "Drawdown amount", color: "var(--loss)" },
    percentageValue: { label: "Drawdown percentage", color: "var(--chart-3)" },
  } satisfies ChartConfig;
  if (data.length < 2) {
    const classificationBlocked = points.length > 0 && points.every((point) => point.drawdownAmount === null);
    return (
      <p className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
        {classificationBlocked
          ? "No authoritative drawdown series is available until adjustment classification is complete."
          : "Drawdown needs at least one realized balance movement."}
      </p>
    );
  }
  return (
    <ChartContainer config={config} aria-label={`${currencyCode} realized balance drawdown chart`}>
      <ComposedChart data={data} margin={{ left: 4, right: 8, top: 12, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="occurredAt" tickFormatter={chartDate} minTickGap={28} tickLine={false} axisLine={false} />
        <YAxis yAxisId="amount" tickLine={false} axisLine={false} width={64} tickFormatter={(value) => exact(value, 0)} />
        <YAxis yAxisId="percentage" orientation="right" tickLine={false} axisLine={false} width={56} tickFormatter={(value) => `${exact(value, 1)}%`} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={(label) => chartDate(String(label))} valueFormatter={(value, name) => name === "percentageValue" ? `${exact(value, 2)}%` : `${currencyCode} ${exact(value, currencyPrecision)}`} />} />
        <Area yAxisId="amount" type="monotone" dataKey="amountValue" stroke="var(--color-amountValue)" fill="var(--color-amountValue)" fillOpacity={0.16} strokeWidth={2} />
        <Line yAxisId="percentage" type="monotone" dataKey="percentageValue" stroke="var(--color-percentageValue)" strokeWidth={1.75} dot={false} />
      </ComposedChart>
    </ChartContainer>
  );
}
