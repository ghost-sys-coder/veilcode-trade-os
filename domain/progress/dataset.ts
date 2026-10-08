import {z} from "zod";
import Decimal from "decimal.js";
import {accountLedgerRecordsSchema,accountRecordSchema} from "@/domain/accounts/commands";
import {buildAccountLedger} from "@/domain/accounts/ledger";
import {buildAccountCurve} from "@/domain/analytics/performance";
import {dateKey} from "@/domain/journal/analytics";
import {normalizeMoney,parseDecimal} from "@/domain/money/decimal";
import {calculateConsistency,calculateProfitTarget,calculateStaticLossBuffer,goalProgressPercentage,summarizeTradingDays,type LossBuffer} from "@/domain/progress/metrics";
import {goalRecordSchema,goalEventRecordSchema,propRecordSchema} from "@/domain/progress/commands";
import {TRADE_STATUSES,ACCOUNT_STATUSES,ACCOUNT_FAILURE_REASONS} from "@/types/domain";
import type {Database} from "@/types/database";
const numeric=z.string().regex(/^-?\d+(?:\.\d+)?$/);
const stamp=z.iso.datetime({offset:true});
export const progressDataSchema=accountLedgerRecordsSchema.extend({
  timezone:z.string(),config:propRecordSchema.nullable(),goals:z.array(goalRecordSchema),goalEvents:z.array(goalEventRecordSchema),
  statusEvents:z.array(z.object({id:z.string().uuid(),user_id:z.string().uuid(),account_id:z.string().uuid(),previous_status:z.enum(ACCOUNT_STATUSES).nullable(),new_status:z.enum(ACCOUNT_STATUSES),effective_at:stamp,failure_reason:z.enum(ACCOUNT_FAILURE_REASONS).nullable(),notes:z.string().nullable(),actor_user_id:z.string().uuid().nullable(),created_at:stamp})),
  trades:z.array(z.object({id:z.string().uuid(),instrument_id:z.string().uuid(),status:z.enum(TRADE_STATUSES),opened_at:stamp.nullable(),closed_at:stamp.nullable(),net_pnl:numeric.nullable(),actual_r:numeric.nullable(),planned_risk_amount:numeric.nullable(),setup_id:z.string().uuid().nullable()}).passthrough()),
  reviews:z.array(z.object({trade_id:z.string().uuid(),reviewed_at:stamp})),ruleReviews:z.array(z.object({id:z.string().uuid(),trade_id:z.string().uuid(),applicable_rule_count:z.number().int().min(0),reviewed_at:stamp.nullable()}).passthrough()),
  ruleItems:z.array(z.object({review_id:z.string().uuid(),rule_id_snapshot:z.string().uuid(),complied:z.boolean()}).passthrough()),setups:z.array(z.object({id:z.string().uuid(),name:z.string()})),
});
const nullableDecimal=numeric.nullable();
const bufferSchema=z.object({available:z.boolean(),reason:z.string().nullable(),limit:nullableDecimal,used:nullableDecimal,remaining:nullableDecimal,basis:nullableDecimal,measure:nullableDecimal});
export const progressDatasetResultSchema=z.object({
  accounts:z.array(accountRecordSchema),account:accountRecordSchema.nullable(),config:propRecordSchema.nullable(),
  currentBalance:nullableDecimal,currentEquity:nullableDecimal,latestSnapshotAt:stamp.nullable(),netProfit:nullableDecimal,
  profitTarget:z.object({current:numeric,target:numeric,remaining:numeric,percentage:numeric}).nullable(),
  dailyLossBuffer:bufferSchema.nullable(),maximumLossBuffer:bufferSchema.nullable(),
  consistency:z.object({available:z.boolean(),percentage:nullableDecimal,bestDayProfit:numeric,totalPositiveProfit:numeric,reason:z.string().nullable()}).nullable(),
  tradingDays:z.object({tradingDays:z.number().int().nonnegative(),profitableDays:z.number().int().nonnegative(),losingDays:z.number().int().nonnegative(),breakEvenDays:z.number().int().nonnegative(),belowThresholdPositiveDays:z.number().int().nonnegative()}).nullable(),
  goals:z.array(goalRecordSchema.extend({currentValue:nullableDecimal,isMaximumLimit:z.boolean(),limitUtilizationPercentage:nullableDecimal,withinLimit:z.boolean().nullable(),percentage:nullableDecimal,unavailableReason:z.string().nullable()})),
  goalEvents:z.array(goalEventRecordSchema),statusEvents:progressDataSchema.shape.statusEvents,
  reviewedTrades:z.number().int().nonnegative(),closedTrades:z.number().int().nonnegative(),incompleteClosedTrades:z.number().int().nonnegative(),
  cumulativeR:numeric,rSample:z.number().int().nonnegative(),ruleCompliancePercentage:nullableDecimal,
  maximumDrawdown:nullableDecimal,maximumDrawdownPercentage:nullableDecimal,maximumDrawdownUnavailableReason:z.string().nullable(),
  setupSamples:z.array(z.object({name:z.string(),trades:z.number().int().nonnegative()})),
}).strict();
type AccountRow=z.infer<typeof accountRecordSchema>;
type ConfigRow=z.infer<typeof propRecordSchema>;
type GoalRow=z.infer<typeof goalRecordSchema>;
export interface ProgressGoal extends GoalRow {
  currentValue: string | null;
  isMaximumLimit:boolean;
  limitUtilizationPercentage:string|null;
  withinLimit:boolean|null;
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
  incompleteClosedTrades: number;
  cumulativeR: string;
  ruleCompliancePercentage: string | null;
  maximumDrawdown: string | null;
  maximumDrawdownPercentage:string|null;
  rSample:number;
  maximumDrawdownUnavailableReason: string | null;
  setupSamples: Array<{ name: string; trades: number }>;
}


