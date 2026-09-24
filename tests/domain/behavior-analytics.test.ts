import { describe, expect, it } from "vitest";

import { calculateBehavioralAnalytics, type BehavioralTrade } from "@/domain/analytics/behavior";

function trade(overrides: Partial<BehavioralTrade> = {}): BehavioralTrade {
  return {
    id: "trade-1",
    accountId: "account-1",
    accountName: "Primary",
    accountType: "PERSONAL_LIVE",
    currencyCode: "USD",
    currencyPrecision: 2,
    status: "CLOSED",
    openedAt: "2026-09-01T08:00:00Z",
    closedAt: "2026-09-01T10:00:00Z",
    outcome: "WIN",
    netPnl: "100",
    grossPnl: "100",
    commission: "0",
    swap: "0",
    otherFees: "0",
    actualR: "1",
    plannedRiskPercentage: "1",
    plannedRiskReward: "2",
    actualLotSize: "1",
    holdingDurationSeconds: 7200,
    instrumentId: "eurusd",
    instrument: "EURUSD",
    strategyId: null,
    strategy: "Unassigned",
    setupId: null,
    setup: "Unassigned",
    session: "LONDON",
    direction: "BUY",
    ruleCompliance: "NOT_REVIEWED",
    ruleViolations: 0,
    execution: null,
    psychology: null,
    ruleReview: null,
    grade: null,
    lessonLearned: null,
    reviewText: null,
    ...overrides,
  };
}

const completedExecution: NonNullable<BehavioralTrade["execution"]> = {
  reviewedAt: "2026-09-01T12:00:00Z",
  entryAccordingToPlan: true,
  stopAccordingToPlan: true,
  targetAccordingToPlan: true,
  stopAction: "UNCHANGED",
  closedEarly: false,
  enteredEarly: false,
  enteredLate: false,
  chasedPrice: false,
  addedToPosition: false,
  revengeTrade: false,
  overRisked: false,
  executionRating: 5,
};

const completedPsychology: NonNullable<BehavioralTrade["psychology"]> = {
  reviewedAt: "2026-09-01T12:00:00Z",
  confidenceBeforeEntry: 4,
  emotionBefore: "CALM",
  emotionDuring: "FOCUSED",
  emotionAfter: "CALM",
  fearInfluenced: false,
  greedInfluenced: false,
  fomoInfluenced: false,
};

