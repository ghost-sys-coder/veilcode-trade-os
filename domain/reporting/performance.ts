import Decimal from "decimal.js";

import {
  actualRBucketDimension,
  buildAccountCurve,
  calculateAccountReturn,
  calculatePerformanceMetrics,
  entryHourDimension,
  groupPerformance,
  holdingDurationDimension,
  plannedRiskRewardBucketDimension,
  realizedMonthDimension,
  realizedWeekdayDimension,
  riskBucketDimension,
  type AccountCurvePoint,
  type AnalyticsAccount,
  type AnalyticsAdjustment,
  type AnalyticsTrade,
  type DrawdownResult,
  type PerformanceGroup,
  type PerformanceMetrics,
} from "@/domain/analytics/performance";
import { dateKey } from "@/domain/journal/analytics";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { AccountType, TradeDirection, TradingSession } from "@/types/domain";

export interface AnalyticsFilters {
  account?: string;
  from?: string;
  to?: string;
  instrument?: string;
  strategy?: string;
  setup?: string;
  session?: TradingSession;
  direction?: TradeDirection;
  accountType?: AccountType;
  reviewSearch?: string;
}

export interface CurrencyAnalytics {
  currencyCode: string;
  currencyPrecision: number;
  accountCount: number;
  metrics: PerformanceMetrics;
  currentBalance: string;
  openingBalance: string;
  returnPercentage: string | null;
  curve: DrawdownResult;
  incompleteClosedTrades:number;
  balanceComplete:boolean;
  unavailableReason:string|null;
}

export interface AnalyticsBreakdowns {
  instruments: PerformanceGroup[];
  strategies: PerformanceGroup[];
  setups: PerformanceGroup[];
  sessions: PerformanceGroup[];
  directions: PerformanceGroup[];
  weekdays: PerformanceGroup[];
  months: PerformanceGroup[];
  entryHours: PerformanceGroup[];
  riskBuckets: PerformanceGroup[];
  plannedRiskRewardBuckets: PerformanceGroup[];
  actualRBuckets: PerformanceGroup[];
  holdingDurations: PerformanceGroup[];
}

export interface AnalyticsDataset {
  timezone: string;
  filters: AnalyticsFilters;
  accounts: AnalyticsAccount[];
  instruments: Array<{ id: string; symbol: string }>;
  strategies: Array<{ id: string; name: string }>;
  setups: Array<{ id: string; name: string; strategyId: string }>;
  selectedAccountCount: number;
  selectedCurrencyCount: number;
  unitlessMetrics: ReturnType<typeof unitlessPerformance>;
  currencies: CurrencyAnalytics[];
  breakdownsByCurrency: Array<{
    currencyCode: string;
    currencyPrecision: number;
    breakdowns: AnalyticsBreakdowns;
  }>;
}

function optionalNumeric(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : normalizeSupabaseNumeric(value);
}

function addCalendarDay(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + 1));
  return result.toISOString().slice(0, 10);
}

function inRealizedDateRange(
  trade: AnalyticsTrade,
  filters: AnalyticsFilters,
  timezone: string,
): boolean {
  if (!filters.from && !filters.to) return true;
  if (!trade.closedAt) return false;
  const key = dateKey(trade.closedAt, timezone);
  if (filters.from && key < filters.from) return false;
  if (filters.to && key > filters.to) return false;
  return true;
}

function pointInDateRange(
  point: AccountCurvePoint,
  filters: AnalyticsFilters,
  timezone: string,
): boolean {
  const key = dateKey(point.occurredAt, timezone);
  if (filters.from && key < filters.from) return false;
  if (filters.to && key > filters.to) return false;
  return true;
}

function windowCurve(
  curve: DrawdownResult,
  filters: AnalyticsFilters,
  timezone: string,
  currencyPrecision: number,
  periodNetProfit: string,
): DrawdownResult {
  if (!filters.from && !filters.to) return curve;

  const visible = curve.points.filter((point) => pointInDateRange(point, filters, timezone));
  if (filters.from) {
    const preceding = curve.points
      .filter((point) => dateKey(point.occurredAt, timezone) < filters.from!)
      .at(-1);
    if (preceding) {
      visible.unshift({
        ...preceding,
        id: `period-opening-${preceding.id}`,
        occurredAt: `${filters.from}T00:00:00.000Z`,
        kind: "START",
        label: "Period opening basis",
      });
    }
  }

  if (!curve.available) {
    return { ...curve, points: visible };
  }

  let maximumPoint: AccountCurvePoint | null = null;
  for (const point of visible) {
    if (point.drawdownAmount === null) continue;
    if (!maximumPoint || parseDecimal(point.drawdownAmount).gt(maximumPoint.drawdownAmount ?? "0")) {
      maximumPoint = point;
    }
  }
  const maximumAmount = maximumPoint?.drawdownAmount
    ?? normalizeMoney("0", currencyPrecision);
  const last = visible.at(-1);
  return {
    available: true,
    unclassifiedAdjustmentCount: 0,
    points: visible,
    currentAmount: last?.drawdownAmount ?? normalizeMoney("0", currencyPrecision),
    currentPercentage: last?.drawdownPercentage ?? "0.00",
    maximumAmount,
    maximumPercentage: maximumPoint?.drawdownPercentage ?? "0.00",
    recoveryFactor: parseDecimal(maximumAmount).gt(0)
      ? parseDecimal(periodNetProfit).div(maximumAmount).toFixed(4)
      : null,
  };
}

