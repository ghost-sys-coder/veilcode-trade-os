import Decimal from "decimal.js";

import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import type {
  AccountType,
  TradeDirection,
  TradeOutcome,
  TradingSession,
} from "@/types/domain";

export type RuleComplianceState =
  | "FULLY_COMPLIANT"
  | "VIOLATIONS_PRESENT"
  | "NOT_REVIEWED";

export interface AnalyticsTrade {
  id: string;
  accountId: string;
  accountName: string;
  accountType: AccountType;
  currencyCode: string;
  currencyPrecision: number;
  status: "DRAFT" | "PLANNED" | "OPEN" | "CLOSED" | "CANCELED";
  openedAt: string | null;
  closedAt: string | null;
  outcome: TradeOutcome | null;
  netPnl: string | null;
  grossPnl: string | null;
  commission: string;
  swap: string;
  otherFees: string;
  actualR: string | null;
  plannedRiskPercentage: string | null;
  plannedRiskReward: string | null;
  actualLotSize: string | null;
  holdingDurationSeconds: number | null;
  instrumentId: string;
  instrument: string;
  strategyId: string | null;
  strategy: string;
  setupId: string | null;
  setup: string;
  session: TradingSession;
  direction: TradeDirection;
  ruleCompliance: RuleComplianceState;
  ruleViolations: number;
}

export interface AnalyticsAdjustment {
  id: string;
  accountId: string;
  occurredAt: string;
  amount: string;
  type: "DEPOSIT" | "WITHDRAWAL" | "BALANCE_CORRECTION" | "OTHER";
  isPerformanceNeutral: boolean | null;
}

export interface AnalyticsAccount {
  id: string;
  name: string;
  accountType: AccountType;
  currencyCode: string;
  currencyPrecision: number;
  startingBalance: string;
  startedAt: string;
}

export type ProfitFactor =
  | { state: "FINITE"; value: string }
  | { state: "NO_LOSING_TRADES"; value: null }
  | { state: "UNDEFINED"; value: null };

export interface StreakMetrics {
  currentWinning: number;
  currentLosing: number;
  maximumWinning: number;
  maximumLosing: number;
}

export interface PerformanceMetrics {
  totalTrades: number;
  closedTrades: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: string | null;
  winRateSample: number;
  breakEvenRate: string | null;
  grossProfit: string;
  grossLoss: string;
  netProfit: string;
  commission: string;
  swap: string;
  otherFees: string;
  totalFees: string;
  averageWinner: string | null;
  averageLoser: string | null;
  largestWinner: string | null;
  largestLoser: string | null;
  profitFactor: ProfitFactor;
  currencyExpectancy: string | null;
  rExpectancy: string | null;
  rSample: number;
  averageR: string | null;
  averageWinningR: string | null;
  averageLosingR: string | null;
  rDistributionCrossCheck: string | null;
  streaks: StreakMetrics;
  averageHoldingDurationSeconds: number | null;
  averagePlannedRiskPercentage: string | null;
  totalRuleViolations: number;
  ruleComplianceRate: string | null;
  ruleComplianceSample: number;
}

export interface AccountCurvePoint {
  id: string;
  occurredAt: string;
  kind: "START" | "TRADE" | "ADJUSTMENT";
  label: string;
  balance: string;
  cumulativePnl: string;
  cumulativeR: string | null;
  drawdownAmount: string | null;
  drawdownPercentage: string | null;
}

export type DrawdownResult =
  | {
    available: true;
    unclassifiedAdjustmentCount: 0;
    points: AccountCurvePoint[];
    currentAmount: string;
    currentPercentage: string | null;
    maximumAmount: string;
    maximumPercentage: string | null;
    recoveryFactor: string | null;
  }
  | {
    available: false;
    unclassifiedAdjustmentCount: number;
    points: AccountCurvePoint[];
    currentAmount: null;
    currentPercentage: null;
    maximumAmount: null;
    maximumPercentage: null;
    recoveryFactor: null;
  };

export interface PerformanceGroup {
  key: string;
  label: string;
  metrics: PerformanceMetrics;
}

const WINNING_OUTCOMES = new Set<TradeOutcome>(["WIN", "PARTIAL_WIN"]);
const LOSING_OUTCOMES = new Set<TradeOutcome>(["LOSS", "PARTIAL_LOSS"]);

function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((total, value) => total.plus(value), new Decimal(0));
}

