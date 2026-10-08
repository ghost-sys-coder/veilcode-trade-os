import {calculatePerformanceMetrics,type AnalyticsTrade,type PerformanceMetrics,type RuleComplianceState} from "@/domain/analytics/performance";
import { parseDecimal,normalizeMoney } from "@/domain/money/decimal";
import type { AnalyticsFilters } from "@/domain/reporting/performance";

export function completedRuleCompliance(review:{reviewed_at:string|null;applicable_rule_count:number}|null|undefined,
  items:readonly {rule_id_snapshot:string;complied:boolean}[]):RuleComplianceState {
  if(!review?.reviewed_at || items.length!==review.applicable_rule_count || new Set(items.map(item=>item.rule_id_snapshot)).size!==review.applicable_rule_count)
    return "NOT_REVIEWED";
  return items.some(item=>item.complied===false)?"VIOLATIONS_PRESENT":"FULLY_COMPLIANT";
}
export function validActualR(trade:{actual_r:string|null;planned_risk_amount:string|null},precision:number):string|null {
  return trade.actual_r!==null && trade.planned_risk_amount!==null && parseDecimal(normalizeMoney(trade.planned_risk_amount,precision)).gt(0) ? parseDecimal(trade.actual_r).toFixed() : null;
}
export function matchesAnalyticsDimensions(trade:Pick<AnalyticsTrade,"instrumentId"|"strategyId"|"setupId"|"session"|"direction">,filters:AnalyticsFilters) {
  return (!filters.instrument || trade.instrumentId===filters.instrument) && (!filters.strategy || trade.strategyId===filters.strategy)
    && (!filters.setup || trade.setupId===filters.setup) && (!filters.session || trade.session===filters.session) && (!filters.direction || trade.direction===filters.direction);
}
/** Never compute or expose a mixed-currency monetary total or profit factor. */
export function unitlessPerformance(value:PerformanceMetrics) {
  return {totalTrades:value.totalTrades,closedTrades:value.closedTrades,wins:value.wins,losses:value.losses,breakEvens:value.breakEvens,
    winRate:value.winRate,winRateSample:value.winRateSample,breakEvenRate:value.breakEvenRate,rExpectancy:value.rExpectancy,rSample:value.rSample,
    averageR:value.averageR,averageWinningR:value.averageWinningR,averageLosingR:value.averageLosingR,rDistributionCrossCheck:value.rDistributionCrossCheck,
    streaks:value.streaks,averageHoldingDurationSeconds:value.averageHoldingDurationSeconds,averagePlannedRiskPercentage:value.averagePlannedRiskPercentage,
    totalRuleViolations:value.totalRuleViolations,ruleComplianceRate:value.ruleComplianceRate,ruleComplianceSample:value.ruleComplianceSample};
}
export function calculateUnitlessPerformance(trades:readonly AnalyticsTrade[]) {
  // Monetary fields are deliberately removed BEFORE aggregation, not only
  // hidden afterward. Mixed-currency profit factors are not meaningful either.
  return unitlessPerformance(calculatePerformanceMetrics(trades.map(t=>({...t,netPnl:t.netPnl===null?null:"0",grossPnl:null,commission:"0",swap:"0",otherFees:"0"})),8));
}
