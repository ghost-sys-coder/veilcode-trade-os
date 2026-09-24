import type { SupabaseClient } from "@supabase/supabase-js";
import Decimal from "decimal.js";

import { dateKey } from "@/domain/journal/analytics";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import {
  calculateConsistency,
  calculateProfitTarget,
  calculateStaticLossBuffer,
  goalProgressPercentage,
  summarizeTradingDays,
  type LossBuffer,
  type PropTradeMetric,
} from "@/domain/progress/metrics";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import { getAccountLedger } from "@/services/accounts/get-account-ledger";
import type { Database } from "@/types/database";

type AccountRow = Database["public"]["Tables"]["trading_accounts"]["Row"];
type ConfigRow = Database["public"]["Tables"]["prop_firm_configs"]["Row"];
type GoalRow = Database["public"]["Tables"]["account_goals"]["Row"];

export interface ProgressGoal extends GoalRow {
  currentValue: string | null;
  percentage: string | null;
  unavailableReason: string | null;
}

export interface PropProgressDataset {
  accounts: AccountRow[];
  account: AccountRow | null;
  config: ConfigRow | null;
  currentBalance: string | null;
  currentEquity: string | null;
  latestSnapshotAt: string | null;
  netProfit: string | null;
  profitTarget: ReturnType<typeof calculateProfitTarget> | null;
  dailyLossBuffer: LossBuffer | null;
  maximumLossBuffer: LossBuffer | null;
  consistency: ReturnType<typeof calculateConsistency> | null;
  tradingDays: ReturnType<typeof summarizeTradingDays> | null;
  goals: ProgressGoal[];
  goalEvents: Database["public"]["Tables"]["account_goal_progress_events"]["Row"][];
  statusEvents: Database["public"]["Tables"]["account_status_events"]["Row"][];
  reviewedTrades: number;
  closedTrades: number;
  cumulativeR: string;
  ruleCompliancePercentage: string | null;
  maximumDrawdown: string | null;
  maximumDrawdownUnavailableReason: string | null;
  setupSamples: Array<{ name: string; trades: number }>;
}

function maxDecimal(values: readonly string[]): string | null {
  if (!values.length) return null;
  return Decimal.max(...values.map(parseDecimal)).toString();
}

function cashFlowNeutralMaximumDrawdown(input: {
  startingBalance: string;
  precision: number;
  trades: Array<{ id: string; occurredAt: string; amount: string }>;
  adjustments: Array<{ id: string; occurredAt: string; amount: string; neutral: boolean | null }>;
}): { value: string | null; reason: string | null } {
  const unclassified = input.adjustments.filter((item) => item.neutral === null).length;
  if (unclassified) {
    return { value: null, reason: `Drawdown unavailable: ${unclassified} account adjustment${unclassified === 1 ? "" : "s"} require performance classification.` };
  }
  const events = [
    ...input.trades.map((item) => ({ ...item, neutral: false, kind: "TRADE" as const })),
    ...input.adjustments.map((item) => ({ ...item, neutral: item.neutral ?? false, kind: "ADJUSTMENT" as const })),
  ].toSorted((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));
  let balance = parseDecimal(input.startingBalance);
  let high = balance;
  let maximum = new Decimal(0);
  for (const event of events) {
    balance = balance.plus(event.amount);
    if (event.kind === "ADJUSTMENT" && event.neutral) high = high.plus(event.amount);
    else high = Decimal.max(high, balance);
    maximum = Decimal.max(maximum, high.minus(balance));
  }
  return { value: normalizeMoney(maximum, input.precision), reason: null };
}