function average(values: readonly Decimal[], precision = 8): string | null {
  return values.length ? sum(values).div(values.length).toFixed(precision) : null;
}

function percentage(numerator: number, denominator: number): string | null {
  return denominator > 0
    ? new Decimal(numerator).div(denominator).times(100).toFixed(2)
    : null;
}

export function isQualifyingClosedTrade(
  trade: AnalyticsTrade,
): trade is AnalyticsTrade & {
  closedAt: string;
  outcome: TradeOutcome;
  netPnl: string;
} {
  return trade.status === "CLOSED"
    && trade.closedAt !== null
    && trade.outcome !== null
    && trade.netPnl !== null;
}

export function calculateStreaks(
  trades: readonly AnalyticsTrade[],
): StreakMetrics {
  const ordered = trades
    .filter(isQualifyingClosedTrade)
    .toSorted((left, right) => left.closedAt.localeCompare(right.closedAt)
      || left.id.localeCompare(right.id));

  let currentWinning = 0;
  let currentLosing = 0;
  let maximumWinning = 0;
  let maximumLosing = 0;

  for (const trade of ordered) {
    if (WINNING_OUTCOMES.has(trade.outcome)) {
      currentWinning += 1;
      currentLosing = 0;
      maximumWinning = Math.max(maximumWinning, currentWinning);
    } else if (LOSING_OUTCOMES.has(trade.outcome)) {
      currentLosing += 1;
      currentWinning = 0;
      maximumLosing = Math.max(maximumLosing, currentLosing);
    } else {
      currentWinning = 0;
      currentLosing = 0;
    }
  }

  return { currentWinning, currentLosing, maximumWinning, maximumLosing };
}

export function calculatePerformanceMetrics(
  trades: readonly AnalyticsTrade[],
  currencyPrecision: number,
): PerformanceMetrics {
  const closed = trades.filter(isQualifyingClosedTrade);
  const winners = closed.filter((trade) => WINNING_OUTCOMES.has(trade.outcome));
  const losers = closed.filter((trade) => LOSING_OUTCOMES.has(trade.outcome));
  const breakEvens = closed.filter((trade) => trade.outcome === "BREAK_EVEN");
  const pnlValues = closed.map((trade) => parseDecimal(trade.netPnl));
  const winningPnl = pnlValues.filter((value) => value.gt(0));
  const losingPnl = pnlValues.filter((value) => value.lt(0));
  const grossProfitValue = sum(winningPnl);
  const grossLossValue = sum(losingPnl).abs();
  const netProfitValue = sum(pnlValues);
  const commissions = closed.map((trade) => parseDecimal(trade.commission));
  const swaps = closed.map((trade) => parseDecimal(trade.swap));
  const otherFees = closed.map((trade) => parseDecimal(trade.otherFees));
  const commissionValue = sum(commissions);
  const swapValue = sum(swaps);
  const otherFeesValue = sum(otherFees);
  const rTrades = closed.filter((trade) => trade.actualR !== null);
  const rValues = rTrades.map((trade) => parseDecimal(trade.actualR ?? "0"));
  const winningR = rTrades
    .filter((trade) => WINNING_OUTCOMES.has(trade.outcome))
    .map((trade) => parseDecimal(trade.actualR ?? "0"));
  const losingR = rTrades
    .filter((trade) => LOSING_OUTCOMES.has(trade.outcome))
    .map((trade) => parseDecimal(trade.actualR ?? "0"));
  const riskPercentages = closed
    .filter((trade) => trade.plannedRiskPercentage !== null)
    .map((trade) => parseDecimal(trade.plannedRiskPercentage ?? "0"));
  const holdingDurations = closed
    .map((trade) => trade.holdingDurationSeconds)
    .filter((value): value is number => value !== null);
  const reviewedForRules = closed.filter((trade) => trade.ruleCompliance !== "NOT_REVIEWED");
  const fullyCompliant = reviewedForRules.filter((trade) => trade.ruleCompliance === "FULLY_COMPLIANT");

  let profitFactor: ProfitFactor = { state: "UNDEFINED", value: null };
  if (grossLossValue.gt(0)) {
    profitFactor = { state: "FINITE", value: grossProfitValue.div(grossLossValue).toFixed(4) };
  } else if (grossProfitValue.gt(0)) {
    profitFactor = { state: "NO_LOSING_TRADES", value: null };
  }

  const rCrossCheck = rValues.length
    ? new Decimal(winningR.length)
      .div(rValues.length)
      .times(average(winningR) ?? "0")
      .plus(
        new Decimal(losingR.length)
          .div(rValues.length)
          .times(average(losingR) ?? "0"),
      )
      .toFixed(8)
    : null;

  return {
    totalTrades: trades.length,
    closedTrades: closed.length,
    wins: winners.length,
    losses: losers.length,
    breakEvens: breakEvens.length,
    winRate: percentage(winners.length, winners.length + losers.length),
    winRateSample: winners.length + losers.length,
    breakEvenRate: percentage(breakEvens.length, closed.length),
    grossProfit: normalizeMoney(grossProfitValue, currencyPrecision),
    grossLoss: normalizeMoney(grossLossValue, currencyPrecision),
    netProfit: normalizeMoney(netProfitValue, currencyPrecision),
    commission: normalizeMoney(commissionValue, currencyPrecision),
    swap: normalizeMoney(swapValue, currencyPrecision),
    otherFees: normalizeMoney(otherFeesValue, currencyPrecision),
    totalFees: normalizeMoney(commissionValue.plus(swapValue).plus(otherFeesValue), currencyPrecision),
    averageWinner: winningPnl.length
      ? normalizeMoney(grossProfitValue.div(winningPnl.length), currencyPrecision)
      : null,
    averageLoser: losingPnl.length
      ? normalizeMoney(grossLossValue.div(losingPnl.length), currencyPrecision)
      : null,
    largestWinner: winningPnl.length
      ? normalizeMoney(Decimal.max(...winningPnl), currencyPrecision)
      : null,
    largestLoser: losingPnl.length
      ? normalizeMoney(Decimal.min(...losingPnl).abs(), currencyPrecision)
      : null,
    profitFactor,
    currencyExpectancy: closed.length
      ? normalizeMoney(netProfitValue.div(closed.length), currencyPrecision)
      : null,
    rExpectancy: average(rValues),
    rSample: rValues.length,
    averageR: average(rValues),
    averageWinningR: average(winningR),
    averageLosingR: average(losingR),
    rDistributionCrossCheck: rCrossCheck,
    streaks: calculateStreaks(closed),
    averageHoldingDurationSeconds: holdingDurations.length
      ? Math.round(holdingDurations.reduce((total, value) => total + value, 0) / holdingDurations.length)
      : null,
    averagePlannedRiskPercentage: average(riskPercentages, 6),
    totalRuleViolations: closed.reduce((total, trade) => total + trade.ruleViolations, 0),
    ruleComplianceRate: percentage(fullyCompliant.length, reviewedForRules.length),
    ruleComplianceSample: reviewedForRules.length,
  };
}