function maxDecimal(values:readonly string[]) {return values.length?values.reduce((maximum,value)=>Decimal.max(maximum,parseDecimal(value)),parseDecimal(values[0])).toString():null;}
const normalizeSupabaseNumeric=(value:string)=>parseDecimal(value).toFixed();
const normalizeProgressConfigRow=(value:ConfigRow|null)=>value;
export function emptyProgressDataset(accounts:AccountRow[]=[]):PropProgressDataset {
 return {accounts,account:null,config:null,currentBalance:null,currentEquity:null,latestSnapshotAt:null,netProfit:null,profitTarget:null,dailyLossBuffer:null,maximumLossBuffer:null,consistency:null,tradingDays:null,goals:[],goalEvents:[],statusEvents:[],reviewedTrades:0,closedTrades:0,incompleteClosedTrades:0,cumulativeR:"0",rSample:0,ruleCompliancePercentage:null,maximumDrawdown:null,maximumDrawdownPercentage:null,maximumDrawdownUnavailableReason:null,setupSamples:[]};
}
export function buildProgressDataset(input:unknown,now=new Date().toISOString()):PropProgressDataset {
  const records=progressDataSchema.parse(input);
  const account=records.account,accounts=[account],ledger=buildAccountLedger(records);
  const profileResult={data:{timezone:records.timezone}},configResult={data:records.config},tradesResult={data:records.trades};
  const goalRows=records.goals,eventsResult={data:records.goalEvents},statusEventsResult={data:records.statusEvents};
  const reviewsResult={data:records.reviews},ruleReviewsResult={data:records.ruleReviews},ruleItemsResult={data:records.ruleItems},setupsResult={data:records.setups};
  const precision = account.currency_precision;
  const trades = (tradesResult.data ?? []).map((trade) => ({
    id: trade.id,
    status: trade.status,
    openedAt: trade.opened_at,
    closedAt: trade.closed_at,
    netPnl: trade.net_pnl === null ? null : normalizeMoney(trade.net_pnl,precision),
    actualR: trade.actual_r===null || trade.planned_risk_amount===null || parseDecimal(trade.planned_risk_amount).lte(0) ? null : normalizeSupabaseNumeric(trade.actual_r),
  }));
  const closed = trades.filter((trade) => trade.status === "CLOSED" && trade.closedAt && trade.netPnl !== null);
  const netProfit = normalizeMoney(closed.reduce((sum, trade) => sum.plus(trade.netPnl ?? "0"), new Decimal(0)), precision);
  const cumulativeR = closed.reduce((sum, trade) => sum.plus(trade.actualR ?? "0"), new Decimal(0)).toFixed(8);
  const latestSnapshot = ledger.snapshots[0] ?? null;
  const currentEquity = latestSnapshot?.equity ?? null;
  const config = normalizeProgressConfigRow(configResult.data);
  const timezone = config?.trading_day_timezone ?? profileResult.data?.timezone ?? "UTC";
  const today = dateKey(now, timezone);
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
  // A prop firm's loss-rule treatment of cash movements is not encoded by the
  // current configuration. Do not present raw withdrawals as an authoritative
  // firm breach or silently infer firm policy from account analytics neutrality.
  const cashFlowRuleUnavailable=ledger.adjustments.length
    ? "Loss buffer unavailable: this firm's cash-flow handling is not configured. Account analytics drawdown is calculated separately."
    : null;
  if (config) {
    if (config.profit_target_mode && config.profit_target_value !== null) {
      profitTarget = calculateProfitTarget({ startingBalance: account.starting_balance, currentBalance: ledger.derivedBalance, tradingNetProfit:netProfit, mode: config.profit_target_mode, value: config.profit_target_value, currencyPrecision: precision });
    }
    if (config.daily_loss_mode && config.daily_loss_value !== null && config.daily_loss_baseline && config.daily_loss_measure) {
      const baseline = config.daily_loss_baseline === "STARTING_BALANCE" ? account.starting_balance
        : config.daily_loss_baseline === "START_OF_DAY_BALANCE" ? startOfToday : startOfDayEquity;
      const measure = config.daily_loss_measure === "BALANCE" ? ledger.derivedBalance : currentDayEquity;
      dailyLossBuffer = calculateStaticLossBuffer({ mode: config.daily_loss_mode, value: config.daily_loss_value, percentageBasis: baseline, measurementBasis: baseline, currentMeasure: measure, currencyPrecision: precision,unsupportedReason:cashFlowRuleUnavailable });
    }
    if (config.total_loss_mode && config.total_loss_value !== null && config.total_loss_baseline && config.total_loss_measure) {
      const baseline = config.total_loss_baseline === "STARTING_BALANCE" ? account.starting_balance
        : config.total_loss_baseline === "HIGHEST_BALANCE" ? highestBalance : highestEquity;
      const measure = config.total_loss_measure === "BALANCE" ? ledger.derivedBalance : currentEquity;
      maximumLossBuffer = calculateStaticLossBuffer({
        mode: config.total_loss_mode,
        value: config.total_loss_value,
        percentageBasis: baseline,
        measurementBasis: baseline,
        currentMeasure: measure,
        currencyPrecision: precision,
        unsupportedReason: config.drawdown_type === "STATIC" ? cashFlowRuleUnavailable : `${config.drawdown_type.replaceAll("_", " ")} drawdown is recorded, but its exact mechanics are not implemented.`,
      });
    }
    consistency = config.consistency_formula === "BEST_DAY_OVER_TOTAL_POSITIVE_PROFIT"
      ? calculateConsistency(trades, timezone)
      : config.consistency_formula === "OTHER"
        ? { available: false, percentage: null, bestDayProfit: "0", totalPositiveProfit: "0", reason: "This custom consistency formula is documented but not calculated automatically." }
        : null;
    tradingDays = summarizeTradingDays(trades, timezone, config.profitable_day_min_pnl);
  }

  const reviewTradeIds = new Set((reviewsResult.data ?? []).map((item) => item.trade_id));
  const accountTradeIds = new Set(closed.map((trade) => trade.id));
  const ruleItemsByReview = new Map<string, Array<{ complied: boolean;rule_id_snapshot:string }>>();
  for (const item of ruleItemsResult.data ?? []) ruleItemsByReview.set(item.review_id, [...(ruleItemsByReview.get(item.review_id) ?? []), item]);
  const accountRuleReviews = (ruleReviewsResult.data ?? []).filter((review) => accountTradeIds.has(review.trade_id));
  const completeRuleReviews = accountRuleReviews.filter((review) => review.reviewed_at!==null && (ruleItemsByReview.get(review.id)?.length ?? 0) === review.applicable_rule_count
    && new Set((ruleItemsByReview.get(review.id)??[]).map(item=>item.rule_id_snapshot)).size===review.applicable_rule_count);
  const compliant = completeRuleReviews.filter((review) => (ruleItemsByReview.get(review.id) ?? []).every((item) => item.complied)).length;
  const ruleCompliancePercentage = completeRuleReviews.length ? new Decimal(compliant).div(completeRuleReviews.length).times(100).toFixed(2) : null;
  const incomplete=records.trades.filter(trade=>trade.status==="CLOSED" && (!trade.closed_at || trade.net_pnl===null)).length;
  const instrumentNames=new Map(records.instruments.map(item=>[item.id,item.symbol]));
  const instrumentsByTrade=new Map(records.trades.map(trade=>[trade.id,trade.instrument_id]));
  const curve=buildAccountCurve({account:{id:account.id,name:account.name,accountType:account.account_type,currencyCode:account.currency_code,currencyPrecision:precision,startingBalance:account.starting_balance,startedAt:account.started_at},
    trades:trades.map(trade=>({...trade,actualR:trade.actualR??null, instrument:instrumentNames.get(instrumentsByTrade.get(trade.id)!)??"Trade"})),
    adjustments:ledger.adjustments.map(item=>({id:item.id,accountId:account.id,occurredAt:item.occurred_at,amount:item.amount,type:item.type,isPerformanceNeutral:item.is_performance_neutral}))});
  const drawdown={value:incomplete===0 && curve.available?curve.maximumAmount:null,percentage:incomplete===0 && curve.available?curve.maximumPercentage:null,
    reason:incomplete? `Drawdown unavailable: ${incomplete} closed trade(s) require final PnL or closure dates.`:curve.available?null:`Drawdown unavailable: ${curve.unclassifiedAdjustmentCount} account adjustment(s) require performance classification.`};
  const setupNames = new Map((setupsResult.data ?? []).map((item) => [item.id, item.name]));
  const setupCounts = new Map<string, number>();
  for (const trade of tradesResult.data ?? []) if (trade.setup_id && trade.opened_at && (trade.status==="OPEN"||trade.status==="CLOSED")) setupCounts.set(trade.setup_id, (setupCounts.get(trade.setup_id) ?? 0) + 1);
  const goalIds=new Set(goalRows.map(goal=>goal.id));
  const goalEvents = (eventsResult.data ?? [])
    .filter((event) => goalIds.has(event.goal_id))
    .map(event=>({...event,progress_value:normalizeSupabaseNumeric(event.progress_value)}));
  const latestGoalValue = new Map<string, string>();
  for (const event of goalEvents) if (!latestGoalValue.has(event.goal_id)) latestGoalValue.set(event.goal_id, event.progress_value);
  const accountReturn = parseDecimal(account.starting_balance).isZero() ? null : parseDecimal(netProfit).div(account.starting_balance).times(100).toFixed(4);
  const goalValue = (goal: GoalRow): { value: string | null; reason: string | null } => {
    switch (goal.goal_type) {
      case "TOTAL_TRADES": return { value: String(closed.length), reason: null };
      case "ACCOUNT_RETURN_PERCENT": return { value: accountReturn, reason: accountReturn === null ? "Starting balance is zero." : null };
      case "ACCOUNT_BALANCE": return { value: ledger.derivedBalance, reason: null };
      case "CUMULATIVE_R": return {value:closed.some(trade=>trade.actualR!==null)?cumulativeR:null,reason:closed.some(trade=>trade.actualR!==null)?null:"No closed trades with calculable R are available."};
      case "RULE_COMPLIANCE_PERCENT": return { value: ruleCompliancePercentage, reason: ruleCompliancePercentage === null ? "No complete rule reviews are available." : null };
      case "MAX_DRAWDOWN_AMOUNT": return { value: drawdown.value, reason: drawdown.reason };
      case "MAX_DRAWDOWN_PERCENT": return {value:drawdown.percentage,reason:drawdown.reason};
      case "PROFITABLE_DAYS": return { value: tradingDays ? String(tradingDays.profitableDays) : null, reason: tradingDays ? null : "Configure prop trading-day rules first." };
      case "CUSTOM": return {value:latestGoalValue.get(goal.id)??null,reason:latestGoalValue.has(goal.id)?null:"No custom progress event has been recorded."};
      default: return { value: null, reason: "Unsupported goal type." };
    }
  };
  const goals: ProgressGoal[] = goalRows.map((goal) => {
    const resolved = goalValue(goal);
    return { ...goal, isMaximumLimit:goal.goal_type.startsWith("MAX_DRAWDOWN"),withinLimit:goal.goal_type.startsWith("MAX_DRAWDOWN")&&resolved.value!==null?parseDecimal(resolved.value).lte(goal.target_value):null,limitUtilizationPercentage:goal.goal_type.startsWith("MAX_DRAWDOWN")&&resolved.value!==null?parseDecimal(resolved.value).div(goal.target_value).times(100).toFixed(2):null,currentValue: resolved.value, percentage: resolved.value === null ? null : goalProgressPercentage(resolved.value, goal.target_value), unavailableReason: resolved.reason };
  });

  return {
    accounts, account, config, currentBalance: ledger.derivedBalance, currentEquity,
    latestSnapshotAt: latestSnapshot?.captured_at ?? null, netProfit, profitTarget, dailyLossBuffer,
    maximumLossBuffer, consistency, tradingDays, goals, goalEvents, statusEvents: statusEventsResult.data ?? [],
    reviewedTrades: closed.filter((trade) => reviewTradeIds.has(trade.id)).length,
    closedTrades: closed.length,incompleteClosedTrades:incomplete, cumulativeR,rSample:closed.filter(trade=>trade.actualR!==null).length, ruleCompliancePercentage,
    maximumDrawdown: drawdown.value,maximumDrawdownPercentage:drawdown.percentage,maximumDrawdownUnavailableReason: drawdown.reason,
    setupSamples: [...setupCounts.entries()].map(([id, count]) => ({ name: setupNames.get(id) ?? "Unknown setup", trades: count })).toSorted((left, right) => right.trades - left.trades || left.name.localeCompare(right.name)),
  };
}