export async function getProgressDataset(
  supabase: SupabaseClient<Database>,
  requestedAccountId?: string,
  includeAllAccounts = false,
): Promise<PropProgressDataset> {
  let accountsQuery = supabase.from("trading_accounts").select("*").order("name");
  if (!includeAllAccounts) accountsQuery = accountsQuery.in("account_type", ["PROP_CHALLENGE", "FUNDED"]);
  const [accountsResult, profileResult] = await Promise.all([
    accountsQuery,
    supabase.from("profiles").select("timezone").maybeSingle(),
  ]);
  const referenceError = accountsResult.error ?? profileResult.error;
  if (referenceError) throw new Error(referenceError.message);
  const accounts = accountsResult.data ?? [];
  const account = accounts.find((item) => item.id === requestedAccountId) ?? accounts[0] ?? null;
  const empty: PropProgressDataset = {
    accounts, account: null, config: null, currentBalance: null, currentEquity: null, latestSnapshotAt: null,
    netProfit: null, profitTarget: null, dailyLossBuffer: null, maximumLossBuffer: null, consistency: null,
    tradingDays: null, goals: [], goalEvents: [], statusEvents: [], reviewedTrades: 0, closedTrades: 0,
    cumulativeR: "0", ruleCompliancePercentage: null, maximumDrawdown: null,
    maximumDrawdownUnavailableReason: null, setupSamples: [],
  };
  if (!account) return empty;

  const ledger = await getAccountLedger(supabase, account.id);
  const [configResult, tradesResult, goalsResult] = await Promise.all([
    supabase.from("prop_firm_configs").select("*").eq("account_id", account.id).maybeSingle(),
    supabase.from("trades").select("id,status,opened_at,closed_at,net_pnl,actual_r,setup_id").eq("account_id", account.id),
    supabase.from("account_goals").select("*").eq("account_id", account.id).order("created_at", { ascending: false }),
  ]);
  const goalIds = (goalsResult.data ?? []).map((goal) => goal.id);
  const tradeIds = (tradesResult.data ?? []).map((trade) => trade.id);
  const [eventsResult, statusEventsResult, reviewsResult, ruleReviewsResult] = await Promise.all([
    goalIds.length
      ? supabase.from("account_goal_progress_events").select("*").in("goal_id", goalIds).order("recorded_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from("account_status_events").select("*").eq("account_id", account.id).order("effective_at", { ascending: false }),
    tradeIds.length
      ? supabase.from("trade_reviews").select("trade_id,reviewed_at").in("trade_id", tradeIds).not("reviewed_at", "is", null)
      : Promise.resolve({ data: [], error: null }),
    tradeIds.length
      ? supabase.from("trade_rule_reviews").select("id,trade_id,applicable_rule_count,reviewed_at").in("trade_id", tradeIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const reviewIds = (ruleReviewsResult.data ?? []).map((review) => review.id);
  const [ruleItemsResult, setupsResult] = await Promise.all([
    reviewIds.length
      ? supabase.from("trade_rule_review_items").select("review_id,complied").in("review_id", reviewIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("setups").select("id,name"),
  ]);
  const error = configResult.error ?? tradesResult.error ?? goalsResult.error ?? eventsResult.error
    ?? statusEventsResult.error ?? reviewsResult.error ?? ruleReviewsResult.error ?? ruleItemsResult.error ?? setupsResult.error;
  if (error) throw new Error(error.message);
  if (!ledger) return empty;

  const precision = account.currency_precision;
  const trades: PropTradeMetric[] = (tradesResult.data ?? []).map((trade) => ({
    id: trade.id,
    status: trade.status,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,
    netPnl: trade.net_pnl === null ? null : normalizeSupabaseNumeric(trade.net_pnl),
    actualR: trade.actual_r === null ? null : normalizeSupabaseNumeric(trade.actual_r),
  }));
  const closed = trades.filter((trade) => trade.status === "CLOSED" && trade.closedAt && trade.netPnl !== null);
  const netProfit = normalizeMoney(closed.reduce((sum, trade) => sum.plus(trade.netPnl ?? "0"), new Decimal(0)), precision);
  const cumulativeR = closed.reduce((sum, trade) => sum.plus(trade.actualR ?? "0"), new Decimal(0)).toFixed(4);
  const latestSnapshot = ledger.snapshots[0] ?? null;
  const currentEquity = latestSnapshot?.equity ?? null;
  const config = configResult.data;
  const timezone = config?.trading_day_timezone ?? profileResult.data?.timezone ?? "UTC";
  const today = dateKey(new Date().toISOString(), timezone);
  const startOfToday = ledger.timeline.filter((event) => dateKey(event.occurredAt, timezone) < today).at(-1)?.balance ?? account.starting_balance;
  const todaySnapshots = ledger.snapshots.filter((snapshot) => dateKey(snapshot.captured_at, timezone) === today).toReversed();
  const startOfDayEquity = todaySnapshots.find((snapshot) => snapshot.equity !== null)?.equity ?? null;
  const currentDayEquity = todaySnapshots.toReversed().find((snapshot) => snapshot.equity !== null)?.equity ?? null;
  const highestBalance = maxDecimal(ledger.timeline.map((event) => event.balance));
  const highestEquity = maxDecimal(ledger.snapshots.flatMap((snapshot) => snapshot.equity === null ? [] : [snapshot.equity]));

  let profitTarget = null;
  let dailyLossBuffer = null;
  let maximumLossBuffer = null;
  let consistency = null;
  let tradingDays = null;
  if (config) {
    if (config.profit_target_mode && config.profit_target_value !== null) {
      profitTarget = calculateProfitTarget({ startingBalance: account.starting_balance, currentBalance: ledger.derivedBalance, mode: config.profit_target_mode, value: normalizeSupabaseNumeric(config.profit_target_value), currencyPrecision: precision });
    }
    if (config.daily_loss_mode && config.daily_loss_value !== null && config.daily_loss_baseline && config.daily_loss_measure) {
      const baseline = config.daily_loss_baseline === "STARTING_BALANCE" ? account.starting_balance
        : config.daily_loss_baseline === "START_OF_DAY_BALANCE" ? startOfToday : startOfDayEquity;
      const measure = config.daily_loss_measure === "BALANCE" ? ledger.derivedBalance : currentDayEquity;
      dailyLossBuffer = calculateStaticLossBuffer({ mode: config.daily_loss_mode, value: normalizeSupabaseNumeric(config.daily_loss_value), percentageBasis: baseline, measurementBasis: baseline, currentMeasure: measure, currencyPrecision: precision });
    }
    if (config.total_loss_mode && config.total_loss_value !== null && config.total_loss_baseline && config.total_loss_measure) {
      const baseline = config.total_loss_baseline === "STARTING_BALANCE" ? account.starting_balance
        : config.total_loss_baseline === "HIGHEST_BALANCE" ? highestBalance : highestEquity;
      const measure = config.total_loss_measure === "BALANCE" ? ledger.derivedBalance : currentEquity;
      maximumLossBuffer = calculateStaticLossBuffer({
        mode: config.total_loss_mode,
        value: normalizeSupabaseNumeric(config.total_loss_value),
        percentageBasis: baseline,
        measurementBasis: baseline,
        currentMeasure: measure,
        currencyPrecision: precision,
        unsupportedReason: config.drawdown_type === "STATIC" ? null : `${config.drawdown_type.replaceAll("_", " ")} drawdown is recorded, but its exact mechanics are not implemented.`,
      });
    }
    consistency = config.consistency_formula === "BEST_DAY_OVER_TOTAL_POSITIVE_PROFIT"
      ? calculateConsistency(trades, timezone)
      : config.consistency_formula === "OTHER"
        ? { available: false, percentage: null, bestDayProfit: "0", totalPositiveProfit: "0", reason: "This custom consistency formula is documented but not calculated automatically." }
        : null;
    tradingDays = summarizeTradingDays(trades, timezone, normalizeSupabaseNumeric(config.profitable_day_min_pnl));
  }

  const reviewTradeIds = new Set((reviewsResult.data ?? []).map((item) => item.trade_id));
  const accountTradeIds = new Set(trades.map((trade) => trade.id));
  const ruleItemsByReview = new Map<string, Array<{ complied: boolean }>>();
  for (const item of ruleItemsResult.data ?? []) ruleItemsByReview.set(item.review_id, [...(ruleItemsByReview.get(item.review_id) ?? []), item]);
  const accountRuleReviews = (ruleReviewsResult.data ?? []).filter((review) => accountTradeIds.has(review.trade_id));
  const completeRuleReviews = accountRuleReviews.filter((review) => (ruleItemsByReview.get(review.id)?.length ?? 0) === review.applicable_rule_count);
  const compliant = completeRuleReviews.filter((review) => (ruleItemsByReview.get(review.id) ?? []).every((item) => item.complied)).length;
  const ruleCompliancePercentage = completeRuleReviews.length ? new Decimal(compliant).div(completeRuleReviews.length).times(100).toFixed(2) : null;
  const drawdown = cashFlowNeutralMaximumDrawdown({
    startingBalance: account.starting_balance,
    precision,
    trades: closed.map((trade) => ({ id: trade.id, occurredAt: trade.closedAt!, amount: trade.netPnl! })),
    adjustments: ledger.adjustments.map((item) => ({ id: item.id, occurredAt: item.occurred_at, amount: item.amount, neutral: item.is_performance_neutral })),
  });
  const setupNames = new Map((setupsResult.data ?? []).map((item) => [item.id, item.name]));
  const setupCounts = new Map<string, number>();
  for (const trade of tradesResult.data ?? []) if (trade.setup_id) setupCounts.set(trade.setup_id, (setupCounts.get(trade.setup_id) ?? 0) + 1);
  const goalEvents = (eventsResult.data ?? []).filter((event) => (goalsResult.data ?? []).some((goal) => goal.id === event.goal_id));
  const latestGoalValue = new Map<string, string>();
  for (const event of goalEvents) if (!latestGoalValue.has(event.goal_id)) latestGoalValue.set(event.goal_id, normalizeSupabaseNumeric(event.progress_value));
  const accountReturn = parseDecimal(account.starting_balance).isZero() ? null : parseDecimal(ledger.derivedBalance).minus(account.starting_balance).div(account.starting_balance).times(100).toFixed(4);
  const goalValue = (goal: GoalRow): { value: string | null; reason: string | null } => {
    switch (goal.goal_type) {
      case "TOTAL_TRADES": return { value: String(closed.length), reason: null };
      case "ACCOUNT_RETURN_PERCENT": return { value: accountReturn, reason: accountReturn === null ? "Starting balance is zero." : null };
      case "ACCOUNT_BALANCE": return { value: ledger.derivedBalance, reason: null };
      case "CUMULATIVE_R": return { value: cumulativeR, reason: null };
      case "RULE_COMPLIANCE_PERCENT": return { value: ruleCompliancePercentage, reason: ruleCompliancePercentage === null ? "No complete rule reviews are available." : null };
      case "MAX_DRAWDOWN_AMOUNT": return { value: drawdown.value, reason: drawdown.reason };
      case "MAX_DRAWDOWN_PERCENT": return { value: drawdown.value && !parseDecimal(account.starting_balance).isZero() ? parseDecimal(drawdown.value).div(account.starting_balance).times(100).toFixed(4) : null, reason: drawdown.reason ?? "Starting balance is zero." };
      case "PROFITABLE_DAYS": return { value: tradingDays ? String(tradingDays.profitableDays) : null, reason: tradingDays ? null : "Configure prop trading-day rules first." };
      case "CUSTOM": return { value: latestGoalValue.get(goal.id) ?? "0", reason: null };
      default: return { value: null, reason: "Unsupported goal type." };
    }
  };
  const goals: ProgressGoal[] = (goalsResult.data ?? []).map((goal) => {
    const resolved = goalValue(goal);
    return { ...goal, currentValue: resolved.value, percentage: resolved.value === null ? null : goalProgressPercentage(resolved.value, normalizeSupabaseNumeric(goal.target_value)), unavailableReason: resolved.reason };
  });

  return {
    accounts, account, config, currentBalance: ledger.derivedBalance, currentEquity,
    latestSnapshotAt: latestSnapshot?.captured_at ?? null, netProfit, profitTarget, dailyLossBuffer,
    maximumLossBuffer, consistency, tradingDays, goals, goalEvents, statusEvents: statusEventsResult.data ?? [],
    reviewedTrades: trades.filter((trade) => reviewTradeIds.has(trade.id)).length,
    closedTrades: closed.length, cumulativeR, ruleCompliancePercentage,
    maximumDrawdown: drawdown.value, maximumDrawdownUnavailableReason: drawdown.reason,
    setupSamples: [...setupCounts.entries()].map(([id, count]) => ({ name: setupNames.get(id) ?? "Unknown setup", trades: count })).toSorted((left, right) => right.trades - left.trades || left.name.localeCompare(right.name)),
  };
}