export function calculateAccountReturn(
  netProfit: string,
  balanceBasis: string,
): string | null {
  const basis = parseDecimal(balanceBasis);
  return basis.gt(0)
    ? parseDecimal(netProfit).div(basis).times(100).toFixed(2)
    : null;
}

export function groupPerformance(
  trades: readonly AnalyticsTrade[],
  selector: (trade: AnalyticsTrade) => { key: string; label: string },
  currencyPrecision: number,
): PerformanceGroup[] {
  const groups = new Map<string, { label: string; trades: AnalyticsTrade[] }>();
  for (const trade of trades) {
    const dimension = selector(trade);
    const current = groups.get(dimension.key) ?? { label: dimension.label, trades: [] };
    current.trades.push(trade);
    groups.set(dimension.key, current);
  }

  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      metrics: calculatePerformanceMetrics(group.trades, currencyPrecision),
    }))
    .toSorted((left, right) => right.metrics.closedTrades - left.metrics.closedTrades
      || left.label.localeCompare(right.label));
}

function timezoneParts(value: string, timezone: string): Record<string, string> {
  return Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  );
}

export function realizedWeekdayDimension(
  trade: AnalyticsTrade,
  timezone: string,
): { key: string; label: string } {
  if (!trade.closedAt) return { key: "unknown", label: "Not closed" };
  const parts = timezoneParts(trade.closedAt, timezone);
  const order: Record<string, string> = {
    Mon: "1", Tue: "2", Wed: "3", Thu: "4", Fri: "5", Sat: "6", Sun: "7",
  };
  return { key: `${order[parts.weekday] ?? "8"}-${parts.weekday}`, label: parts.weekday };
}

