import Decimal from "decimal.js";

import { dateKey } from "@/domain/journal/analytics";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";

export type ValueMode = "AMOUNT" | "PERCENT";

export interface PropTradeMetric {
  id: string;
  status: string;
  openedAt: string | null;
  closedAt: string | null;
  netPnl: string | null;
  actualR?: string | null;
}

export interface AmountProgress {
  current: string;
  target: string;
  remaining: string;
  percentage: string;
}

export interface LossBuffer {
  available: boolean;
  reason: string | null;
  limit: string | null;
  used: string | null;
  remaining: string | null;
  basis: string | null;
  measure: string | null;
}

export function configuredAmount(
  mode: ValueMode,
  configuredValue: string,
  percentageBasis: string,
  currencyPrecision: number,
): string {
  const amount = mode === "AMOUNT"
    ? parseDecimal(configuredValue)
    : parseDecimal(percentageBasis).times(configuredValue).div(100);
  return normalizeMoney(amount, currencyPrecision);
}

export function calculateProfitTarget(input: {
  startingBalance: string;
  currentBalance: string;
  mode: ValueMode;
  value: string;
  currencyPrecision: number;
}): AmountProgress {
  const target = configuredAmount(input.mode, input.value, input.startingBalance, input.currencyPrecision);
  const current = normalizeMoney(
    parseDecimal(input.currentBalance).minus(input.startingBalance),
    input.currencyPrecision,
  );
  const remaining = normalizeMoney(
    Decimal.max(parseDecimal(target).minus(current), 0),
    input.currencyPrecision,
  );
  const percentage = parseDecimal(target).isZero()
    ? "0.00"
    : parseDecimal(current).div(target).times(100).toFixed(2);
  return { current, target, remaining, percentage };
}

export function calculateStaticLossBuffer(input: {
  mode: ValueMode;
  value: string;
  percentageBasis: string | null;
  measurementBasis: string | null;
  currentMeasure: string | null;
  currencyPrecision: number;
  unsupportedReason?: string | null;
}): LossBuffer {
  if (input.unsupportedReason) {
    return { available: false, reason: input.unsupportedReason, limit: null, used: null, remaining: null, basis: null, measure: null };
  }
  if (input.percentageBasis === null) {
    return { available: false, reason: "The configured percentage basis is unavailable.", limit: null, used: null, remaining: null, basis: null, measure: null };
  }
  if (input.measurementBasis === null || input.currentMeasure === null) {
    return { available: false, reason: "A required balance or equity snapshot is missing.", limit: null, used: null, remaining: null, basis: null, measure: null };
  }

  const limit = configuredAmount(input.mode, input.value, input.percentageBasis, input.currencyPrecision);
  const used = normalizeMoney(
    Decimal.max(parseDecimal(input.measurementBasis).minus(input.currentMeasure), 0),
    input.currencyPrecision,
  );
  const remaining = normalizeMoney(parseDecimal(limit).minus(used), input.currencyPrecision);
  return {
    available: true,
    reason: null,
    limit,
    used,
    remaining,
    basis: normalizeMoney(input.measurementBasis, input.currencyPrecision),
    measure: normalizeMoney(input.currentMeasure, input.currencyPrecision),
  };
}

export function calculateConsistency(
  trades: readonly PropTradeMetric[],
  timezone: string,
): { available: boolean; percentage: string | null; bestDayProfit: string; totalPositiveProfit: string; reason: string | null } {
  const daily = new Map<string, Decimal>();
  for (const trade of trades) {
    if (trade.status !== "CLOSED" || !trade.closedAt || trade.netPnl === null) continue;
    const key = dateKey(trade.closedAt, timezone);
    daily.set(key, (daily.get(key) ?? new Decimal(0)).plus(trade.netPnl));
  }
  const positiveDays = [...daily.values()].filter((value) => value.gt(0));
  if (positiveDays.length === 0) {
    return { available: false, percentage: null, bestDayProfit: "0", totalPositiveProfit: "0", reason: "No positive realized trading day is available yet." };
  }
  const best = Decimal.max(...positiveDays);
  const total = positiveDays.reduce((sum, value) => sum.plus(value), new Decimal(0));
  return {
    available: true,
    percentage: best.div(total).times(100).toFixed(2),
    bestDayProfit: best.toString(),
    totalPositiveProfit: total.toString(),
    reason: null,
  };
}

export function summarizeTradingDays(
  trades: readonly PropTradeMetric[],
  timezone: string,
  profitableDayMinimum: string,
): { tradingDays: number; profitableDays: number; losingDays: number; breakEvenDays: number } {
  const openedDays = new Set<string>();
  const realizedByDay = new Map<string, Decimal>();
  for (const trade of trades) {
    if (trade.openedAt) openedDays.add(dateKey(trade.openedAt, timezone));
    if (trade.status === "CLOSED" && trade.closedAt && trade.netPnl !== null) {
      const key = dateKey(trade.closedAt, timezone);
      realizedByDay.set(key, (realizedByDay.get(key) ?? new Decimal(0)).plus(trade.netPnl));
    }
  }
  const threshold = parseDecimal(profitableDayMinimum);
  let profitableDays = 0;
  let losingDays = 0;
  let breakEvenDays = 0;
  for (const value of realizedByDay.values()) {
    if (value.gt(0) && value.gte(threshold)) profitableDays += 1;
    else if (value.lt(0)) losingDays += 1;
    else breakEvenDays += 1;
  }
  return { tradingDays: openedDays.size, profitableDays, losingDays, breakEvenDays };
}

export function goalProgressPercentage(current: string, target: string): string {
  if (parseDecimal(target).lte(0)) return "0.00";
  return Decimal.max(0, Decimal.min(parseDecimal(current).div(target).times(100), 100)).toFixed(2);
}
