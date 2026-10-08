import Decimal from "decimal.js";

import { calculatePerformanceMetrics, isQualifyingClosedTrade, type AnalyticsTrade, type ProfitFactor, type RuleComplianceState } from "@/domain/analytics/performance";
import { normalizeMoney, parseDecimal } from "@/domain/money/decimal";
import type { StopAction, TradeEmotion, TradeGrade } from "@/types/domain";

export interface ExecutionEvidence {
  reviewedAt: string | null;
  entryAccordingToPlan: boolean | null;
  stopAccordingToPlan: boolean | null;
  targetAccordingToPlan: boolean | null;
  stopAction: StopAction | null;
  closedEarly: boolean | null;
  enteredEarly: boolean | null;
  enteredLate: boolean | null;
  chasedPrice: boolean | null;
  addedToPosition: boolean | null;
  revengeTrade: boolean | null;
  overRisked: boolean | null;
  executionRating: number | null;
}

export interface PsychologyEvidence {
  reviewedAt: string | null;
  confidenceBeforeEntry: number | null;
  emotionBefore: TradeEmotion | null;
  emotionDuring: TradeEmotion | null;
  emotionAfter: TradeEmotion | null;
  fearInfluenced: boolean | null;
  greedInfluenced: boolean | null;
  fomoInfluenced: boolean | null;
}

export interface RuleReviewItemEvidence {
  ruleId: string;
  ruleName: string;
  ruleDescription: string;
  complied: boolean;
}

export interface RuleReviewEvidence {
  reviewedAt: string;
  applicableRuleCount: number;
  items: RuleReviewItemEvidence[];
}

export interface BehavioralTrade extends AnalyticsTrade {
  execution: ExecutionEvidence | null;
  psychology: PsychologyEvidence | null;
  ruleReview: RuleReviewEvidence | null;
  grade: TradeGrade | null;
  lessonLearned: string | null;
  reviewText: string | null;
}

export interface CurrencyCohortMetrics {
  currencyCode: string;
  currencyPrecision: number;
  trades: number;
  netPnl: string;
  profitFactor: ProfitFactor;
}

export interface BehavioralCohortMetrics {
  trades: number;
  wins: number;
  losses: number;
  breakEvens: number;
  winRate: string | null;
  winRateSample: number;
  averageR: string | null;
  rExpectancy: string | null;
  rSample: number;
  currencies: CurrencyCohortMetrics[];
}

export interface BehavioralGroup {
  key: string;
  label: string;
  description?: string;
  metrics: BehavioralCohortMetrics;
}

export interface BehavioralComparison {
  key: string;
  label: string;
  description: string;
  withBehavior: BehavioralGroup;
  withoutBehavior: BehavioralGroup;
}

export interface RuleStatistic {
  key: string;
  label: string;
  description: string;
  evaluated: number;
  followed: number;
  broken: number;
  breakRate: string | null;
  followedMetrics: BehavioralCohortMetrics;
  brokenMetrics: BehavioralCohortMetrics;
}

export interface RuleAnalytics {
  reviewedTrades: number;
  fullyCompliantTrades: number;
  violationTrades: number;
  complianceRate: string | null;
  totalViolations: number;
  comparison: BehavioralGroup[];
  rules: RuleStatistic[];
}

export interface MistakeStatistic extends BehavioralComparison {
  count: number;
  eligibleReviewedTrades: number;
  reviewedShare: string | null;
}

export interface BehavioralAnalytics {
  closedTrades: number;
  executionReviewedTrades: number;
  psychologyReviewedTrades: number;
  ruleReviewedTrades: number;
  executionComparisons: BehavioralComparison[];
  executionRatings: BehavioralGroup[];
  stopActions: BehavioralGroup[];
  psychologyComparisons: BehavioralComparison[];
  emotions: BehavioralGroup[];
  confidence: BehavioralGroup[];
  rules: RuleAnalytics;
  grades: BehavioralGroup[];
  gradeGroups: BehavioralGroup[];
  qualityMatrix: BehavioralGroup[];
  mistakes: MistakeStatistic[];
  recentLessons: Array<{ tradeId: string; closedAt: string; lesson: string }>;
}

function percentage(numerator: number, denominator: number): string | null {
  return denominator > 0 ? new Decimal(numerator).div(denominator).times(100).toFixed(2) : null;
}