export function realizedMonthDimension(
  trade: AnalyticsTrade,
  timezone: string,
): { key: string; label: string } {
  if (!trade.closedAt) return { key: "unknown", label: "Not closed" };
  const parts = timezoneParts(trade.closedAt, timezone);
  const key = `${parts.year}-${parts.month}`;
  return { key, label: key };
}

export function entryHourDimension(
  trade: AnalyticsTrade,
  timezone: string,
): { key: string; label: string } {
  if (!trade.openedAt) return { key: "unknown", label: "Entry time not recorded" };
  const hour = timezoneParts(trade.openedAt, timezone).hour;
  return { key: hour, label: `${hour}:00` };
}

export function riskBucketDimension(
  trade: AnalyticsTrade,
): { key: string; label: string } {
  if (trade.plannedRiskPercentage === null) {
    return { key: "5-unrecorded", label: "Risk not recorded" };
  }
  const value = parseDecimal(trade.plannedRiskPercentage);
  if (value.lte("0.25")) return { key: "1-le-025", label: "≤ 0.25%" };
  if (value.lte("0.50")) return { key: "2-025-050", label: "> 0.25% to 0.50%" };
  if (value.lte("1.00")) return { key: "3-050-100", label: "> 0.50% to 1.00%" };
  return { key: "4-gt-100", label: "> 1.00%" };
}

export function plannedRiskRewardBucketDimension(
  trade: AnalyticsTrade,
): { key: string; label: string } {
  if (trade.plannedRiskReward === null) {
    return { key: "5-unrecorded", label: "Planned R:R not recorded" };
  }
  const value = parseDecimal(trade.plannedRiskReward);
  if (value.lt("1")) return { key: "1-under-1", label: "Under 1R" };
  if (value.lt("2")) return { key: "2-1-to-2", label: "1R to under 2R" };
  if (value.lt("3")) return { key: "3-2-to-3", label: "2R to under 3R" };
  return { key: "4-3-plus", label: "3R or more" };
}

export function actualRBucketDimension(
  trade: AnalyticsTrade,
): { key: string; label: string } {
  if (trade.actualR === null) {
    return { key: "7-unrecorded", label: "Actual R not recorded" };
  }
  const value = parseDecimal(trade.actualR);
  if (value.lte("-1")) return { key: "1-lte-minus-1", label: "−1R or less" };
  if (value.lt("0")) return { key: "2-minus-1-to-0", label: "> −1R to under 0R" };
  if (value.eq("0")) return { key: "3-zero", label: "0R" };
  if (value.lt("1")) return { key: "4-0-to-1", label: "> 0R to under 1R" };
  if (value.lt("2")) return { key: "5-1-to-2", label: "1R to under 2R" };
  return { key: "6-2-plus", label: "2R or more" };
}

export function holdingDurationDimension(
  trade: AnalyticsTrade,
): { key: string; label: string } {
  const seconds = trade.holdingDurationSeconds;
  if (seconds === null) return { key: "6-unrecorded", label: "Duration not recorded" };
  if (seconds < 15 * 60) return { key: "1-under-15m", label: "Under 15 min" };
  if (seconds < 60 * 60) return { key: "2-15m-1h", label: "15 min to 1 hour" };
  if (seconds < 4 * 60 * 60) return { key: "3-1h-4h", label: "1 to 4 hours" };
  if (seconds < 24 * 60 * 60) return { key: "4-4h-1d", label: "4 hours to 1 day" };
  return { key: "5-over-1d", label: "Over 1 day" };
}

