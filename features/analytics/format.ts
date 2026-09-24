import Decimal from "decimal.js";

import type { ProfitFactor, StreakMetrics } from "@/domain/analytics/performance";

export { formatHoldingDuration } from "@/domain/analytics/performance";

export function formatDecimal(value: string, precision = 2): string {
  const fixed = new Decimal(value).toFixed(precision);
  const negative = fixed.startsWith("-");
  const [integer, fraction] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${fraction === undefined ? "" : `.${fraction}`}`;
}

export function formatMoney(code: string, value: string, precision: number): string {
  return `${code} ${formatDecimal(value, precision)}`;
}

export function formatPercent(value: string | null): string {
  return value === null ? "Not enough data" : `${formatDecimal(value, 2)}%`;
}

export function formatR(value: string | null): string {
  if (value === null) return "Not enough data";
  const decimal = new Decimal(value);
  const prefix = decimal.gt(0) ? "+" : "";
  return `${prefix}${formatDecimal(value, 2)}R`;
}

export function formatProfitFactor(value: ProfitFactor): string {
  if (value.state === "NO_LOSING_TRADES") return "No losing trades";
  if (value.state === "UNDEFINED") return "Not enough data";
  return formatDecimal(value.value, 2);
}

export function formatCurrentStreak(streaks: StreakMetrics): string {
  if (streaks.currentWinning > 0) return `${streaks.currentWinning}W`;
  if (streaks.currentLosing > 0) return `${streaks.currentLosing}L`;
  return "—";
}
