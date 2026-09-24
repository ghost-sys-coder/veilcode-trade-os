import type { SupabaseClient } from "@supabase/supabase-js";
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
import type { Database } from "@/types/database";
import type { AccountType, TradeDirection, TradingSession } from "@/types/domain";

const ANALYTICS_PAGE_SIZE = 1_000;

async function collectRows<Row>(
  loadPage: (from: number, to: number) => Promise<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += ANALYTICS_PAGE_SIZE) {
    const result = await loadPage(from, from + ANALYTICS_PAGE_SIZE - 1);
    if (result.error) throw new Error(result.error.message);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < ANALYTICS_PAGE_SIZE) return rows;
  }
}

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
  unitlessMetrics: PerformanceMetrics;
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

export async function getPerformanceAnalytics(
  supabase: SupabaseClient<Database>,
  filters: AnalyticsFilters = {},
): Promise<AnalyticsDataset> {
  const [profileResult, accountsResult, instrumentsResult, strategiesResult, setupsResult, rulesResult] = await Promise.all([
    supabase.from("profiles").select("timezone").maybeSingle(),
    supabase.from("trading_accounts").select("id,name,account_type,currency_code,currency_precision,starting_balance,started_at,status").order("name"),
    supabase.from("instruments").select("id,symbol").order("symbol"),
    supabase.from("strategies").select("id,name").order("name"),
    supabase.from("setups").select("id,name,strategy_id").order("name"),
    supabase.from("trading_rules").select("id,account_id").eq("active", true),
  ]);
  const referenceError = profileResult.error ?? accountsResult.error ?? instrumentsResult.error
    ?? strategiesResult.error ?? setupsResult.error ?? rulesResult.error;
  if (referenceError) throw new Error(referenceError.message);

  const timezone = profileResult.data?.timezone ?? "Africa/Kampala";
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
      unitlessMetrics: calculatePerformanceMetrics([], 2),
      currencies: [],
      breakdownsByCurrency: [],
    };
  }

  const [tradeRows, adjustmentRows, ruleResultRows] = await Promise.all([
    collectRows(async (from, to) => {
      let query = supabase
        .from("trades")
        .select("id,account_id,instrument_id,strategy_id,setup_id,status,opened_at,closed_at,outcome,direction,session,net_pnl,gross_pnl,commission,swap,other_fees,actual_r,planned_risk_percentage,planned_risk_reward,actual_lot_size,holding_duration_seconds")
        .in("account_id", selectedAccountIds);
      if (filters.instrument) query = query.eq("instrument_id", filters.instrument);
      if (filters.strategy) query = query.eq("strategy_id", filters.strategy);
      if (filters.setup) query = query.eq("setup_id", filters.setup);
      if (filters.session) query = query.eq("session", filters.session);
      if (filters.direction) query = query.eq("direction", filters.direction);
      return query
        .order("closed_at", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(from, to);
    }),
    collectRows(async (from, to) => supabase
      .from("account_adjustments")
      .select("id,account_id,type,amount,occurred_at,is_performance_neutral")
      .in("account_id", selectedAccountIds)
      .order("occurred_at")
      .order("id")
      .range(from, to)),
    collectRows(async (from, to) => supabase
      .from("trade_rule_results")
      .select("trade_id,trading_rule_id,complied")
      .order("trade_id")
      .order("trading_rule_id")
      .range(from, to)),
  ]);

  const accountById = new Map(selectedAccounts.map((item) => [item.id, item]));
  const instrumentById = new Map(instruments.map((item) => [item.id, item.symbol]));
  const strategyById = new Map(strategies.map((item) => [item.id, item.name]));
  const setupById = new Map(setups.map((item) => [item.id, item.name]));
  const resultsByTrade = new Map<string, Array<{ trading_rule_id: string; complied: boolean }>>();
  for (const result of ruleResultRows) {
    resultsByTrade.set(result.trade_id, [...(resultsByTrade.get(result.trade_id) ?? []), result]);
  }
  const rules = rulesResult.data ?? [];

  const allTrades = tradeRows.map((item): AnalyticsTrade | null => {
    const ownerAccount = accountById.get(item.account_id);
    if (!ownerAccount) return null;
    const applicableRules = rules.filter((rule) => rule.account_id === null || rule.account_id === item.account_id);
    const ruleResults = resultsByTrade.get(item.id) ?? [];
    const evaluatedRules = applicableRules.filter((rule) => ruleResults.some((result) => result.trading_rule_id === rule.id));
    const ruleViolations = ruleResults.filter((result) => !result.complied && applicableRules.some((rule) => rule.id === result.trading_rule_id)).length;
    const ruleCompliance = applicableRules.length === 0 || evaluatedRules.length < applicableRules.length
      ? "NOT_REVIEWED" as const
      : ruleViolations > 0 ? "VIOLATIONS_PRESENT" as const : "FULLY_COMPLIANT" as const;

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
      netPnl: optionalNumeric(item.net_pnl),
      grossPnl: optionalNumeric(item.gross_pnl),
      commission: normalizeSupabaseNumeric(item.commission),
      swap: normalizeSupabaseNumeric(item.swap),
      otherFees: normalizeSupabaseNumeric(item.other_fees),
      actualR: optionalNumeric(item.actual_r),
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
      ruleViolations,
    };
  }).filter((item): item is AnalyticsTrade => item !== null);

  const selectedTrades = allTrades.filter((trade) => inRealizedDateRange(trade, filters, timezone));
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
    const curve = windowCurve(fullCurve, filters, timezone, precision, metrics.netProfit);
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
    unitlessMetrics: calculatePerformanceMetrics(selectedTrades, 8),
    currencies,
    breakdownsByCurrency,
  };
}