export function buildAccountCurve(input: {
  account: AnalyticsAccount;
  trades: readonly Pick<AnalyticsTrade,"id"|"status"|"closedAt"|"netPnl"|"actualR"|"instrument">[];
  adjustments: readonly AnalyticsAdjustment[];
}): DrawdownResult {
  const { account } = input;
  const trades = input.trades.filter((trade):trade is typeof trade & {closedAt:string;netPnl:string}=>trade.status==="CLOSED" && trade.closedAt!==null && trade.netPnl!==null);
  const unclassifiedAdjustmentCount = input.adjustments.filter(
    (adjustment) => adjustment.type === "OTHER" && adjustment.isPerformanceNeutral === null,
  ).length;
  const drawdownAvailable = unclassifiedAdjustmentCount === 0;
  const events = [
    ...trades.map((trade) => ({
      id: trade.id,
      occurredAt: trade.closedAt,
      kind: "TRADE" as const,
      label: `${trade.instrument} closed`,
      amount: trade.netPnl,
      actualR: trade.actualR,
      performanceNeutral: false,
    })),
    ...input.adjustments.map((adjustment) => ({
      id: adjustment.id,
      occurredAt: adjustment.occurredAt,
      kind: "ADJUSTMENT" as const,
      label: adjustment.type.replaceAll("_", " ").toLowerCase(),
      amount: adjustment.amount,
      actualR: null,
      performanceNeutral: adjustment.isPerformanceNeutral === true,
    })),
  ].toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id));

  let balance = parseDecimal(account.startingBalance);
  let highWaterMark = balance;
  let cumulativePnl = new Decimal(0);
  let cumulativeR = new Decimal(0);
  let rSample = 0;
  let maximumDrawdown = new Decimal(0);
  let maximumDrawdownPercentage: string | null = highWaterMark.gt(0) ? "0.00" : null;
  const points: AccountCurvePoint[] = [{
    id: `start-${account.id}`,
    occurredAt: account.startedAt,
    kind: "START",
    label: "Starting balance",
    balance: normalizeMoney(balance, account.currencyPrecision),
    cumulativePnl: normalizeMoney(cumulativePnl, account.currencyPrecision),
    cumulativeR: null,
    drawdownAmount: drawdownAvailable ? normalizeMoney("0", account.currencyPrecision) : null,
    drawdownPercentage: drawdownAvailable && highWaterMark.gt(0) ? "0.00" : null,
  }];

  for (const event of events) {
    const amount = parseDecimal(event.amount);
    balance = balance.plus(amount);
    if (event.kind === "TRADE") {
      cumulativePnl = cumulativePnl.plus(amount);
      if (event.actualR !== null) {
        cumulativeR = cumulativeR.plus(parseDecimal(event.actualR));
        rSample += 1;
      }
      highWaterMark = Decimal.max(highWaterMark, balance);
    } else if (event.performanceNeutral) {
      highWaterMark = highWaterMark.plus(amount);
    } else {
      highWaterMark = Decimal.max(highWaterMark, balance);
    }

    const drawdown = highWaterMark.minus(balance);
    const drawdownPercentage = highWaterMark.gt(0)
      ? drawdown.div(highWaterMark).times(100).toFixed(4)
      : null;
    if (drawdownAvailable && drawdown.gt(maximumDrawdown)) {
      maximumDrawdown = drawdown;
      maximumDrawdownPercentage = drawdownPercentage;
    }

    points.push({
      id: `${event.kind.toLowerCase()}-${event.id}`,
      occurredAt: event.occurredAt,
      kind: event.kind,
      label: event.label,
      balance: normalizeMoney(balance, account.currencyPrecision),
      cumulativePnl: normalizeMoney(cumulativePnl, account.currencyPrecision),
      cumulativeR: rSample ? cumulativeR.toFixed(8) : null,
      drawdownAmount: drawdownAvailable
        ? normalizeMoney(drawdown, account.currencyPrecision)
        : null,
      drawdownPercentage: drawdownAvailable ? drawdownPercentage : null,
    });
  }

  if (!drawdownAvailable) {
    return {
      available: false,
      unclassifiedAdjustmentCount,
      points,
      currentAmount: null,
      currentPercentage: null,
      maximumAmount: null,
      maximumPercentage: null,
      recoveryFactor: null,
    };
  }

  const last = points.at(-1);
  const netProfit = sum(trades.map((trade) => parseDecimal(trade.netPnl)));
  return {
    available: true,
    unclassifiedAdjustmentCount: 0,
    points,
    currentAmount: last?.drawdownAmount ?? normalizeMoney("0", account.currencyPrecision),
    currentPercentage: last?.drawdownPercentage ?? "0.00",
    maximumAmount: normalizeMoney(maximumDrawdown, account.currencyPrecision),
    maximumPercentage: maximumDrawdownPercentage,
    recoveryFactor: maximumDrawdown.gt(0)
      ? netProfit.div(maximumDrawdown).toFixed(4)
      : null,
  };
}

export function formatHoldingDuration(seconds: number | null): string {
  if (seconds === null) return "Not enough data";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${new Decimal(seconds).div(3_600).toDecimalPlaces(1)}h`;
  return `${new Decimal(seconds).div(86_400).toDecimalPlaces(1)}d`;
}