export function summarizeBehavioralCohort(trades: readonly BehavioralTrade[]): BehavioralCohortMetrics {
  const closed = trades.filter(isQualifyingClosedTrade);
  const winners = closed.filter((trade) => trade.outcome === "WIN" || trade.outcome === "PARTIAL_WIN");
  const losers = closed.filter((trade) => trade.outcome === "LOSS" || trade.outcome === "PARTIAL_LOSS");
  const breakEvens = closed.filter((trade) => trade.outcome === "BREAK_EVEN");
  const rValues = closed
    .filter((trade) => trade.actualR !== null)
    .map((trade) => parseDecimal(trade.actualR ?? "0"));
  const averageR = rValues.length > 0
    ? rValues.reduce((total, value) => total.plus(value), new Decimal(0)).div(rValues.length).toFixed(8)
    : null;
  const byCurrency = new Map<string, BehavioralTrade[]>();
  for (const trade of closed) {
    const current = byCurrency.get(trade.currencyCode) ?? [];
    current.push(trade);
    byCurrency.set(trade.currencyCode, current);
  }

  return {
    trades: closed.length,
    wins: winners.length,
    losses: losers.length,
    breakEvens: breakEvens.length,
    winRate: percentage(winners.length, winners.length + losers.length),
    winRateSample: winners.length + losers.length,
    averageR,
    rExpectancy: averageR,
    rSample: rValues.length,
    currencies: [...byCurrency.entries()].map(([currencyCode, currencyTrades]) => {
      const precision = Math.max(...currencyTrades.map(trade=>trade.currencyPrecision));
      const metrics = calculatePerformanceMetrics(currencyTrades.map(trade=>({...trade,
        netPnl:trade.netPnl===null?null:normalizeMoney(trade.netPnl,trade.currencyPrecision)})), precision);
      return { currencyCode, currencyPrecision: precision, trades: metrics.closedTrades, netPnl: metrics.netProfit, profitFactor: metrics.profitFactor };
    }).toSorted((left, right) => left.currencyCode.localeCompare(right.currencyCode)),
  };
}

function groupBy(
  trades: readonly BehavioralTrade[],
  selector: (trade: BehavioralTrade) => { key: string; label: string } | null,
): BehavioralGroup[] {
  const groups = new Map<string, { label: string; trades: BehavioralTrade[] }>();
  for (const trade of trades) {
    const selected = selector(trade);
    if (!selected) continue;
    const group = groups.get(selected.key) ?? { label: selected.label, trades: [] };
    group.trades.push(trade);
    groups.set(selected.key, group);
  }
  return [...groups.entries()].map(([key, group]) => ({ key, label: group.label, metrics: summarizeBehavioralCohort(group.trades) }));
}

function comparison(
  key: string,
  label: string,
  description: string,
  eligible: readonly BehavioralTrade[],
  predicate: (trade: BehavioralTrade) => boolean | null,
  withLabel = `With ${label.toLowerCase()}`,
  withoutLabel = `Without ${label.toLowerCase()}`,
): BehavioralComparison {
  return {
    key,
    label,
    description,
    withBehavior: { key: `${key}-yes`, label: withLabel, metrics: summarizeBehavioralCohort(eligible.filter(trade=>predicate(trade)===true)) },
    withoutBehavior: { key: `${key}-no`, label: withoutLabel, metrics: summarizeBehavioralCohort(eligible.filter(trade=>predicate(trade)===false)) },
  };
}

function ruleComplianceState(trade: BehavioralTrade): RuleComplianceState {
  if (!trade.ruleReview?.reviewedAt || trade.ruleReview.items.length!==trade.ruleReview.applicableRuleCount || new Set(trade.ruleReview.items.map(i=>i.ruleId)).size!==trade.ruleReview.applicableRuleCount) return "NOT_REVIEWED";
  return trade.ruleReview.items.some((item) => !item.complied) ? "VIOLATIONS_PRESENT" : "FULLY_COMPLIANT";
}

