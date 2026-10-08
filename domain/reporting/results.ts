import { z } from "zod";
import { decimalString,timezoneSchema } from "@/domain/reporting/rows";
import { analyticsFiltersSchema } from "@/domain/reporting/commands";
import type {AnalyticsDataset} from "@/domain/reporting/performance";
const count=z.number().int().nonnegative(),nullable=decimalString.nullable();
const streaks=z.object({currentWinning:count,currentLosing:count,maximumWinning:count,maximumLosing:count}).strict();
export const unitlessMetricsSchema=z.object({totalTrades:count,closedTrades:count,wins:count,losses:count,breakEvens:count,winRate:nullable,winRateSample:count,breakEvenRate:nullable,
  rExpectancy:nullable,rSample:count,averageR:nullable,averageWinningR:nullable,averageLosingR:nullable,rDistributionCrossCheck:nullable,streaks,
  averageHoldingDurationSeconds:z.number().nonnegative().nullable(),averagePlannedRiskPercentage:nullable,totalRuleViolations:count,ruleComplianceRate:nullable,ruleComplianceSample:count}).strict();
const factor=z.discriminatedUnion("state",[z.object({state:z.literal("FINITE"),value:decimalString}),z.object({state:z.literal("NO_LOSING_TRADES"),value:z.null()}),z.object({state:z.literal("UNDEFINED"),value:z.null()})]);
export const performanceMetricsSchema=unitlessMetricsSchema.extend({grossProfit:decimalString,grossLoss:decimalString,netProfit:decimalString,commission:decimalString,swap:decimalString,otherFees:decimalString,totalFees:decimalString,
  averageWinner:nullable,averageLoser:nullable,largestWinner:nullable,largestLoser:nullable,profitFactor:factor,currencyExpectancy:nullable});
const drawdown=z.object({available:z.boolean(),unclassifiedAdjustmentCount:count,currentAmount:nullable,currentPercentage:nullable,maximumAmount:nullable,maximumPercentage:nullable,recoveryFactor:nullable}).strict();
const group=z.object({key:z.string(),label:z.string(),metrics:performanceMetricsSchema}).strict();
const breakdowns=z.object({instruments:z.array(group),strategies:z.array(group),setups:z.array(group),sessions:z.array(group),directions:z.array(group),weekdays:z.array(group),months:z.array(group),entryHours:z.array(group),riskBuckets:z.array(group),plannedRiskRewardBuckets:z.array(group),actualRBuckets:z.array(group),holdingDurations:z.array(group)}).strict();
export const performanceResultSchema=z.object({timezone:timezoneSchema,filters:analyticsFiltersSchema,selectedAccountCount:count,selectedCurrencyCount:count,unitlessMetrics:unitlessMetricsSchema,
  currencies:z.array(z.object({currencyCode:z.string(),currencyPrecision:count,accountCount:count,metrics:performanceMetricsSchema,currentBalance:nullable,openingBalance:nullable,returnPercentage:nullable,curve:drawdown,incompleteClosedTrades:count,balanceComplete:z.boolean(),unavailableReason:z.string().nullable()}).strict()),
  breakdownsByCurrency:z.array(z.object({currencyCode:z.string(),currencyPrecision:count,breakdowns}).strict())}).strict();
/** Event curves are intentionally excluded from this aggregate response. */
export function performanceReport(dataset:AnalyticsDataset) {
  return performanceResultSchema.parse({timezone:dataset.timezone,filters:dataset.filters,selectedAccountCount:dataset.selectedAccountCount,selectedCurrencyCount:dataset.selectedCurrencyCount,
    unitlessMetrics:dataset.unitlessMetrics,currencies:dataset.currencies.map(c=>({...c,currentBalance:c.balanceComplete?c.currentBalance:null,openingBalance:c.balanceComplete?c.openingBalance:null,returnPercentage:c.balanceComplete?c.returnPercentage:null,curve:Object.fromEntries(Object.entries(c.curve).filter(([key])=>key!=="points"))})),breakdownsByCurrency:dataset.breakdownsByCurrency});
}
const cohort=z.object({trades:count,wins:count,losses:count,breakEvens:count,winRate:nullable,winRateSample:count,averageR:nullable,rExpectancy:nullable,rSample:count,
  currencies:z.array(z.object({currencyCode:z.string(),currencyPrecision:count,trades:count,netPnl:decimalString,profitFactor:factor}).strict())}).strict();
const behavioralGroup=z.object({key:z.string(),label:z.string(),description:z.string().optional(),metrics:cohort}).strict();
const comparison=z.object({key:z.string(),label:z.string(),description:z.string(),withBehavior:behavioralGroup,withoutBehavior:behavioralGroup}).strict();
export const behaviorResultSchema=z.object({closedTrades:count,executionReviewedTrades:count,psychologyReviewedTrades:count,ruleReviewedTrades:count,
  executionComparisons:z.array(comparison),executionRatings:z.array(behavioralGroup),stopActions:z.array(behavioralGroup),psychologyComparisons:z.array(comparison),emotions:z.array(behavioralGroup),confidence:z.array(behavioralGroup),
  rules:z.object({reviewedTrades:count,fullyCompliantTrades:count,violationTrades:count,complianceRate:nullable,totalViolations:count,comparison:z.array(behavioralGroup),rules:z.array(z.object({key:z.string(),label:z.string(),description:z.string(),evaluated:count,followed:count,broken:count,breakRate:nullable,followedMetrics:cohort,brokenMetrics:cohort}).strict())}).strict(),
  grades:z.array(behavioralGroup),gradeGroups:z.array(behavioralGroup),qualityMatrix:z.array(behavioralGroup),mistakes:z.array(comparison.extend({count,eligibleReviewedTrades:count,reviewedShare:nullable})),
  recentLessons:z.array(z.object({tradeId:z.string().uuid(),closedAt:z.iso.datetime({offset:true}),lesson:z.string()}).strict())}).strict();