function openingBalance(curve: DrawdownResult, fallback: string): string {
  return curve.points.at(0)?.balance ?? fallback;
}

function currentBalance(curve: DrawdownResult, fallback: string): string {
  return curve.points.at(-1)?.balance ?? fallback;
}

function currencyBreakdowns(
  trades: readonly AnalyticsTrade[],
  precision: number,
  timezone: string,
): AnalyticsBreakdowns {
  return {
    instruments: groupPerformance(trades, (trade) => ({ key: trade.instrumentId, label: trade.instrument }), precision),
    strategies: groupPerformance(trades, (trade) => ({ key: trade.strategyId ?? "unassigned", label: trade.strategy }), precision),
    setups: groupPerformance(trades, (trade) => ({ key: trade.setupId ?? "unassigned", label: trade.setup }), precision),
    sessions: groupPerformance(trades, (trade) => ({ key: trade.session, label: trade.session.replaceAll("_", " ") }), precision),
    directions: groupPerformance(trades, (trade) => ({ key: trade.direction, label: trade.direction }), precision),
    weekdays: groupPerformance(trades, (trade) => realizedWeekdayDimension(trade, timezone), precision),
    months: groupPerformance(trades, (trade) => realizedMonthDimension(trade, timezone), precision),
    entryHours: groupPerformance(trades, (trade) => entryHourDimension(trade, timezone), precision),
    riskBuckets: groupPerformance(trades, riskBucketDimension, precision),
    plannedRiskRewardBuckets: groupPerformance(trades, plannedRiskRewardBucketDimension, precision),
    actualRBuckets: groupPerformance(trades, actualRBucketDimension, precision),
    holdingDurations: groupPerformance(trades, holdingDurationDimension, precision),
  };
}