export function calculateBehavioralAnalytics(input: readonly BehavioralTrade[]): BehavioralAnalytics {
  const trades = input.filter(isQualifyingClosedTrade);
  const execution = trades.filter((trade) => trade.execution?.reviewedAt);
  const psychology = trades.filter((trade) => trade.psychology?.reviewedAt);
  const rules = trades.filter((trade) => ruleComplianceState(trade)!=="NOT_REVIEWED");

  const executionComparisons: BehavioralComparison[] = [
    comparison("entry-plan", "Entry according to plan", "Observed results for reviewed trades with and without planned entry execution.", execution, (trade) => (trade.execution?.entryAccordingToPlan ?? null), "Entry followed", "Entry not followed"),
    comparison("stop-plan", "Stop according to plan", "Observed results for reviewed trades with and without planned initial stop placement.", execution, (trade) => (trade.execution?.stopAccordingToPlan ?? null), "Stop followed", "Stop not followed"),
    comparison("target-plan", "Target according to plan", "Observed results for reviewed trades with and without planned target selection.", execution, (trade) => (trade.execution?.targetAccordingToPlan ?? null), "Target followed", "Target not followed"),
  ];

  const behaviorDefinitions: Array<[string, string, string, (trade: BehavioralTrade) => boolean | null]> = [
    ["entered-early", "Early entry", "Entered before the required confirmation.", (trade) => (trade.execution?.enteredEarly ?? null)],
    ["entered-late", "Late entry", "Entered after the intended opportunity moved away.", (trade) => (trade.execution?.enteredLate ?? null)],
    ["chased-price", "Chased price", "Entered mainly from fear of missing the move.", (trade) => (trade.execution?.chasedPrice ?? null)],
    ["closed-early", "Early exit", "Exited before target or invalidation for discretionary reasons.", (trade) => (trade.execution?.closedEarly ?? null)],
    ["over-risked", "Over-risked", "Risk exceeded the planned or permitted amount.", (trade) => (trade.execution?.overRisked ?? null)],
    ["revenge-trade", "Revenge trade", "Trade was influenced by an urge to recover a previous loss.", (trade) => (trade.execution?.revengeTrade ?? null)],
    ["added-position", "Added to position", "Position size was increased after the initial entry.", (trade) => (trade.execution?.addedToPosition ?? null)],
    ["stop-widened", "Stop widened", "The stop was moved farther from invalidation during management.", (trade) => trade.execution?.stopAction===null || trade.execution?.stopAction===undefined ? null : trade.execution.stopAction === "WIDENED"],
  ];
  executionComparisons.push(...behaviorDefinitions.map(([key, label, description, predicate]) => comparison(key, label, description, execution, predicate)));

  const psychologyComparisons: BehavioralComparison[] = [
    comparison("fomo", "FOMO influence", "Descriptive association among completed psychology reviews.", psychology, (trade) => (trade.psychology?.fomoInfluenced ?? null), "FOMO: yes", "FOMO: no"),
    comparison("fear", "Fear influence", "Descriptive association among completed psychology reviews.", psychology, (trade) => (trade.psychology?.fearInfluenced ?? null), "Fear: yes", "Fear: no"),
    comparison("greed", "Greed influence", "Descriptive association among completed psychology reviews.", psychology, (trade) => (trade.psychology?.greedInfluenced ?? null), "Greed: yes", "Greed: no"),
    comparison("revenge-trade", "Revenge trade", "Descriptive association among completed execution reviews.", execution, (trade) => (trade.execution?.revengeTrade ?? null), "Revenge flag: yes", "Revenge flag: no"),
  ];

  const ruleStateGroups = groupBy(rules, (trade) => {
    const state = ruleComplianceState(trade);
    return state === "FULLY_COMPLIANT"
      ? { key: "fully-compliant", label: "Rule-following trades" }
      : { key: "violations", label: "Rule-breaking trades" };
  });
  const fullyCompliantTrades = rules.filter((trade) => ruleComplianceState(trade) === "FULLY_COMPLIANT").length;
  const violationTrades = rules.length - fullyCompliantTrades;
  const ruleMap = new Map<string, { label: string; description: string; followed: BehavioralTrade[]; broken: BehavioralTrade[] }>();
  for (const trade of rules) {
    for (const item of trade.ruleReview?.items ?? []) {
      const row = ruleMap.get(item.ruleId) ?? { label: item.ruleName, description: item.ruleDescription, followed: [], broken: [] };
      (item.complied ? row.followed : row.broken).push(trade);
      ruleMap.set(item.ruleId, row);
    }
  }
  const ruleStatistics = [...ruleMap.entries()].map(([key, row]): RuleStatistic => ({
    key,
    label: row.label,
    description: row.description,
    evaluated: row.followed.length + row.broken.length,
    followed: row.followed.length,
    broken: row.broken.length,
    breakRate: percentage(row.broken.length, row.followed.length + row.broken.length),
    followedMetrics: summarizeBehavioralCohort(row.followed),
    brokenMetrics: summarizeBehavioralCohort(row.broken),
  })).toSorted((left, right) => right.broken - left.broken || right.evaluated - left.evaluated || left.label.localeCompare(right.label));

  const gradeOrder: TradeGrade[] = ["A", "B", "C", "D", "F"];
  const graded = trades.filter((trade) => trade.grade !== null);
  const grades = groupBy(graded, (trade) => ({ key: trade.grade ?? "", label: `${trade.grade} grade` }))
    .toSorted((left, right) => gradeOrder.indexOf(left.key as TradeGrade) - gradeOrder.indexOf(right.key as TradeGrade));
  const gradeGroups = groupBy(graded, (trade) => trade.grade === "A" || trade.grade === "B"
    ? { key: "strong", label: "A/B · Strong process" }
    : trade.grade === "C" ? { key: "mixed", label: "C · Acceptable or mixed process" }
      : { key: "poor", label: "D/F · Poor process" });
  const qualityMatrix = groupBy(graded, (trade) => {
    const quality = trade.grade === "A" || trade.grade === "B" ? "Strong process" : trade.grade === "C" ? "Mixed process" : "Poor process";
    const outcome = trade.outcome === "BREAK_EVEN" ? "Break-even" : trade.outcome === "WIN" || trade.outcome === "PARTIAL_WIN" ? "Winning" : "Losing";
    return { key: `${quality}-${outcome}`, label: `${outcome} · ${quality.toLowerCase()}` };
  });

  const mistakes: MistakeStatistic[] = behaviorDefinitions.map(([key, label, description, predicate]) => {
    const result = comparison(key, label, description, execution, predicate);
    return { ...result, count: result.withBehavior.metrics.trades, eligibleReviewedTrades: result.withBehavior.metrics.trades+result.withoutBehavior.metrics.trades, reviewedShare: percentage(result.withBehavior.metrics.trades, result.withBehavior.metrics.trades+result.withoutBehavior.metrics.trades) };
  });
  for (const [key, label, description, eligible, predicate] of [
    ["fomo", "FOMO", "Observed association among completed psychology reviews.", psychology, (trade: BehavioralTrade) => (trade.psychology?.fomoInfluenced ?? null)],
    ["rule-violation", "Rule violation", "Observed association among completed rule reviews.", rules, (trade: BehavioralTrade) => ruleComplianceState(trade) === "VIOLATIONS_PRESENT"],
  ] as const) {
    const result = comparison(key, label, description, eligible, predicate);
    mistakes.push({ ...result, count: result.withBehavior.metrics.trades, eligibleReviewedTrades: result.withBehavior.metrics.trades+result.withoutBehavior.metrics.trades, reviewedShare: percentage(result.withBehavior.metrics.trades, result.withBehavior.metrics.trades+result.withoutBehavior.metrics.trades) });
  }

  return {
    closedTrades: trades.length,
    executionReviewedTrades: execution.length,
    psychologyReviewedTrades: psychology.length,
    ruleReviewedTrades: rules.length,
    executionComparisons,
    executionRatings: groupBy(execution, (trade) => trade.execution?.executionRating ? { key: String(trade.execution.executionRating), label: `${trade.execution.executionRating} / 5` } : null).toSorted((left, right) => left.key.localeCompare(right.key)),
    stopActions: groupBy(execution, (trade) => trade.execution?.stopAction ? { key: trade.execution.stopAction, label: trade.execution.stopAction.replaceAll("_", " ") } : null),
    psychologyComparisons,
    emotions: groupBy(psychology, (trade) => trade.psychology?.emotionBefore ? { key: trade.psychology.emotionBefore, label: trade.psychology.emotionBefore.replaceAll("_", " ") } : null),
    confidence: groupBy(psychology, (trade) => trade.psychology?.confidenceBeforeEntry ? { key: String(trade.psychology.confidenceBeforeEntry), label: `Confidence ${trade.psychology.confidenceBeforeEntry}` } : null).toSorted((left, right) => left.key.localeCompare(right.key)),
    rules: {
      reviewedTrades: rules.length,
      fullyCompliantTrades,
      violationTrades,
      complianceRate: percentage(fullyCompliantTrades, rules.length),
      totalViolations: rules.reduce((total, trade) => total + (trade.ruleReview?.items.filter((item) => !item.complied).length ?? 0), 0),
      comparison: ruleStateGroups,
      rules: ruleStatistics,
    },
    grades,
    gradeGroups,
    qualityMatrix,
    mistakes: mistakes.toSorted((left, right) => right.count - left.count || left.label.localeCompare(right.label)),
    recentLessons: trades.filter((trade) => trade.lessonLearned).toSorted((left, right) => (right.closedAt ?? "").localeCompare(left.closedAt ?? "")).slice(0, 8).map((trade) => ({ tradeId: trade.id, closedAt: trade.closedAt ?? "", lesson: trade.lessonLearned ?? "" })),
  };
}