describe("Phase 05 behavioral analytics", () => {
  it("excludes placeholder execution and psychology rows from reviewed samples", () => {
    const analytics = calculateBehavioralAnalytics([trade({
      execution: { ...completedExecution, reviewedAt: null },
      psychology: { ...completedPsychology, reviewedAt: null },
    })]);
    expect(analytics.executionReviewedTrades).toBe(0);
    expect(analytics.psychologyReviewedTrades).toBe(0);
  });

  it("keeps explicit false answers in the completed comparison cohort", () => {
    const analytics = calculateBehavioralAnalytics([
      trade({ id: "yes", execution: completedExecution }),
      trade({ id: "no", outcome: "LOSS", netPnl: "-50", actualR: "-0.5", execution: { ...completedExecution, entryAccordingToPlan: false } }),
    ]);
    const entry = analytics.executionComparisons.find((item) => item.key === "entry-plan");
    expect(entry?.withBehavior.metrics.trades).toBe(1);
    expect(entry?.withoutBehavior.metrics.trades).toBe(1);
    expect(entry?.withBehavior.metrics.averageR).toBe("1.00000000");
    expect(entry?.withoutBehavior.metrics.averageR).toBe("-0.50000000");
  });

  it("groups confidence and pre-trade emotion only from completed reviews", () => {
    const analytics = calculateBehavioralAnalytics([
      trade({ id: "reviewed", psychology: completedPsychology }),
      trade({ id: "draft", psychology: { ...completedPsychology, reviewedAt: null, confidenceBeforeEntry: 1, emotionBefore: "FEARFUL" } }),
    ]);
    expect(analytics.confidence.map((item) => item.key)).toEqual(["4"]);
    expect(analytics.emotions.map((item) => item.key)).toEqual(["CALM"]);
  });

  it("derives completed rule compliance and individual rule statistics from snapshots", () => {
    const analytics = calculateBehavioralAnalytics([
      trade({ id: "followed", ruleReview: { reviewedAt: "2026-09-01T12:00:00Z", applicableRuleCount: 1, items: [{ ruleId: "r1", ruleName: "Wait for close", ruleDescription: "Wait for confirmation.", complied: true }] } }),
      trade({ id: "broken", outcome: "LOSS", netPnl: "-100", actualR: "-1", ruleReview: { reviewedAt: "2026-09-02T12:00:00Z", applicableRuleCount: 1, items: [{ ruleId: "r1", ruleName: "Wait for close", ruleDescription: "Wait for confirmation.", complied: false }] } }),
      trade({ id: "not-reviewed" }),
    ]);
    expect(analytics.rules).toMatchObject({ reviewedTrades: 2, fullyCompliantTrades: 1, violationTrades: 1, complianceRate: "50.00", totalViolations: 1 });
    expect(analytics.rules.rules[0]).toMatchObject({ evaluated: 2, followed: 1, broken: 1, breakRate: "50.00" });
  });

  it("does not treat a partially answered draft rule review as compliant", () => {
    const analytics = calculateBehavioralAnalytics([trade({ ruleCompliance: "FULLY_COMPLIANT", ruleReview: null })]);
    expect(analytics.rules.reviewedTrades).toBe(0);
    expect(analytics.rules.complianceRate).toBeNull();
  });

  it("preserves all grades and applies only the approved summary grouping", () => {
    const analytics = calculateBehavioralAnalytics(["A", "B", "C", "D", "F"].map((grade, index) => trade({ id: String(index), grade: grade as BehavioralTrade["grade"] })));
    expect(analytics.grades.map((item) => item.key)).toEqual(["A", "B", "C", "D", "F"]);
    expect(analytics.gradeGroups.map((item) => item.key).toSorted()).toEqual(["mixed", "poor", "strong"]);
  });

  it("uses eligible reviewed populations for mistake percentages", () => {
    const analytics = calculateBehavioralAnalytics([
      trade({ id: "early", execution: { ...completedExecution, enteredEarly: true } }),
      trade({ id: "normal", execution: completedExecution }),
      trade({ id: "missing" }),
    ]);
    const early = analytics.mistakes.find((item) => item.key === "entered-early");
    expect(early).toMatchObject({ count: 1, eligibleReviewedTrades: 2, reviewedShare: "50.00" });
  });

  it("separates monetary values by currency while aggregating unitless samples", () => {
    const analytics = calculateBehavioralAnalytics([
      trade({ id: "usd", execution: { ...completedExecution, enteredEarly: true }, netPnl: "100", currencyCode: "USD" }),
      trade({ id: "gbp", execution: { ...completedExecution, enteredEarly: true }, netPnl: "50", currencyCode: "GBP" }),
    ]);
    const early = analytics.mistakes.find((item) => item.key === "entered-early");
    expect(early?.withBehavior.metrics.trades).toBe(2);
    expect(early?.withBehavior.metrics.currencies.map((item) => [item.currencyCode, item.netPnl])).toEqual([["GBP", "50.00"], ["USD", "100.00"]]);
  });

  it("returns explicit empty states", () => {
    const analytics = calculateBehavioralAnalytics([]);
    expect(analytics).toMatchObject({ closedTrades: 0, executionReviewedTrades: 0, psychologyReviewedTrades: 0, ruleReviewedTrades: 0 });
    expect(analytics.rules.complianceRate).toBeNull();
    expect(analytics.recentLessons).toEqual([]);
  });
});
