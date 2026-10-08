import Decimal from "decimal.js";

import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import type { TradeOutcome } from "@/types/domain";

export interface RealizedTradeMetric {
  id: string;
  closedAt: string | null;
  outcome: TradeOutcome | null;
  netPnl: string | null;
  actualR: string | null;
  plannedRiskAmount: string | null;
}

export interface PerformanceSummary {
  trades: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: string | null;
  netPnl: string;
  totalR: string;
  averageR: string | null;
  totalPlannedRisk: string;
}

export interface BalanceTimelineTrade {
  id: string;
  closedAt: string;
  netPnl: string;
  label: string;
}

export interface BalanceTimelineAdjustment {
  id: string;
  occurredAt: string;
  amount: string;
  label: string;
}

export interface BalanceTimelineEvent {
  id: string;
  occurredAt: string;
  kind: "START" | "ADJUSTMENT" | "TRADE";
  label: string;
  amount: string;
  balance: string;
}

export function journalDate(trade: { openedAt?: string | null; plannedAt?: string | null; createdAt: string }): string {
  return trade.openedAt ?? trade.plannedAt ?? trade.createdAt;
}

const dateFormatters=new Map<string,Intl.DateTimeFormat>();
export function dateKey(value: string, timezone: string): string {
  let formatter=dateFormatters.get(timezone);
  if(!formatter){formatter=new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });if(dateFormatters.size>=32)dateFormatters.delete(dateFormatters.keys().next().value!);dateFormatters.set(timezone,formatter);}
  // Cache only immutable locale formatters, never user records or date values.
  const parts = formatter.formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

export function summarizePerformance(trades: readonly RealizedTradeMetric[], currencyPrecision: number): PerformanceSummary {
  const closed = trades.filter((trade) => trade.closedAt && trade.outcome && trade.netPnl !== null);
  const wins = closed.filter((trade) => trade.outcome === "WIN" || trade.outcome === "PARTIAL_WIN").length;
  const losses = closed.filter((trade) => trade.outcome === "LOSS" || trade.outcome === "PARTIAL_LOSS").length;
  const breakEvens = closed.filter((trade) => trade.outcome === "BREAK_EVEN").length;
  const netPnl = closed.reduce((total, trade) => total.plus(parseDecimal(trade.netPnl ?? "0")), new Decimal(0));
  const rValues = closed.filter((trade) => trade.actualR !== null).map((trade) => parseDecimal(trade.actualR ?? "0"));
  const totalR = rValues.reduce((total, value) => total.plus(value), new Decimal(0));
  const risk = closed.reduce((total, trade) => total.plus(parseDecimal(trade.plannedRiskAmount ?? "0")), new Decimal(0));
  const decisive = wins + losses;

  return {
    trades: closed.length,
    wins,
    losses,
    breakEvens,
    winRate: decisive ? new Decimal(wins).div(decisive).times(100).toFixed(2) : null,
    netPnl: normalizeMoney(netPnl, currencyPrecision),
    totalR: totalR.toFixed(8),
    averageR: rValues.length ? totalR.div(rValues.length).toFixed(8) : null,
    totalPlannedRisk: normalizeMoney(risk, currencyPrecision),
  };
}

export function buildBalanceTimeline(input: {
  startingBalance: string;
  startedAt: string;
  currencyPrecision: number;
  trades: readonly BalanceTimelineTrade[];
  adjustments: readonly BalanceTimelineAdjustment[];
}): BalanceTimelineEvent[] {
  const events = [
    ...input.adjustments.map((adjustment) => ({ ...adjustment, kind: "ADJUSTMENT" as const })),
    ...input.trades.map((trade) => ({
      id: trade.id,
      occurredAt: trade.closedAt,
      amount: trade.netPnl,
      label: trade.label,
      kind: "TRADE" as const,
    })),
  ].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
    || left.kind.localeCompare(right.kind)
    || left.id.localeCompare(right.id));

  let balance = normalizeMoney(input.startingBalance, input.currencyPrecision);
  const timeline: BalanceTimelineEvent[] = [{
    id: "starting-balance",
    occurredAt: input.startedAt,
    kind: "START",
    label: "Starting balance",
    amount: balance,
    balance,
  }];

  for (const event of events) {
    balance = normalizeMoney(parseDecimal(balance).plus(parseDecimal(event.amount)), input.currencyPrecision);
    timeline.push({ ...event, amount: normalizeMoney(event.amount, input.currencyPrecision), balance });
  }

  return timeline;
}

export function groupRealizedTradesByDate(trades: readonly RealizedTradeMetric[], timezone: string): Map<string, RealizedTradeMetric[]> {
  const grouped = new Map<string, RealizedTradeMetric[]>();
  for (const trade of trades) {
    if (!trade.closedAt || !trade.outcome || trade.netPnl === null) continue;
    const key = dateKey(trade.closedAt, timezone);
    grouped.set(key, [...(grouped.get(key) ?? []), trade]);
  }
  return grouped;
}

export function escapeCsv(value: unknown): string {
  const original = value === null || value === undefined ? "" : String(value);
  // Spreadsheet formula injection: preserve valid signed decimal evidence,
  // but make executable/free-text prefixes literal, including leading controls.
  const decimal=/^-?\d+(?:\.\d+)?$/;
  const text = !decimal.test(original) && (/^[\t\r\n]/.test(original) || /^[\s]*[=+@-]/.test(original)) ? `'${original}` : original;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function normalizeAdjustmentAmount(type: "DEPOSIT" | "WITHDRAWAL" | "BALANCE_CORRECTION" | "OTHER", amount: string): string {
  const value = parseDecimal(amount);
  if (type === "DEPOSIT") return value.abs().toString();
  if (type === "WITHDRAWAL") return value.abs().negated().toString();
  return value.toString();
}

export function plannedActualComparison(input: {
  plannedEntry: string | null; actualEntry: string | null;
  plannedStop: string | null; actualStop: string | null;
  plannedTarget: string | null; actualExit: string | null;
  plannedVolume: string | null; actualVolume: string | null;
  plannedRisk: string | null; netPnl: string | null;
  plannedRr: string | null; actualR: string | null;
}, currencyCode: string) {
  return [
    { label: "Entry price", planned: input.plannedEntry, actual: input.actualEntry, unit: "price" },
    { label: "Stop price", planned: input.plannedStop, actual: input.actualStop, unit: "price" },
    { label: "Target / final exit", planned: input.plannedTarget, actual: input.actualExit, unit: "price (intent vs final exit)" },
    { label: "Position volume", planned: input.plannedVolume, actual: input.actualVolume, unit: "lots" },
    { label: "Risk / final result", planned: input.plannedRisk, actual: input.netPnl, unit: `${currencyCode} (budget vs outcome)` },
    { label: "Reward-to-risk / realized R", planned: input.plannedRr, actual: input.actualR, unit: "R (plan ratio vs realized multiple)" },
  ];
}