import type { ReportingRows } from "@/domain/reporting/rows";
import {completedRuleCompliance,validActualR,matchesAnalyticsDimensions,unitlessPerformance,calculateUnitlessPerformance} from "@/domain/reporting/evidence";
export function buildPerformanceAnalytics(rows:ReportingRows,filters:AnalyticsFilters={}):AnalyticsDataset {
  const timezone=rows.timezone;
  const accountsResult={data:rows.accounts},instrumentsResult={data:rows.instruments},strategiesResult={data:rows.strategies},setupsResult={data:rows.setups};
  const accounts: AnalyticsAccount[] = (accountsResult.data ?? []).map((item) => ({
    id: item.id,
    name: item.name,
    accountType: item.account_type,
    currencyCode: item.currency_code,
    currencyPrecision: item.currency_precision,
    startingBalance: normalizeMoney(normalizeSupabaseNumeric(item.starting_balance), item.currency_precision),
    startedAt: item.started_at,
  }));
  const selectedAccounts = accounts.filter((account) => {
    if (filters.account && account.id !== filters.account) return false;
    if (filters.accountType && account.accountType !== filters.accountType) return false;
    return true;
  });
  const selectedAccountIds = selectedAccounts.map((account) => account.id);
  const instruments = instrumentsResult.data ?? [];
  const strategies = strategiesResult.data ?? [];
  const setups = setupsResult.data ?? [];

  if (selectedAccountIds.length === 0) {
    return {
      timezone,
      filters,
      accounts,
      instruments,
      strategies: strategiesResult.data ?? [],
      setups: setups.map((item) => ({ id: item.id, name: item.name, strategyId: item.strategy_id })),
      selectedAccountCount: 0,
      selectedCurrencyCount: 0,
      unitlessMetrics: unitlessPerformance(calculatePerformanceMetrics([], 2)),
      currencies: [],
      breakdownsByCurrency: [],
    };
  }

  const tradeRows=rows.trades, adjustmentRows=rows.adjustments, ruleReviewRows=rows.ruleReviews, ruleReviewItemRows=rows.ruleItems;

  const accountById = new Map(selectedAccounts.map((item) => [item.id, item]));
  const instrumentById = new Map(instruments.map((item) => [item.id, item.symbol]));
  const strategyById = new Map(strategies.map((item) => [item.id, item.name]));
  const setupById = new Map(setups.map((item) => [item.id, item.name]));
  const itemsByReview = new Map<string, ReportingRows["ruleItems"]>();
  for (const item of ruleReviewItemRows) {
    itemsByReview.set(item.review_id, [...(itemsByReview.get(item.review_id) ?? []), item]);
  }
  const ruleReviewByTrade = new Map(ruleReviewRows.map((review) => [review.trade_id, review]));

  const allTrades = tradeRows.map((item): AnalyticsTrade | null => {
    const ownerAccount = accountById.get(item.account_id);
    if (!ownerAccount) return null;
    const ruleReview = ruleReviewByTrade.get(item.id);
    const ruleItems = ruleReview ? itemsByReview.get(ruleReview.id) ?? [] : [];
    const ruleViolations = ruleItems.filter((result) => !result.complied).length;
    const ruleCompliance = completedRuleCompliance(ruleReview,ruleItems);

    return {
      id: item.id,
      accountId: item.account_id,
      accountName: ownerAccount.name,
      accountType: ownerAccount.accountType,
      currencyCode: ownerAccount.currencyCode,
      currencyPrecision: ownerAccount.currencyPrecision,
      status: item.status,
      openedAt: item.opened_at,
      closedAt: item.closed_at,
      outcome: item.outcome,
      netPnl: item.net_pnl===null?null:normalizeMoney(item.net_pnl,ownerAccount.currencyPrecision),
      grossPnl: optionalNumeric(item.gross_pnl),
      commission: normalizeSupabaseNumeric(item.commission),
      swap: normalizeSupabaseNumeric(item.swap),
      otherFees: normalizeSupabaseNumeric(item.other_fees),
      actualR: validActualR(item,ownerAccount.currencyPrecision),
      plannedRiskPercentage: optionalNumeric(item.planned_risk_percentage),
      plannedRiskReward: optionalNumeric(item.planned_risk_reward),
      actualLotSize: optionalNumeric(item.actual_lot_size),
      holdingDurationSeconds: item.holding_duration_seconds,
      instrumentId: item.instrument_id,
      instrument: instrumentById.get(item.instrument_id) ?? "Unknown instrument",
      strategyId: item.strategy_id,
      strategy: item.strategy_id ? strategyById.get(item.strategy_id) ?? "Unknown strategy" : "Unassigned",
      setupId: item.setup_id,
      setup: item.setup_id ? setupById.get(item.setup_id) ?? "Unknown setup" : "Unassigned",
      session: item.session,
      direction: item.direction,
      ruleCompliance,
      ruleViolations: ruleCompliance === "NOT_REVIEWED" ? 0 : ruleViolations,
    };
  }).filter((item): item is AnalyticsTrade => item !== null);

  const reviewSearch=filters.reviewSearch?.trim().toLocaleLowerCase();
  const reviewedText=new Map(rows.reviews.filter(r=>r.reviewed_at).map(r=>[r.trade_id,[r.what_went_well,r.what_went_wrong,r.improvement,r.lesson_learned].filter(Boolean).join(" ").toLocaleLowerCase()]));
  const selectedTrades = allTrades.filter((trade) => matchesAnalyticsDimensions(trade,filters) && inRealizedDateRange(trade, filters, timezone)
    && (!reviewSearch||reviewedText.get(trade.id)?.includes(reviewSearch)));
  const endExclusive = filters.to ? addCalendarDay(filters.to) : null;
  const relevantHistoryTrades = allTrades.filter((trade) => {
    if (trade.status !== "CLOSED" || !trade.closedAt || !trade.netPnl || !trade.outcome) return false;
    return endExclusive ? dateKey(trade.closedAt, timezone) < endExclusive : true;
  });
  const allAdjustments: AnalyticsAdjustment[] = adjustmentRows
    .map((item) => ({
      id: item.id,
      accountId: item.account_id,
      occurredAt: item.occurred_at,
      amount: normalizeSupabaseNumeric(item.amount),
      type: item.type,
      isPerformanceNeutral: item.is_performance_neutral,
    }))
    .filter((item) => endExclusive ? dateKey(item.occurredAt, timezone) < endExclusive : true);

  const currencyCodes = [...new Set(selectedAccounts.map((item) => item.currencyCode))].toSorted();
  const currencies = currencyCodes.map((currencyCode): CurrencyAnalytics => {
    const currencyAccounts = selectedAccounts.filter((item) => item.currencyCode === currencyCode);
    const currencyAccountIds = new Set(currencyAccounts.map((item) => item.id));
    const precision = Math.max(...currencyAccounts.map((item) => item.currencyPrecision));
    const periodTrades = selectedTrades.filter((trade) => currencyAccountIds.has(trade.accountId));
    const historyTrades = relevantHistoryTrades.filter((trade) => currencyAccountIds.has(trade.accountId));
    const adjustments = allAdjustments.filter((item) => currencyAccountIds.has(item.accountId));
    const metrics = calculatePerformanceMetrics(periodTrades, precision);
    const orderedAccounts = currencyAccounts.toSorted((left, right) => left.startedAt.localeCompare(right.startedAt)
      || left.id.localeCompare(right.id));
    const firstAccount = orderedAccounts[0];
    const startingBalance = normalizeMoney(firstAccount.startingBalance, precision);
    const accountOpeningAdjustments: AnalyticsAdjustment[] = orderedAccounts.slice(1).map((item) => ({
      id: `account-opening-${item.id}`,
      accountId: item.id,
      occurredAt: item.startedAt,
      amount: normalizeMoney(item.startingBalance, precision),
      type: "DEPOSIT",
      isPerformanceNeutral: true,
    }));
    const portfolioAccount: AnalyticsAccount = {
      id: `portfolio-${currencyCode}`,
      name: `${currencyCode} portfolio`,
      accountType: firstAccount.accountType,
      currencyCode,
      currencyPrecision: precision,
      startingBalance,
      startedAt: firstAccount.startedAt,
    };
    const fullCurve = buildAccountCurve({
      account: portfolioAccount,
      trades: historyTrades,
      adjustments: [...accountOpeningAdjustments, ...adjustments],
    });
    const incompleteClosedTrades=allTrades.filter(t=>currencyAccountIds.has(t.accountId)&&t.status==="CLOSED"&&(!t.closedAt||!endExclusive||dateKey(t.closedAt,timezone)<endExclusive)&&(!t.closedAt||t.netPnl===null||t.outcome===null)).length;
    const windowed = windowCurve(fullCurve, filters, timezone, precision, metrics.netProfit);
    const curve:DrawdownResult=incompleteClosedTrades?{available:false,unclassifiedAdjustmentCount:fullCurve.unclassifiedAdjustmentCount,points:windowed.points.map(p=>({...p,drawdownAmount:null,drawdownPercentage:null})),currentAmount:null,currentPercentage:null,maximumAmount:null,maximumPercentage:null,recoveryFactor:null}:windowed;
    const opening = filters.from
      ? openingBalance(curve, startingBalance)
      : normalizeMoney(
        orderedAccounts.reduce((total, item) => total.plus(item.startingBalance), new Decimal(0)),
        precision,
      );
    return {
      currencyCode,
      currencyPrecision: precision,
      accountCount: currencyAccounts.length,
      metrics,
      currentBalance: currentBalance(curve, startingBalance),
      openingBalance: opening,
      returnPercentage: calculateAccountReturn(metrics.netProfit, opening),
      curve,
      incompleteClosedTrades,balanceComplete:incompleteClosedTrades===0,
      unavailableReason:incompleteClosedTrades?`Drawdown and authoritative balance unavailable: ${incompleteClosedTrades} closed trade(s) require final result or closure dates.`:curve.available?null:`Drawdown unavailable: ${curve.unclassifiedAdjustmentCount} account adjustment(s) require performance classification.`,
    };
  });

  const breakdownsByCurrency = currencyCodes.map((currencyCode) => {
    const currencyTrades = selectedTrades.filter((trade) => trade.currencyCode === currencyCode);
    const currencyAccounts = selectedAccounts.filter((item) => item.currencyCode === currencyCode);
    const precision = Math.max(...currencyAccounts.map((item) => item.currencyPrecision));
    return {
      currencyCode,
      currencyPrecision: precision,
      breakdowns: currencyBreakdowns(currencyTrades, precision, timezone),
    };
  });

  return {
    timezone,
    filters,
    accounts,
    instruments,
    strategies,
    setups: setups.map((item) => ({ id: item.id, name: item.name, strategyId: item.strategy_id })),
    selectedAccountCount: selectedAccounts.length,
    selectedCurrencyCount: currencyCodes.length,
    unitlessMetrics: calculateUnitlessPerformance(selectedTrades),
    currencies,
    breakdownsByCurrency,
  };
}
