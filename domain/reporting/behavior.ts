import { calculateBehavioralAnalytics, type BehavioralAnalytics, type BehavioralTrade } from "@/domain/analytics/behavior";
import { dateKey } from "@/domain/journal/analytics";
import { normalizeSupabaseNumeric } from "@/lib/supabase/numeric";
import type { AnalyticsFilters } from "@/domain/reporting/performance";
import type { ReportingRows } from "@/domain/reporting/rows";
import {completedRuleCompliance,validActualR,matchesAnalyticsDimensions} from "@/domain/reporting/evidence";
function optionalNumeric(value: unknown): string | null {
  return value === null || value === undefined ? null : normalizeSupabaseNumeric(value);
}


export function buildBehaviorAnalytics(rows:ReportingRows,filters:AnalyticsFilters={},timezone=rows.timezone):BehavioralAnalytics {
  const accountsResult={data:rows.accounts},instrumentsResult={data:rows.instruments},strategiesResult={data:rows.strategies},setupsResult={data:rows.setups};
  const accounts = (accountsResult.data ?? []).filter((account) => {
    if (filters.account && account.id !== filters.account) return false;
    if (filters.accountType && account.account_type !== filters.accountType) return false;
    return true;
  });
  const accountIds = accounts.map((account) => account.id);
  if (!accountIds.length) return calculateBehavioralAnalytics([]);

  const tradeRows=rows.trades.filter(trade=>accountIds.includes(trade.account_id) && trade.status==="CLOSED"
    && matchesAnalyticsDimensions({instrumentId:trade.instrument_id,strategyId:trade.strategy_id,setupId:trade.setup_id,session:trade.session,direction:trade.direction},filters));
  const dateFiltered = tradeRows.filter((trade) => {
    if (!trade.closed_at) return false;
    const key = dateKey(trade.closed_at, timezone);
    if (filters.from && key < filters.from) return false;
    if (filters.to && key > filters.to) return false;
    return true;
  });
  const tradeIds = dateFiltered.map((trade) => trade.id);
  if (!tradeIds.length) return calculateBehavioralAnalytics([]);

  const executionRows=rows.execution,psychologyRows=rows.psychology,reviewRows=rows.reviews,ruleReviewRows=rows.ruleReviews,ruleItems=rows.ruleItems;

  const accountById = new Map(accounts.map((item) => [item.id, item]));
  const instrumentById = new Map((instrumentsResult.data ?? []).map((item) => [item.id, item.symbol]));
  const strategyById = new Map((strategiesResult.data ?? []).map((item) => [item.id, item.name]));
  const setupById = new Map((setupsResult.data ?? []).map((item) => [item.id, item.name]));
  const executionByTrade = new Map(executionRows.map((item) => [item.trade_id, item]));
  const psychologyByTrade = new Map(psychologyRows.map((item) => [item.trade_id, item]));
  const reviewByTrade = new Map(reviewRows.map((item) => [item.trade_id, item]));
  const ruleReviewByTrade = new Map(ruleReviewRows.map((item) => [item.trade_id, item]));
  const ruleItemsByReview = new Map<string, typeof ruleItems>();
  for (const item of ruleItems) ruleItemsByReview.set(item.review_id, [...(ruleItemsByReview.get(item.review_id) ?? []), item]);

  let behavioralTrades = dateFiltered.map((item): BehavioralTrade | null => {
    const account = accountById.get(item.account_id);
    if (!account) return null;
    const execution = executionByTrade.get(item.id);
    const psychology = psychologyByTrade.get(item.id);
    const review = reviewByTrade.get(item.id);
    const ruleReview = ruleReviewByTrade.get(item.id);
    const reviewItems = ruleReview ? ruleItemsByReview.get(ruleReview.id) ?? [] : [];
    const violations = reviewItems.filter((rule) => !rule.complied).length;
    return {
      id: item.id,
      accountId: item.account_id,
      accountName: account.name,
      accountType: account.account_type,
      currencyCode: account.currency_code,
      currencyPrecision: account.currency_precision,
      status: item.status,
      openedAt: item.opened_at,
      closedAt: item.closed_at,
      outcome: item.outcome,
      netPnl: optionalNumeric(item.net_pnl),
      grossPnl: optionalNumeric(item.gross_pnl),
      commission: normalizeSupabaseNumeric(item.commission),
      swap: normalizeSupabaseNumeric(item.swap),
      otherFees: normalizeSupabaseNumeric(item.other_fees),
      actualR: validActualR(item,account.currency_precision),
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
      ruleCompliance: completedRuleCompliance(ruleReview,reviewItems),
      ruleViolations: completedRuleCompliance(ruleReview,reviewItems)==="NOT_REVIEWED" ? 0 : violations,
      execution: execution ? {
        reviewedAt: execution.reviewed_at,
        entryAccordingToPlan: execution.entry_according_to_plan,
        stopAccordingToPlan: execution.stop_according_to_plan,
        targetAccordingToPlan: execution.target_according_to_plan,
        stopAction: execution.stop_action,
        closedEarly: execution.closed_early,
        enteredEarly: execution.entered_early,
        enteredLate: execution.entered_late,
        chasedPrice: execution.chased_price,
        addedToPosition: execution.added_to_position,
        revengeTrade: execution.revenge_trade,
        overRisked: execution.over_risked,
        executionRating: execution.execution_rating,
      } : null,
      psychology: psychology ? {
        reviewedAt: psychology.reviewed_at,
        confidenceBeforeEntry: psychology.confidence_before_entry,
        emotionBefore: psychology.emotion_before,
        emotionDuring: psychology.emotion_during,
        emotionAfter: psychology.emotion_after,
        fearInfluenced: psychology.fear_influenced,
        greedInfluenced: psychology.greed_influenced,
        fomoInfluenced: psychology.fomo_influenced,
      } : null,
      ruleReview: ruleReview && completedRuleCompliance(ruleReview,reviewItems)!=="NOT_REVIEWED" ? {
        reviewedAt: ruleReview.reviewed_at!,
        applicableRuleCount: ruleReview.applicable_rule_count,
        items: reviewItems.map((rule) => ({ ruleId: rule.rule_id_snapshot, ruleName: rule.rule_name, ruleDescription: rule.rule_description, complied: rule.complied })),
      } : null,
      grade: review?.reviewed_at ? review.trade_quality_grade : null,
      lessonLearned: review?.reviewed_at ? review.lesson_learned : null,
      reviewText: review?.reviewed_at ? [review.what_went_well, review.what_went_wrong, review.improvement, review.lesson_learned].filter(Boolean).join(" ") : null,
    };
  }).filter((item): item is BehavioralTrade => item !== null);

  const reviewSearch = filters.reviewSearch?.trim().toLocaleLowerCase();
  if (reviewSearch) {
    behavioralTrades = behavioralTrades.filter((trade) => trade.reviewText?.toLocaleLowerCase().includes(reviewSearch));
  }

  return calculateBehavioralAnalytics(behavioralTrades);
}
